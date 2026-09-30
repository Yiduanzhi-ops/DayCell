/**
 * 存储抽象接口（CORE-API §4）。
 *
 * 这条接口同时是两个未来能力的接缝：
 *  - 换云存储：只换实现，repo 以上零改动（PRD Q5）
 *  - 出小程序：core 整体复用（ADR-0006）
 *
 * ⚠️ 接口里**故意没有 remove**。删除只能通过 put({...rec, deleted:true}) 完成。
 *    这是对 ADR-0001「软删除/墓碑」的结构性强制，不是靠约定。
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

/** 存放带归属日内容记录的三个 store */
export type ContentStoreName = 'todos' | 'notes' | 'expenses'

export interface PutOptions {
  /**
   * 保留记录自带的 createdAt / updatedAt，不自动刷新。
   *
   * 只有两个合法用途，都要求调用方**自己保证两个时间戳一致**：
   *
   * 1. **导入备份**（必须 true）——否则恢复出来的记录 updatedAt 全变成"刚刚"，
   *    记录级 last-write-wins 会把云端较新的数据反过来覆盖掉（ADR-0001）。
   * 2. **批量写入需要保序时**（如 `rollOver`）——同一批记录的 createdAt 若完全相同，
   *    排序就退化成按 id 字典序，而 UUID 的字典序是随机的。
   *
   * ⚠️ 用了它就绕过了 `deleted` 的默认归一化，**必须显式传 `deleted`**。
   */
  keepTimestamps?: boolean
}

export interface ByUpdatedOptions {
  /** 默认 false：墓碑不外泄。导出整库与同步需要 true */
  includeDeleted?: boolean
}

export interface UsageEstimate {
  usage: number
  quota: number
}

export interface RecordStore {
  /** 打开或升级数据库。失败抛 StorageUnavailableError / MigrationFailedError */
  init(): Promise<void>

  /**
   * 写入或更新。**唯一的写入口**。
   * 默认自动把 updatedAt 刷成 now()；调用方不必（也不应）自己维护它。
   */
  put<T extends CoreRecord>(store: StoreName, rec: T, opts?: PutOptions): Promise<T>

  /** 批量写入，单事务。顺延、导入、首次播种都走这里 */
  putMany<T extends CoreRecord>(store: StoreName, recs: T[], opts?: PutOptions): Promise<T[]>

  /** 含墓碑也会返回——调用方需要自己判断 deleted */
  get<T extends CoreRecord>(store: StoreName, id: string): Promise<T | undefined>

  /**
   * 按日期闭区间查询，已排除墓碑。
   * 结果按 date 升序、同日按 createdAt 升序。
   * ⚠️ 实现必须走 byDate 索引；出现全表扫描即视为 bug（CORE-API §6）。
   */
  byDate<T extends ContentRecord>(store: ContentStoreName, from: DateKey, to: DateKey): Promise<T[]>

  /**
   * 一次取三个内容 store 的日期范围数据，月/周视图的唯一入口。
   * 实现应在**同一个只读事务**里发三个请求，而不是串行三次。
   */
  byDateAll(from: DateKey, to: DateKey): Promise<{
    todos: TodoRecord[]
    notes: NoteRecord[]
    expenses: ExpenseRecord[]
  }>

  /** 为云同步预留：按 updatedAt 增量拉取（PRD §6.3 的 byUpdated 索引） */
  byUpdatedSince<T extends CoreRecord>(
    store: StoreName,
    since: number,
    opts?: ByUpdatedOptions,
  ): Promise<T[]>

  /** 全量读取。只应用于 anniversaries / categories，以及导出备份 */
  all<T extends CoreRecord>(store: StoreName, opts?: ByUpdatedOptions): Promise<T[]>

  /**
   * 事务包装：fn 内任何一步抛错则整体回滚。
   * 跨 store 的复合操作（顺延、导入）必须用它。
   *
   * ⚠️ **fn 必须使用回调传入的 `scope`，不能用外层的 store 对象。**
   * IndexedDB 的原子性来自"所有请求挂在同一个 IDBTransaction 上"；
   * 若 fn 里用的是外层 store，每个操作会各自开新事务，回滚就形同虚设。
   * （CORE-API §4 原签名是 `fn: () => Promise<R>`，实现时发现无法保证原子性，故改为传入 scope。）
   */
  tx<R>(fn: (scope: RecordStore) => Promise<R>): Promise<R>

  /* ---- settings 是 key/value 单例，主键是 key 而非 id，单独开口 ---- */
  getSetting<T>(key: SettingKey, fallback: T): Promise<T>
  putSetting(key: SettingKey, value: unknown): Promise<void>
  allSettings(): Promise<SettingRecord[]>

  estimateUsage(): Promise<UsageEstimate>

  /** 仅供测试与设置里的「清空全部数据」。生产代码路径不得调用 */
  clearAll(): Promise<void>

  /** 释放底层连接。测试之间必须调用，否则 fake-indexeddb 会串数据 */
  close(): void
}

/** 构造 store 时可注入的依赖（ADR-0006：不直接访问全局） */
export interface StoreDeps {
  /** 时钟注入点。默认 () => Date.now() */
  now?: () => number
}

/** 内容记录的默认空集，供 byDateAll 的返回构造使用 */
export const emptyContent = (): { todos: TodoRecord[]; notes: NoteRecord[]; expenses: ExpenseRecord[] } => ({
  todos: [],
  notes: [],
  expenses: [],
})

/** date 升序、同日 createdAt 升序、再同日按 id 兜底（保证排序稳定） */
export function sortDated<T extends ContentRecord>(recs: T[]): T[] {
  return recs.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 分类按 order 升序 */
export function sortCategories(recs: CategoryRecord[]): CategoryRecord[] {
  return recs.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.id < b.id ? -1 : 1))
}

export type { ContentRecord, CoreRecord, DateKey, NoteRecord, StoreName, TodoRecord, ExpenseRecord }
