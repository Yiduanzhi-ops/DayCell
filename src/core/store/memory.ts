/**
 * 内存实现。两个用途：
 *  1. 测试替身——与 idb 实现跑**同一份契约测试**（store/contract.test.ts）
 *  2. PRD E1 的降级实现：IndexedDB 不可用（Safari 隐私模式等）时兜底，
 *     此时 UI 必须显示红色横幅警告"当前数据不会被保存"
 *
 * ⚠️ 作为降级实现时数据是易失的，刷新即丢。这是刻意的——
 *    比直接让应用崩掉好，且给了用户导出的机会。
 */

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
import { MigrationFailedError, QuotaExceededError, StorageUnavailableError } from '../errors'
import { systemClock } from '../clock'
import {
  emptyContent,
  sortCategories,
  sortDated,
  type ByUpdatedOptions,
  type ContentStoreName,
  type PutOptions,
  type RecordStore,
  type StoreDeps,
  type UsageEstimate,
} from './types'

type Row = CoreRecord & { date?: DateKey; catId?: string; type?: string }

export interface MemoryStoreOptions extends StoreDeps {
  /**
   * 模拟 IndexedDB 不可用，用于测试 PRD E1 的降级路径。
   * init() 会抛 StorageUnavailableError。
   */
  failInit?: boolean
  /** 模拟配额上限（字节）。写入超过则抛 QuotaExceededError */
  quotaBytes?: number
  /** 模拟迁移失败 */
  failMigration?: boolean
}

export function createMemoryStore(opts: MemoryStoreOptions = {}): RecordStore {
  const now = opts.now ?? systemClock
  const tables = new Map<StoreName, Map<string, Row>>()
  const settings = new Map<SettingKey, SettingRecord>()
  let initialized = false

  for (const s of ALL_STORES) tables.set(s, new Map())

  const table = (s: StoreName): Map<string, Row> => {
    const t = tables.get(s)
    if (!t) throw new MigrationFailedError(`未知的 store: ${s}`)
    return t
  }

  /** 结构化拷贝，保证外部拿到的对象与库内隔离（IndexedDB 的语义也是如此） */
  const clone = <T>(v: T): T =>
    typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T)

  const live = <T extends CoreRecord>(rows: Iterable<Row>, includeDeleted: boolean): T[] => {
    const out: T[] = []
    for (const r of rows) {
      if (!includeDeleted && r.deleted) continue
      out.push(clone(r) as T)
    }
    return out
  }

  const bytes = (): number => {
    let n = 0
    for (const t of tables.values()) for (const r of t.values()) n += JSON.stringify(r).length + 1
    for (const r of settings.values()) n += JSON.stringify(r).length + 1
    return n * 2 // JS 字符串按 UTF-16 估算
  }

  const snapshot = (): { tables: Map<StoreName, Map<string, Row>>; settings: Map<SettingKey, SettingRecord> } => ({
    tables: new Map([...tables].map(([k, v]) => [k, new Map(v)] as const)),
    settings: new Map(settings),
  })

  const restore = (snap: ReturnType<typeof snapshot>): void => {
    tables.clear()
    for (const [k, v] of snap.tables) tables.set(k, v)
    settings.clear()
    for (const [k, v] of snap.settings) settings.set(k, v)
  }

  const write = <T extends CoreRecord>(s: StoreName, rec: T, o?: PutOptions): T => {
    if (opts.quotaBytes !== undefined && bytes() + JSON.stringify(rec).length * 2 > opts.quotaBytes) {
      // 在实际写入时抛，语义与 IndexedDB 的 QuotaExceededError 一致（PRD E2）
      throw new QuotaExceededError()
    }
    const row: Row = o?.keepTimestamps
      ? (clone(rec) as Row)
      : ({ ...clone(rec), updatedAt: now(), deleted: rec.deleted ?? false } as Row)
    if (s === 'categories' && typeof (row as CategoryRecord).order !== 'number') {
      ;(row as CategoryRecord).order = table('categories').size
    }
    table(s).set(rec.id, row)
    return clone(row as T)
  }

  const store: RecordStore = {
    async init() {
      if (opts.failInit) throw new StorageUnavailableError()
      if (opts.failMigration) throw new MigrationFailedError('模拟迁移失败')
      initialized = true
    },

    async put<T extends CoreRecord>(s: StoreName, rec: T, o?: PutOptions) {
      return write(s, rec, o)
    },

    async putMany<T extends CoreRecord>(s: StoreName, recs: T[], o?: PutOptions) {
      return recs.map((r) => write(s, r, o))
    },

    async get<T extends CoreRecord>(s: StoreName, id: string) {
      const r = table(s).get(id)
      return r ? (clone(r) as T) : undefined
    },

    async byDate<T extends ContentRecord>(s: ContentStoreName, from: DateKey, to: DateKey) {
      const out: T[] = []
      for (const r of table(s).values()) {
        if (r.deleted) continue
        const d = r.date
        if (typeof d !== 'string') continue
        if (d >= from && d <= to) out.push(clone(r) as T)
      }
      return sortDated(out)
    },

    async byDateAll(from: DateKey, to: DateKey) {
      const res = emptyContent()
      res.todos = await store.byDate<TodoRecord>('todos', from, to)
      res.notes = await store.byDate<NoteRecord>('notes', from, to)
      res.expenses = await store.byDate<ExpenseRecord>('expenses', from, to)
      return res
    },

    async byUpdatedSince<T extends CoreRecord>(s: StoreName, since: number, o?: ByUpdatedOptions) {
      const rows = [...table(s).values()].filter((r) => r.updatedAt > since)
      return live<T>(rows, o?.includeDeleted ?? false).sort((a, b) => a.updatedAt - b.updatedAt)
    },

    async all<T extends CoreRecord>(s: StoreName, o?: ByUpdatedOptions) {
      const rows = live<T>(table(s).values(), o?.includeDeleted ?? false)
      return s === 'categories'
        ? (sortCategories(rows as unknown as CategoryRecord[]) as unknown as T[])
        : rows
    },

    async tx<R>(fn: (scope: RecordStore) => Promise<R>) {
      // 内存实现靠快照回滚。数据量大时开销高，但本实现只用于测试与降级场景。
      // 传出去的 scope 就是 store 自身——内存实现没有"事务句柄"的概念，
      // 快照 + 失败恢复已经提供了等价的原子性保证。
      const snap = snapshot()
      try {
        return await fn(store)
      } catch (e) {
        restore(snap)
        throw e
      }
    },

    async getSetting<T>(key: SettingKey, fallback: T) {
      const r = settings.get(key)
      return r ? (clone(r.value) as T) : fallback
    },

    async putSetting(key: SettingKey, value: unknown) {
      settings.set(key, { key, value: clone(value), updatedAt: now() })
    },

    async allSettings() {
      return [...settings.values()].map(clone)
    },

    async estimateUsage(): Promise<UsageEstimate> {
      return { usage: bytes(), quota: opts.quotaBytes ?? Number.MAX_SAFE_INTEGER }
    },

    async clearAll() {
      for (const t of tables.values()) t.clear()
      settings.clear()
    },

    close() {
      initialized = false
    },
  }

  /** 未 init 就使用是编程错误；显式暴露以便测试断言 */
  Object.defineProperty(store, 'initialized', { get: () => initialized, enumerable: false })

  return store
}
