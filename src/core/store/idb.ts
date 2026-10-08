/**
 * IndexedDB 生产实现（ADR-0001）。
 *
 * 设计要点：
 *  - `indexedDB` / `navigator` 全部**注入**，不在模块里直接引用（ADR-0006 铁律 2）
 *  - 库结构见 PRD §6.3：6 个 store，内容 store 各建 byDate + byUpdated 索引
 *  - 读写一律排除墓碑；需要墓碑走 `includeDeleted: true`
 *  - `tx(fn)` 把**同一个 IDBTransaction** 通过参数交给回调，
 *    这样跨 store 的复合操作（顺延、导入）才是真正原子的
 */

import { openDB, type IDBPDatabase, type IDBPTransaction } from 'idb'
import type {
  CategoryRecord,
  ContentRecord,
  CoreRecord,
  DateKey,
  ExpenseRecord,
  NoteRecord,
  SettingKey,
  SettingRecord,
  StoreName,
  TodoRecord,
} from '../types'
import { ALL_STORES } from '../types'
import { QuotaExceededError, StorageUnavailableError } from '../errors'
import { systemClock } from '../clock'
import {
  emptyContent,
  sortCategories,
  sortDated,
  type ByUpdatedOptions,
  type ContentStoreName,
  type PutOptions,
  type RecordStore,
  type UsageEstimate,
} from './types'

export interface IdbDeps {
  /** 注入而非直接引用全局（ADR-0006） */
  indexedDB: IDBFactory
  dbName?: string
  version?: number
  now?: () => number
  /** 注入 navigator.storage.estimate，缺省时用逐条累加估算 */
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

/**
 * IndexedDB 库版本。
 *
 * ⚠️ 与 SCHEMA_VERSION **刻意解耦**：库版本只管 object store 集合（物理建库），
 * schema 版本管记录结构（备份兼容）。v7.9 新增 goals/stages 两个 store、
 * v8.0 新增 habits/checkins 两个 store、v8.5 新增 subtasks，库版本逐级升到 4 让**已安装用户**
 * 也能触发 upgrade 补建空表；SCHEMA_VERSION 保持 1，旧备份仍可导入。
 */
export const DB_VERSION = 4

type Row = Record<string, unknown> & CoreRecord & { date?: DateKey; catId?: string }

/**
 * 把「数据库」与「事务」抽象成同一个后端接口，
 * 这样 RecordStore 的方法只写一份，两种上下文都能用。
 */
interface Backend {
  get(s: StoreName, id: string): Promise<Row | undefined>
  put(s: StoreName, v: Row): Promise<void>
  getAll(s: StoreName): Promise<Row[]>
  /** 按索引做闭区间查询 */
  rangeByIndex(s: StoreName, index: string, from: unknown, to: unknown): Promise<Row[]>
  /** 按索引下界开区间查询（updatedAt > since） */
  upperByIndex(s: StoreName, index: string, since: number): Promise<Row[]>
  clear(s: StoreName): Promise<void>
}

/** idb v8：IDBPDatabase<DBTypes> 只有 1 个泛型参数，StoreNames 由 DBTypes 推导为 string */
type Db = IDBPDatabase
type Tx = IDBPTransaction<unknown, string[], 'readwrite'>

const dbBackend = (db: Db): Backend => ({
  get: (s, id) => db.get(s as string, id) as Promise<Row | undefined>,
  put: (s, v) => db.put(s as string, v as unknown as never).then(() => undefined),
  getAll: (s) => db.getAll(s as string) as Promise<Row[]>,
  rangeByIndex: (s, index, from, to) =>
    db.getAllFromIndex(s as string, index, IDBKeyRange.bound(from, to)) as Promise<Row[]>,
  upperByIndex: (s, index, since) =>
    db.getAllFromIndex(s as string, index, IDBKeyRange.lowerBound(since, true)) as Promise<Row[]>,
  clear: (s) => db.clear(s as string).then(() => undefined),
})

const txBackend = (tx: Tx): Backend => {
  // readwrite 事务里的 objectStore 才有完整的写方法集
  const os = (s: StoreName) => tx.objectStore(s as string)
  // ⚠️ getAllFromIndex 只挂在 IDBPDatabase 上，IDBPObjectStore 没有——
  //    事务内必须走 index(name).getAll(range)。这是 idb v8 的 API 形状。
  const idx = (s: StoreName, name: string) => os(s).index(name)
  return {
    get: (s, id) => os(s).get(id) as Promise<Row | undefined>,
    put: (s, v) => os(s).put(v as unknown as never).then(() => undefined),
    getAll: (s) => os(s).getAll() as Promise<Row[]>,
    rangeByIndex: (s, index, from, to) =>
      idx(s, index).getAll(IDBKeyRange.bound(from, to)) as Promise<Row[]>,
    upperByIndex: (s, index, since) =>
      idx(s, index).getAll(IDBKeyRange.lowerBound(since, true)) as Promise<Row[]>,
    clear: (s) => os(s).clear().then(() => undefined),
  }
}

/** 把后端包装成 RecordStore。`tx` 与 `close` 由调用方另行填充 */
function buildStore(
  be: Backend,
  opts: { now: () => number; tx?: RecordStore['tx']; close?: () => void; usage?: () => Promise<UsageEstimate> },
): RecordStore {
  const clone = <T>(v: T): T =>
    typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T)

  const live = <T extends CoreRecord>(rows: Row[], includeDeleted: boolean): T[] => {
    const out: T[] = []
    for (const r of rows) {
      if (!includeDeleted && r.deleted) continue
      out.push(clone(r) as T)
    }
    return out
  }

  /**
   * 按日期闭区间取原始行。
   *
   * ⚠️ 必须先判 from > to：`IDBKeyRange.bound(lo, hi)` 在 lo > hi 时抛 DataError，
   *    而内存实现会返回 []。两个实现必须行为一致，否则契约测试就失去意义。
   */
  const rowsInRange = (s: ContentStoreName, from: DateKey, to: DateKey): Promise<Row[]> =>
    from > to ? Promise.resolve([]) : be.rangeByIndex(s, 'byDate', from, to)

  const write = async <T extends CoreRecord>(s: StoreName, rec: T, o?: PutOptions): Promise<T> => {
    const row: Row = o?.keepTimestamps
      ? (clone(rec) as Row)
      : ({ ...(clone(rec) as Row), updatedAt: opts.now(), deleted: rec.deleted ?? false })
    await be.put(s, row)
    return clone(row as T)
  }

  const store: RecordStore = {
    async init() {
      /* 打开动作在 createIdbStore 里完成 */
    },

    put: (s, rec, o) => write(s, rec, o),
    putMany: async (s, recs, o) => {
      const out: typeof recs = []
      for (const r of recs) out.push(await write(s, r, o))
      return out
    },

    get: async <T extends CoreRecord>(s: StoreName, id: string) => {
      const r = await be.get(s, id)
      return r ? (clone(r) as T) : undefined
    },

    byDate: async <T extends ContentRecord>(s: ContentStoreName, from: DateKey, to: DateKey) => {
      // DateKey 是定宽零填充的 'YYYY-MM-DD'，字典序 === 时间序，可直接做 IDB 区间边界
      return sortDated(live<T>(await rowsInRange(s, from, to), false))
    },

    byDateAll: async (from: DateKey, to: DateKey) => {
      const res = emptyContent()
      // 同一个 backend（同一事务）里发三个请求，不串行等待
      const [todos, notes, expenses] = await Promise.all([
        rowsInRange('todos', from, to),
        rowsInRange('notes', from, to),
        rowsInRange('expenses', from, to),
      ])
      res.todos = sortDated(live<TodoRecord>(todos, false))
      res.notes = sortDated(live<NoteRecord>(notes, false))
      res.expenses = sortDated(live<ExpenseRecord>(expenses, false))
      return res
    },

    byUpdatedSince: async <T extends CoreRecord>(s: StoreName, since: number, o?: ByUpdatedOptions) => {
      const rows = s === 'settings' ? await be.getAll(s) : await be.upperByIndex(s, 'byUpdated', since)
      const out = live<T>(rows, o?.includeDeleted ?? false).filter((r) => r.updatedAt > since)
      return out.sort((a, b) => a.updatedAt - b.updatedAt)
    },

    all: async <T extends CoreRecord>(s: StoreName, o?: ByUpdatedOptions) => {
      const rows = await be.getAll(s)
      const out = live<T>(rows, o?.includeDeleted ?? false)
      return s === 'categories'
        ? (sortCategories(out as unknown as CategoryRecord[]) as unknown as T[])
        : out
    },

    // 由 createIdbStore 覆盖成真实事务版本
    tx: opts.tx ?? (async (fn) => fn(buildStore(be, opts))),

    getSetting: async <T,>(key: SettingKey, fallback: T) => {
      const r = (await be.get('settings', key)) as unknown as SettingRecord | undefined
      return r ? (clone(r.value) as T) : fallback
    },
    putSetting: async (key: SettingKey, value: unknown) => {
      await be.put('settings', { key, value: clone(value), updatedAt: opts.now() } as unknown as Row)
    },
    allSettings: async () => {
      const rows = (await be.getAll('settings')) as unknown as SettingRecord[]
      return rows.map(clone)
    },

    estimateUsage: opts.usage ?? (async () => ({ usage: 0, quota: Number.MAX_SAFE_INTEGER })),

    clearAll: async () => {
      for (const s of ALL_STORES) await be.clear(s)
    },

    close: opts.close ?? (() => {}),
  }

  return store
}

export async function createIdbStore(deps: IdbDeps): Promise<RecordStore> {
  const now = deps.now ?? systemClock
  const dbName = deps.dbName ?? 'daycell'
  const version = deps.version ?? DB_VERSION

  if (!deps.indexedDB) throw new StorageUnavailableError()

  let db: Db
  try {
    db = await openDB(dbName, version, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        // 显式迁移步骤，禁止"删库重建"（PRD §6.4）
        if (oldVersion < 1) {
          for (const name of ['todos', 'notes', 'expenses'] as const) {
            const s = database.createObjectStore(name, { keyPath: 'id' })
            s.createIndex('byDate', 'date')
            s.createIndex('byUpdated', 'updatedAt')
            // 只有花费需要按分类聚合
            if (name === 'expenses') s.createIndex('byCat', 'catId')
          }

          const ann = database.createObjectStore('anniversaries', { keyPath: 'id' })
          ann.createIndex('byUpdated', 'updatedAt')

          const cat = database.createObjectStore('categories', { keyPath: 'id' })
          cat.createIndex('byOrder', 'order')
          cat.createIndex('byUpdated', 'updatedAt')

          database.createObjectStore('settings', { keyPath: 'key' })
        }
        // v7.9：新增 goals/stages 两个 store（非日期内容，无需索引）。
        // 老库（v1）不建新 store 会导致访问时报错；新装用户走 oldVersion<1 分支，
        // 这里同样补建（IDB 的 upgrade 里重复 createObjectStore 会抛错，所以用 if 分支隔离）
        if (oldVersion < 2) {
          for (const name of ['goals', 'stages'] as const) {
            const s = database.createObjectStore(name, { keyPath: 'id' })
            s.createIndex('byUpdated', 'updatedAt')
          }
        }
        // v8.0：新增 habits / checkins。checkins 按打卡日期建 byDate 索引
        //（今日习惯聚合按天过滤；表小，实际也可全表扫，索引只是不亏）
        if (oldVersion < 3) {
          const habits = database.createObjectStore('habits', { keyPath: 'id' })
          habits.createIndex('byUpdated', 'updatedAt')
          const checkins = database.createObjectStore('checkins', { keyPath: 'id' })
          checkins.createIndex('byDate', 'date')
          checkins.createIndex('byUpdated', 'updatedAt')
        }
        // v8.5：新增 subtasks（子任务，非日期内容，无需索引）
        if (oldVersion < 4) {
          const subtasks = database.createObjectStore('subtasks', { keyPath: 'id' })
          subtasks.createIndex('byUpdated', 'updatedAt')
        }
        void transaction
      },
      blocked() {
        throw new StorageUnavailableError('数据库被其他标签页占用，请关闭其他标签页后重试')
      },
      blocking() {
        // 有新版本等待，本页签应尽快关闭（ADR-0002）
      },
      terminated() {
        // 浏览器异常终止了连接
      },
    })
  } catch (e) {
    if (e instanceof StorageUnavailableError) throw e
    throw new StorageUnavailableError('无法打开本地数据库', e)
  }

  const usage = async (): Promise<UsageEstimate> => {
    if (deps.estimate) {
      const r = await deps.estimate()
      return { usage: r.usage ?? 0, quota: r.quota ?? Number.MAX_SAFE_INTEGER }
    }
    return { usage: 0, quota: Number.MAX_SAFE_INTEGER }
  }

  const base = buildStore(dbBackend(db), {
    now,
    close: () => void db.close(),
    usage,
  })

  const withTx: RecordStore = {
    ...base,
    async tx<R>(fn: (scope: RecordStore) => Promise<R>): Promise<R> {
      const tx: Tx = db.transaction([...ALL_STORES], 'readwrite')
      const scope = buildStore(txBackend(tx), { now })
      try {
        const result = await fn(scope)
        await tx.done
        return result
      } catch (e) {
        try {
          tx.abort()
        } catch {
          /* 已经中止 */
        }
        await tx.done.catch(() => undefined)
        if (isQuota(e)) throw new QuotaExceededError(undefined, e)
        throw e
      }
    },
  }

  return withTx
}

function isQuota(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    ((e as { name?: string }).name === 'QuotaExceededError' ||
      (e as { code?: string }).code === 'QUOTA_EXCEEDED')
  )
}

/** 探测环境是否可用 IndexedDB（PRD E1 的判定入口，实际实现在 core/diagnose） */
export function hasIndexedDB(candidate: unknown): candidate is IDBFactory {
  return typeof candidate === 'object' && candidate !== null && typeof (candidate as IDBFactory).open === 'function'
}
