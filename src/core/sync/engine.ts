/**
 * core/sync/engine —— 同步引擎（v8.1 坚果云同步）。
 *
 * 模型：WebDAV 是"拉取"而非"推送"，所以自动同步只做两件事：
 *  - **打开网页时 pull 一次**（启动后台拉取，失败静默）
 *  - **本地数据变更后防抖 push**（写库经 wrapStoreForSync 触发 schedulePush）
 * 手动「立即同步」= pull + push（sync），补自动覆盖不到的盲区。
 *
 * 数据安全（id 级 last-write-wins）：
 *  - 同 id 记录取 updatedAt 较新者，任何一端较新都会在另一端生效
 *  - 不同 id 的记录天然合并，两设备各自新增互不覆盖
 *  - 唯一"丢失"场景：两端**同时改同一条**，旧者被覆盖（个人单用户概率≈0）
 *
 * 防循环：pull 合并写库期间置 merging 标志，写库触发的 schedulePush 直接跳过
 * （否则 拉取→写库→推送→另一端拉取→…… 无限循环）。
 */

import { parseBackup, serializeBackup } from '../backup'
import { systemClock, type Clock } from '../clock'
import type {
  AnniversaryRecord,
  CategoryRecord,
  CheckinRecord,
  ExpenseRecord,
  GoalRecord,
  HabitRecord,
  NoteRecord,
  RecordTable,
  StageRecord,
  TodoRecord,
} from '../types'
import type { RecordStore } from '../store/types'
import { createWebDavClient, type WebDavClient, type WebDavConfig } from './webdav'
import { mergeTables } from './merge'

export type SyncState = 'idle' | 'syncing' | 'error'

export interface SyncStatus {
  state: SyncState
  /** 最近一次成功同步（拉或推）的时间戳；从未成功过为 null */
  lastSyncAt: number | null
  /** 最近一次失败的中文原因；无失败为 null */
  lastError: string | null
  lastErrorAt: number | null
}

export interface SyncStats {
  /** 本次是否从云端拉取了数据（false = 云端还没有文件） */
  pulled: boolean
  /** 本次是否向云端推送了数据 */
  pushed: boolean
}

export interface SyncEngine {
  /** 是否已配置（configure 传入过合法配置） */
  readonly configured: boolean
  status(): SyncStatus
  /** 设置/更换同步配置；null = 停用同步 */
  configure(cfg: WebDavConfig | null): void
  /** 拉取云端 → 合并写本地（单事务；写库期间不触发推送） */
  pull(): Promise<SyncStats>
  /** 本地全量推送到云端 */
  push(): Promise<SyncStats>
  /** 先拉后推（手动「立即同步」） */
  sync(): Promise<SyncStats>
  /** 本地数据变更后防抖推送（wrapStoreForSync 调用） */
  schedulePush(delayMs?: number): void
  /** 立即执行挂起的推送（测试用） */
  flush(): Promise<void>
  /** 合并写库中（wrapStoreForSync 判断是否跳过推送） */
  readonly merging: boolean
}

export interface SyncEngineDeps {
  store: RecordStore
  clock?: Clock
  /** 状态变化回调（UI 层注入，刷新设置页显示） */
  onStatus?: (s: SyncStatus) => void
  /** 网络实现注入点（测试用 mock；缺省 globalThis.fetch） */
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}

const DEFAULT_PUSH_DELAY = 4000

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const clock = deps.clock ?? systemClock
  const notify = deps.onStatus ?? ((): void => {})

  let client: WebDavClient | null = null
  let configured = false
  let merging = false
  let status: SyncStatus = { state: 'idle', lastSyncAt: null, lastError: null, lastErrorAt: null }
  let pushTimer: ReturnType<typeof setTimeout> | null = null

  const setStatus = (patch: Partial<SyncStatus>): void => {
    status = { ...status, ...patch }
    notify(status)
  }

  const withError = async <R>(fn: () => Promise<R>): Promise<R> => {
    setStatus({ state: 'syncing' })
    try {
      const r = await fn()
      setStatus({ state: 'idle', lastSyncAt: clock(), lastError: null, lastErrorAt: null })
      return r
    } catch (e) {
      const msg = e instanceof Error ? e.message : '同步失败，请重试'
      setStatus({ state: 'error', lastError: msg, lastErrorAt: clock() })
      throw e
    }
  }

  /** 全量读本地（含墓碑；settings 单独走 allSettings） */
  const loadLocal = async (): Promise<RecordTable> => {
    const [todos, notes, expenses, anniversaries, categories, goals, stages, habits, checkins, settings] =
      await Promise.all([
        deps.store.all<TodoRecord>('todos', { includeDeleted: true }),
        deps.store.all<NoteRecord>('notes', { includeDeleted: true }),
        deps.store.all<ExpenseRecord>('expenses', { includeDeleted: true }),
        deps.store.all<AnniversaryRecord>('anniversaries', { includeDeleted: true }),
        deps.store.all<CategoryRecord>('categories', { includeDeleted: true }),
        deps.store.all<GoalRecord>('goals', { includeDeleted: true }),
        deps.store.all<StageRecord>('stages', { includeDeleted: true }),
        deps.store.all<HabitRecord>('habits', { includeDeleted: true }),
        deps.store.all<CheckinRecord>('checkins', { includeDeleted: true }),
        deps.store.allSettings(),
      ])
    return { todos, notes, expenses, anniversaries, categories, goals, stages, habits, checkins, settings }
  }

  /** 把合并结果写回本地：单事务 + keepTimestamps（否则 updatedAt 全变"刚刚"，
   *  下次比较会反向覆盖云端）；只写有变化的表，settings 只写 value 变化的 key */
  const writeMerged = async (local: RecordTable, merged: RecordTable): Promise<boolean> => {
    merging = true
    try {
      let changed = false
      const tables: Array<keyof Omit<RecordTable, 'settings'>> = [
        'todos', 'notes', 'expenses', 'anniversaries', 'categories', 'goals', 'stages', 'habits', 'checkins',
      ]
      await deps.store.tx(async (scope) => {
        for (const name of tables) {
          if (eq(local[name], merged[name])) continue
          changed = true
          await scope.putMany(name as 'todos', merged[name] as never, { keepTimestamps: true })
        }
        const localSettings = local.settings
        for (const s of merged.settings) {
          const cur = localSettings.find((x) => x.key === s.key)
          if (!cur || !eq(cur.value, s.value)) {
            changed = true
            await scope.putSetting(s.key, s.value)
          }
        }
      })
      return changed
    } finally {
      merging = false
    }
  }

  const pull = (): Promise<SyncStats> =>
    withError(async () => {
      if (!client) return { pulled: false, pushed: false }
      const text = await client.fetchFile()
      if (text === null) return { pulled: false, pushed: false } // 云端还没有文件
      const remote = parseBackup(text).data
      const local = await loadLocal()
      const merged = mergeTables(local, remote)
      await writeMerged(local, merged)
      return { pulled: true, pushed: false }
    })

  const push = (): Promise<SyncStats> =>
    withError(async () => {
      if (!client) return { pulled: false, pushed: false }
      const file = await serializeBackup(deps.store)
      await client.putFile(JSON.stringify(file))
      return { pulled: false, pushed: true }
    })

  const sync = async (): Promise<SyncStats> => {
    const a = await pull()
    const b = await push()
    return { pulled: a.pulled, pushed: b.pushed }
  }

  const clearTimer = (): void => {
    if (pushTimer !== null) {
      clearTimeout(pushTimer)
      pushTimer = null
    }
  }

  return {
    get configured() {
      return configured
    },
    get merging() {
      return merging
    },
    status: () => status,
    configure(cfg) {
      clearTimer()
      client = cfg ? createWebDavClient(cfg, { fetchImpl: deps.fetchImpl }) : null
      configured = cfg !== null
      if (!cfg) setStatus({ state: 'idle' })
    },
    pull,
    push,
    sync,
    schedulePush(delayMs = DEFAULT_PUSH_DELAY) {
      if (!client || merging) return // 未配置，或正处于拉取合并写库中
      clearTimer()
      pushTimer = setTimeout(() => {
        pushTimer = null
        void push().catch(() => {}) // 推送失败记入 status；不打断用户操作
      }, delayMs)
    },
    async flush() {
      if (pushTimer === null) return
      clearTimer()
      await push().catch(() => {})
    },
  }
}
