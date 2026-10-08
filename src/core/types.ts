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
   * date 的语义随 repeat 变化（v7.5 扩展，公历/农历见 isLunar）：
   * - none / yearly：'YYYY-MM-DD'。一次性 = 它自己那一天；每年 = 只看 MM-DD
   * - monthly：'YYYY-MM-DD'，只看日号 DD（每月这一天；不存在的日期自动跳过，如 2 月 31 日）
   * - weekly：'YYYY-MM-DD'，只看星期几（date 是"参考日期"，匹配每周同星期）
   * - isLunar=true 时 date 是农历日期，**只有 MM-DD 有意义**，年份被忽略（仅 none/yearly 允许农历）
   */
  date: string
  isLunar: boolean
  /** v7.5 扩展：weekly（每周）/ monthly（每月）。weekly/monthly 仅公历（设置 UI 约束） */
  repeat: 'none' | 'yearly' | 'monthly' | 'weekly'
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

/**
 * v7.9 阶段性目标（用户拍板口径）：
 * 目标 = 一个阶段性的主题（如「复习考公」），自身只有标题与阐述；
 * 进度全部体现在其下的阶段（StageRecord）里。不做子阶段、不做每日打卡。
 */
export interface GoalRecord extends CoreRecord {
  type: 'goal'
  title: string
  /** 目标阐述 / 总结沉淀（可空；详情页顶部主展示区） */
  note: string
  /** 目标整体是否完成（v7.9 补：完成的目标沉底到「已完成」列表，可回看/取消）。
   *  旧记录/旧备份无此字段 → 读路径一律按 false 归一化（见 aggregate.goalSummaries / store.openGoal） */
  done: boolean
}

export interface StageRecord extends CoreRecord {
  type: 'stage'
  /** 所属目标。目标删除时连带软删（repo 维护） */
  goalId: string
  title: string
  /** 进度 0–100 整数；不填为 undefined（未开始/无百分比语义，如账单总结阶段） */
  pct?: number
  /** 阶段备注（可空） */
  note: string
  /** 进行中 / 已完成。与 isCurrent 独立：可 100% 未标完成，也可标完成不填百分比 */
  done: boolean
  /** 当前阶段标记：**同一目标内至多一个**（repo setCurrent 维护互斥） */
  isCurrent: boolean
}

/**
 * v8.5 子任务（用户拍板口径）：
 * 子任务 = 目标的**执行维度**清单（与阶段的时间维度**并存不替代**）；
 * 详情页「阶段 | 子任务」双视图切换，各自进度独立；
 * 子任务字段最轻：标题 + 完成勾选 + 删除 + 点文字就地编辑；无备注、无日期。
 */
export interface SubtaskRecord extends CoreRecord {
  type: 'subtask'
  /** 所属目标。目标删除时连带软删（repo 维护） */
  goalId: string
  title: string
  /** 完成勾选（用户拍板：子任务要有完成勾选） */
  done: boolean
}

/**
 * v8.0 习惯（用户拍板口径）：
 * 习惯 = 每天/每周固定几天**自动出现在「今日习惯」**的轻打卡项，**纯勾选**，不进待办；
 * 频率用户自定义（每天 / 每周选星期几）；暂停（paused）后不出现在今日；
 * 打卡记录单独存 CheckinRecord（date + habitId），不产生"昨天的欠账"。
 */
export type HabitFreq = { kind: 'daily' } | { kind: 'weekly'; weekdays: number[] }

export interface HabitRecord extends CoreRecord {
  type: 'habit'
  name: string
  freq: HabitFreq
  /** 暂停：不出现在「今日习惯」（列表仍可见，可恢复） */
  paused: boolean
}

/** 打卡记录：date 上某个习惯已勾选。取消打卡 = 置墓碑（永不物理删除） */
export interface CheckinRecord extends CoreRecord {
  type: 'checkin'
  habitId: string
  /** 打卡日期（定宽 'YYYY-MM-DD'） */
  date: DateKey
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

/** 十个 store（PRD §6.3，v7.9 加 goals/stages，v8.0 加 habits/checkins） */
export type StoreName =
  | 'todos'
  | 'notes'
  | 'expenses'
  | 'anniversaries'
  | 'categories'
  | 'goals'
  | 'stages'
  | 'subtasks'
  | 'habits'
  | 'checkins'
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
  'goals',
  'stages',
  'subtasks',
  'habits',
  'checkins',
  'settings',
]

/** 当前 schema 版本。改动数据结构时必须 +1 并写迁移（PRD §6.4） */
export const SCHEMA_VERSION = 1

/**
 * 一整套记录表。迁移（`core/migrate`）与备份（`core/backup`）共用。
 *
 * ⚠️ **不能写成 `Record<StoreName, CoreRecord[]>`**（CORE-API §5.7/§5.8 原来就是这么写的）：
 * `SettingRecord` 只有 `{key, value, updatedAt}`，**没有** id / createdAt / deleted，
 * 它不是 `CoreRecord`。写成那样要么编译不过，要么被迫 `as unknown as` 把类型系统关掉——
 * 而备份/迁移恰恰是最需要类型系统兜底的地方（一次写错就是用户全部数据）。
 *
 * 逐字段列出来的额外好处：新增 store 时这里会编译失败，逼你同时更新迁移与备份。
 */
export interface RecordTable {
  todos: TodoRecord[]
  notes: NoteRecord[]
  expenses: ExpenseRecord[]
  anniversaries: AnniversaryRecord[]
  categories: CategoryRecord[]
  goals: GoalRecord[]
  stages: StageRecord[]
  subtasks: SubtaskRecord[]
  habits: HabitRecord[]
  checkins: CheckinRecord[]
  settings: SettingRecord[]
}
