/**
 * core 层的公共类型定义。
 *
 * 数据模型的完整定义与理由见 docs/PRD.md §6；
 * 三条不可违背的存储规则（记录级 / 软删除 / updatedAt）见 ADR-0001。
 */

/**
 * 'YYYY-MM-DD'，浏览器本地时区。
 *
 * 用 branded type 防止把任意 string 当日期传进来。
 * 构造它只有两条路：core/date.ts 的 `toKey()`，或通过 `isValidKey()` 的类型收窄。
 * 详见 ADR-0008。
 */
export type DateKey = string & { readonly __brand: 'DateKey' }

/** 'YYYY-MM' */
export type MonthKey = string & { readonly __brand: 'MonthKey' }

/** 每条记录都必须有的字段（PRD §6.1 规则 2 与 3） */
export interface CoreRecord {
  /** crypto.randomUUID()，全局唯一、无需服务端（CORE-API §5.1） */
  id: string
  createdAt: number
  /** 任何修改都必须刷新；记录级 last-write-wins 依赖它 */
  updatedAt: number
  /** 墓碑标记。**永不物理删除**（ADR-0001） */
  deleted: boolean
}

/** 带归属日的内容记录 */
export interface DatedRecord extends CoreRecord {
  date: DateKey
}

export interface TodoRecord extends DatedRecord {
  type: 'todo'
  text: string
  done: boolean
  doneAt?: number
  /** 顺延来源日期（PRD US-04） */
  rolledFrom?: DateKey
  /** 被顺延到的日期；存在即表示"已顺延出去"，进度统计要排除它 */
  rolledTo?: DateKey
}

export interface NoteRecord extends DatedRecord {
  type: 'note'
  /** 纯文本，保留换行，不解析 Markdown（PRD D6） */
  text: string
  /** v1 预留 */
  pinned?: boolean
}

export interface ExpenseRecord extends DatedRecord {
  type: 'expense'
  /** **整数「分」**，> 0。见 ADR-0003 */
  amountCents: number
  catId: string
  note: string
}

/** 三类内容记录的联合 */
export type ContentRecord = TodoRecord | NoteRecord | ExpenseRecord

export interface AnniversaryRecord extends CoreRecord {
  type: 'anniversary'
  title: string
  /**
   * isLunar=false → date 是公历 'YYYY-MM-DD'
   * isLunar=true  → date 是农历日期，**只有 MM-DD 有意义**，年份被忽略
   */
  date: string
  isLunar: boolean
  repeat: 'none' | 'yearly'
  /**
   * 农历闰月生日。该年没有对应闰月时，按同月号的普通月计（PRD E13）。
   * PRD §6.2 原表未列此字段，实现 E13 时补上——否则「闰六月初一」和「六月初一」无法区分。
   */
  isLeapMonth?: boolean
}

export interface CategoryRecord extends CoreRecord {
  type: 'category'
  name: string
  order: number
}

export interface SettingRecord {
  key: SettingKey
  value: unknown
  updatedAt: number
}

export type SettingKey =
  | 'accentColor'
  | 'lastBackupAt'
  | 'backupReminderOff'
  | 'onboarded'
  | 'weekStartsOn'

/** 六个 store（PRD §6.3） */
export type StoreName =
  | 'todos'
  | 'notes'
  | 'expenses'
  | 'anniversaries'
  | 'categories'
  | 'settings'

/** 存放带归属日内容记录的三个 store */
export type ContentStoreName = 'todos' | 'notes' | 'expenses'

export const CONTENT_STORES: readonly ContentStoreName[] = ['todos', 'notes', 'expenses']

export const ALL_STORES: readonly StoreName[] = [
  'todos',
  'notes',
  'expenses',
  'anniversaries',
  'categories',
  'settings',
]

/** 当前 schema 版本。改动数据结构时必须 +1 并写迁移（PRD §6.4） */
export const SCHEMA_VERSION = 1
