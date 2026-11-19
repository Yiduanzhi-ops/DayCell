/**
 * core/aggregate —— 三视图的**唯一**数据源（CORE-API §5.6）。
 *
 * 存在的理由：视图不应该自己拼数据。让 UI 分别查 todos/notes/expenses 再各自排序、
 * 过滤墓碑、算进度、算分类汇总，等于把领域规则复制三份到渲染层，然后各自漂移。
 *
 * ## 性能纪律（CORE-API §6，有基准测试守护）
 *
 * | 方法 | 查询次数 | 上限 |
 * |---|---|---|
 * | `aggregateMonth` | **3**：byDateAll + anniversaries.all + categories.nameMap | ≤ 100 ms @ 4 万条 |
 * | `aggregateWeek`  | 同上 3 次（区间只有 7 天） | ≤ 50 ms |
 * | `aggregateDay`   | 同上 3 次（区间 1 天） | ≤ 10 ms |
 * | `aggregateDayDetail` | 见下（早期 3 次，v8.107 起 12 路并行） | ≤ 20 ms（v6 首屏关键路径） |
 *
 * `aggregateDayDetail` 还要「前一天未完成待办数」来画顺延横幅。**不是**再查一次，
 * 而是把区间开成 `[date-1, date]` 一次取两天，然后按 date 劈开。多要一天数据的代价
 * 远小于多一次 IndexedDB 往返。v8.107 的「目标推进」另要 goals/stages/subtasks 三张
 * 小表的全量（内存过滤），并行发出，总查询数 12 路。
 *
 * **禁止**（code review 检查项）：在循环里开事务 / 用 `all()` 拿内容记录再在内存里过滤日期 /
 * 逐日调用 `aggregateDay` 拼月视图（42 × 3 = 126 次查询）。
 */

import {
  addDays,
  dowOf,
  fromKey,
  isValidKey,
  keyOf,
  monthGrid,
  monthKeys,
  rangeKeys,
  weekKeys,
  type WeekStartsOn,
} from '../date'
import { cellLabel, type CellLabel } from '../label'
import type { LunarApi, LunarInfo } from '../lunar'
import { isRollable, todoDoneDay, todoOccurrenceDay, todoProgress, type Repos } from '../repo'
import { buildReport, type ReportData, type ReportKind } from '../report'
import { sortHabits, type RecordStore } from '../store/types'
import type {
  AnniversaryRecord,
  DateKey,
  ExpenseRecord,
  FolderRecord,
  GoalRecord,
  HabitFreq,
  HabitRecord,
  NoteRecord,
  ReviewRecord,
  StageRecord,
  SubtaskRecord,
  TodoRecord,
} from '../types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 月格 / 周行要的**指示器**：只有计数与汇总，不含正文 */
export interface DayAggregate {
  date: DateKey
  /** 均**排除 rolledTo**（PRD US-04：顺延出去的不再算这天的进度）；
   *  v8.79 起也排除「已完成且非完成日的截止型」（不显示的东西不计数） */
  todoDone: number
  todoTotal: number
  noteCount: number
  costCents: number
  /** 按分类汇总，**金额降序**；同额按 catId 升序（保证输出确定，React key 才稳定） */
  byCat: CatSlice[]
  /** 当天命中的纪念日标题（公历 + 农历；农历库不可用时只有公历，PRD E4） */
  anniversaries: string[]
  /** 格子单行标签，已由 `cellLabel` 定过优先级 */
  label: CellLabel
  /** v8.42 当日有复盘（周/月格子右上角圆点） */
  hasReview: boolean
  /**
   * 三类内容**皆无**（已排墓碑）→ 视图渲染空状态。
   *
   * v8.79：按**展示口径**算，与 `visibleTodos` 一致——已顺延出去的源记录不再是
   * "这天的内容"，这天该显示空态。纪念日不计入——它不是用户写的东西。
   * （v6.1 曾用此语义驱动"空白日自动展开待办表单"，v7.2 已移除该机制，
   * isEmpty 现只被 UI 的空状态文案消费。）
   */
  isEmpty: boolean
}

export interface CatSlice {
  catId: string
  name: string
  cents: number
}

export interface WeekTotal {
  todoDone: number
  todoTotal: number
  /** 有想法的天数（周视图汇总条：「k 天有想法」） */
  daysWithNotes: number
  costCents: number
}

/** v8.95 逾期完成痕迹：截止日当天“当时还没做完”的历史快照，不计入待办统计。 */
export interface OverdueTrace {
  id: string
  text: string
  /** 实际完成日（doneOn 优先，旧数据回退 doneAt） */
  doneOn: DateKey
}

/**
 * 周视图的一行 = 指示器 + **正文预览**（PRD US-08：待办前 3 条、想法前 2 条）。
 *
 * 为什么在聚合层给预览而不是让 UI 再查一次：数据在 `byDateAll` 里**已经拿到了**，
 * 让 UI 补查等于同一份数据查两遍，还得把"排墓碑、排 rolledTo、排序"的规则复制出去。
 * （契约 §5.6 原稿只有 DayAggregate，这是实现时的扩展，已回写 CORE-API。）
 */
export interface WeekDay extends DayAggregate {
  /** 活跃待办（已排 rolledTo）的前 3 条；「+N 项待办」= todoTotal - todoPreview.length */
  todoPreview: TodoRecord[]
  /**
   * v8.95 逾期完成痕迹：截止日当天留下的「当时未完成」记录。
   * 只在 `doneOn > deadline` 时生成；**不进入 todoDone/todoTotal**，避免同一条任务
   * 在完成日与截止日各统计一次。UI 以灰色痕迹渲染，不带勾选框。
   */
  overdueTrace: OverdueTrace[]
  /** 想法的前 2 条（UI 负责每条 2 行截断） */
  notePreview: NoteRecord[]
  /** v8.52 当日复盘正文（一天一条；没写为 null）——周视图格子直接展示 */
  reviewPreview: { id: string; text: string } | null
  /** v8.62 当日习惯预览（该日应打卡的习惯 + 打卡态，仿待办预览）。
   *  数据层无条件构建，UI 按「周视图显示习惯」开关决定是否渲染（默认关）。 */
  habitPreview: HabitDayItem[]
  /** 原始农历日（'十五'）。label 是节日/节气/纪念日时，UI 拼「中秋节 · 十五」用 */
  lunarDay?: string
}

/**
 * v8.107 今日「目标推进」的一行：今天从目标里挑进来推进的一个子任务。
 *
 * 它本身仍是 `todos` 里 `subtaskId` 非空的一条记录（老口径「加入今日待办」），
 * 这里只是把归属信息（目标、阶段、累计天数、近 6 天）拼好，
 * 让今日视图不必自己去查 goals/stages/subtasks。
 */
export interface ProgressItem {
  /** 对应的待办记录 id（勾选 / 撤销都走 todos，不新增数据表） */
  todoId: string
  subtaskId: string
  /** 子任务标题（实时值；改名后以子任务为准，不用待办里的标题快照） */
  text: string
  /** 累计打卡天数 = workDates 长度 */
  days: number
  /** 今天是否已打卡（= 这条待办的 done） */
  done: boolean
  /** 过去 6 天（date-6 … date-1）的打卡态，**不含今天** */
  recent: boolean[]
}

/** v8.107 今日「目标推进」的一组 = 一个目标 + 它今天被挑进来的子任务 */
export interface ProgressGroup {
  goalId: string
  goalTitle: string
  /** 子任务所属阶段名（无阶段归属时取目标的当前阶段；都没有为 null） */
  stageTitle: string | null
  items: ProgressItem[]
}

/** 日视图（v6 的默认落地页）的唯一数据源：计数 + **全文** */
export interface DayDetail {
  date: DateKey
  summary: DayAggregate
  /**
   * 已排序（createdAt 升序）、已排墓碑；
   * v8.79 起**不含 rolledTo 项**（顺延出去的源记录不再显示）与「已完成且非完成日的截止型」
   */
  todos: TodoRecord[]
  /**
   * v8.98 日视图的逾期完成痕迹：截止日当天「当时未完成、后来完成」的历史快照。
   * 不进入 `summary.todoTotal/todoDone`，UI 以灰色痕迹渲染，不带勾选框。
   */
  overdueTrace: OverdueTrace[]
  notes: NoteRecord[]
  expenses: ExpenseRecord[]
  anniversaries: AnniversaryRecord[]
  /** v8.29 当天已勾选的纪念日 id（当作待办勾掉后不再打扰；与 anniversaries 对应） */
  annivDones: string[]
  /** 农历不可用为 null（PRD E4），UI 只渲染公历 */
  lunar: LunarInfo | null
  /** 前一天可顺延的待办数。> 0 时显示横幅（PRD D5 / E10）；顺带返回，省一次查询 */
  prevDayRollable: number
  /** v8.20 当日该做的习惯 + 打卡态（滑动侧页与落地页一致渲染用；不含暂停/不命中的） */
  habits: HabitDayItem[]
  /** v8.42 当日复盘（每日一条；没写为 null） */
  review: { id: string; text: string } | null
  /**
   * v8.107 今日「目标推进」：今天被挑进今日视图的目标子任务，按目标分组。
   * 这些子任务的待办**不再出现在 `todos`**（同一件事不双显），所以待办计数也不含它们。
   */
  progress: ProgressGroup[]
}

export interface MonthSummary {
  /** **只数本月**的天（不含月格前后补齐的邻月日期） */
  daysWithRecords: number
  costCents: number
}

/** v7.9 目标列表的一行（列表页唯一数据源）；v8.7 加 subtaskCount（子任务数）；v8.45 加 activeDays（已进行天数）；v9.14 加 folder（所属文件夹，读路径归一化） */
export interface GoalSummary {
  goal: GoalRecord
  /** 活阶段数（不含墓碑） */
  stageCount: number
  /** 活子任务数（不含墓碑，v8.7） */
  subtaskCount: number
  /** 当前阶段（无则 null：目标建了但没阶段/当前阶段被删/已完成） */
  current: { id: string; title: string } | null
  /** v8.45 目标已进行天数：该目标所有活子任务 workDates 的并集大小（去重） */
  activeDays: number
  /** v9.14 所属文件夹（活）。null = 未分类：
   *  目标没有 folderId、folderId 指向已删除/墓碑文件夹 → 一律归入未分类（删除文件夹 = 目标自动移出，不改目标记录） */
  folder: { id: string; name: string; collapsed: boolean } | null
}

/** v9.14 文件夹列表的一行（chips/分组用）：活文件夹，收藏置顶 + createdAt 升序 */
export interface FolderSummary {
  folder: FolderRecord
  /** 该文件夹内目标数（活目标，读路径归一化后统计） */
  count: number
}

/** v8.0 今日习惯的一行（纯勾选打卡项，不进待办） */
export interface HabitDayItem {
  id: string
  name: string
  freq: HabitFreq
  /** date 上是否已打卡 */
  done: boolean
}

/** v8.0 「今日习惯」区块数据源：只含今天该做的（每天全部 / 每周命中星期），暂停的排除 */
export interface HabitDay {
  date: DateKey
  items: HabitDayItem[]
  doneCount: number
  dueCount: number
}

export interface ViewOpts {
  weekStartsOn?: WeekStartsOn
}

export interface AggregateDeps {
  /** 范围查询只有 store 开口（`byDateAll`），repo 没有对应方法 */
  store: RecordStore
  repos: Repos
  /**
   * 农历。**null = 加载失败**（PRD E4）：label 降级为只出公历/纪念日，
   * 农历纪念日整类不显示，`DayDetail.lunar = null`。**不得抛错**——
   * 否则农历库一挂整个应用白屏，而公历部分本来是完全可用的。
   */
  lunar?: LunarApi | null
}

export interface Aggregates {
  aggregateDay(date: DateKey): Promise<DayAggregate>
  aggregateWeek(cursor: DateKey, opts?: ViewOpts): Promise<{ days: WeekDay[]; total: WeekTotal }>
  aggregateMonth(cursor: DateKey, opts?: ViewOpts): Promise<DayAggregate[]>
  monthSummary(cursor: DateKey): Promise<MonthSummary>
  aggregateDayDetail(date: DateKey): Promise<DayDetail>
  /** v7.9 目标列表：全部活目标 + 阶段数 + 当前阶段 */
  goalSummaries(): Promise<GoalSummary[]>
  /** v9.14 目标文件夹列表（chips/分组用）：活文件夹，收藏置顶 + createdAt 升序 */
  foldersAll(): Promise<FolderSummary[]>
  /** v7.9 某目标的全部活阶段：当前置顶，其余按 createdAt 升序 */
  stagesOfGoal(goalId: string): Promise<StageRecord[]>
  /** v8.5 某目标的全部活子任务：未完成在前、完成后沉底，各组按 createdAt 升序 */
  subtasksOfGoal(goalId: string): Promise<SubtaskRecord[]>
  /** v8.0 今日习惯：date 上该做的习惯 + 打卡状态 */
  habitDay(date: DateKey): Promise<HabitDay>
  /** v8.13 想法 tab：全量活想法，时间倒序（date 降序，同日 createdAt 降序）。UI 按天分组 + 分页 */
  notesAll(): Promise<NoteRecord[]>
  /** v8.42 回顾页复盘列表：全量活复盘，**日期倒序**（最新在前） */
  reviewsAll(): Promise<ReviewRecord[]>
  /** v9.10 每周/每月报告：唯一数据源，口径见 core/report.ts（UI / AI 都不得另起） */
  buildReport(kind: ReportKind, cursor: DateKey, opts?: ViewOpts): Promise<ReportData>
  /**
   * 清掉分类名缓存。
   *
   * 分类表在 v0 是固定 8 个、几乎不变，而翻日时每翻一天都要用它把 catId 换成中文名，
   * 所以缓存（CORE-API §6：「翻日时……不得重查分类表」）。
   * 代价是分类被改名/增删后必须调一次，否则显示旧名。**UI 在 categories 任何写操作后调用。**
   */
  invalidate(): void
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

interface DayBucket {
  todos: TodoRecord[]
  notes: NoteRecord[]
  expenses: ExpenseRecord[]
}

const emptyBucket = (): DayBucket => ({ todos: [], notes: [], expenses: [] })

/**
 * 完成归属日只认 doneOn（旧数据回退 doneAt），由 repo 的 todoDoneDay 统一提供。
 * doneAt 不参与任何显示/统计/逾期判断。
 */

/**
 * v8.79 日详情「可见待办」口径（进度另算，`todoProgress` 自己排除 rolledTo）：
 *  - **已顺延出去（rolledTo）的不显示**：内容已复制到目标日，源日是一条删不掉的痕迹，
 *    留着只会在历史日期上重复出现同一条待办。
 *  - **带截止日且已完成的，只在"完成归属日"显示**：
 *    v8.60 只过滤了「注入的那部分」，`date === deadline` 的记录走当天本地桶，
 *    绕过了过滤 —— 逾期完成后翻回截止日仍能看到它勾着挂在那里。现在两边同规则。
 *    v8.87 起 doneOn 记「勾选时正在查看的那一天」；doneAt 不再参与判断，
 *    所以过去补勾不会在今天再次出现。
 */
function visibleTodos(todos: readonly TodoRecord[], date: DateKey): TodoRecord[] {
  return todos.filter(
    (t) =>
      !t.rolledTo &&
      // v8.97：提醒型是单日事件——历史 date 未跟随 deadline 时，旧日期也不再显示
      todoOccurrenceDay(t) === date &&
      !(t.deadline && t.done && todoDoneDay(t) !== date),
  )
}

/**
 * v8.107 今日「目标推进」：把今天 `subtaskId` 非空的待办，按目标分组并补齐归属信息。
 *
 * 口径（用户已拍板）：
 *  - **只认被挑进来的**：`todos` 里带 `subtaskId` 的那条就是「今天要推进它」的唯一凭据，
 *    没有这条记录的子任务不出现在今日视图。
 *  - **不双显**：这些记录同时从待办列表里摘出去（DayDetail.todos 已过滤），
 *    所以待办计数也不再包含它们。
 *  - **打卡 ≠ 完成**：`done` 只表示今天打过卡，子任务自身完成与否不在这里判断，
 *    已完成的子任务当天仍可继续打卡。
 *  - 子任务被删（墓碑）→ 整条不再渲染（对应待办也随之成为孤儿，由用户自行删除）。
 */
const LEGACY_STAGE_PREFIX = /^第[一二三四五六七八九十百0-9]+阶段\s*[·:：-]\s*/

function cleanStageTitle(title: string): string {
  return title.replace(LEGACY_STAGE_PREFIX, '').trim()
}

function buildProgress(
  todos: readonly TodoRecord[],
  goals: readonly GoalRecord[],
  stages: readonly StageRecord[],
  subtasks: readonly SubtaskRecord[],
  date: DateKey,
): ProgressGroup[] {
  const goalMap = new Map(goals.filter((g) => !g.deleted).map((g) => [g.id, g]))
  const stageMap = new Map(stages.filter((s) => !s.deleted).map((s) => [s.id, s]))
  const subMap = new Map(subtasks.filter((s) => !s.deleted).map((s) => [s.id, s]))
  const groups = new Map<string, ProgressGroup>()

  for (const t of todos) {
    if (!t.subtaskId) continue
    const sub = subMap.get(t.subtaskId)
    if (!sub) continue
    const goal = goalMap.get(sub.goalId)
    // 阶段：优先子任务自己的阶段；没有归属时退到目标的「当前」阶段
    const stage = sub.stageId
      ? stageMap.get(sub.stageId)
      : stages.find((s) => !s.deleted && s.goalId === sub.goalId && s.isCurrent)
    let group = groups.get(sub.goalId)
    if (!group) {
      group = {
        goalId: sub.goalId,
        // 目标记录没了（理论上不会：删目标会连带墓碑子任务）→ 用待办里的标题快照兜底
        goalTitle: goal?.title ?? t.subtaskGoalTitle ?? '目标',
        stageTitle: stage ? cleanStageTitle(stage.title) || null : null,
        items: [],
      }
      groups.set(sub.goalId, group)
    }
    const workDates = Array.isArray(sub.workDates) ? sub.workDates : []
    const recent: boolean[] = []
    for (let i = 6; i >= 1; i -= 1) recent.push(workDates.includes(addDays(date, -i)))
    group.items.push({
      todoId: t.id,
      subtaskId: sub.id,
      text: sub.title,
      days: workDates.length,
      done: !!t.done,
      recent,
    })
  }

  // 顺序：todos 是按 id（uuid）索引取出的，天然乱序。这里统一按**子任务在目标里的
  // 创建顺序**排——与目标详情页看到的顺序一致，刷新/换设备都不会跳。
  const born = (subtaskId: string): number => subMap.get(subtaskId)?.createdAt ?? 0
  for (const group of groups.values()) {
    group.items.sort((a, b) => born(a.subtaskId) - born(b.subtaskId) || a.todoId.localeCompare(b.todoId))
  }
  return [...groups.values()].sort(
    (a, b) => born(a.items[0]!.subtaskId) - born(b.items[0]!.subtaskId) || a.goalId.localeCompare(b.goalId),
  )
}

/**
 * v8.53 合并「当天本地待办 + 注入的活跃 DDL 待办」：
 *  - 去重：DDL 待办 date=截止日，截止日当天的本地集合已含它，注入时跳过
 *  - 排序：带截止日的 DDL 置顶（截止日升序，逾期自然最前；同日 createdAt 升序兜底），
 *    普通待办保持 createdAt 升序
 * v8.54 修复：只注入「创建于查看日当天或之前」的 DDL——创建日晚于查看日的
 *    （翻到它还不存在的史前日子）不再出现。
 * v8.60 修复：完成的 DDL 不再"突然消失"——完成归属日当天仍注入（勾选保留显示），
 *    次日起不再注入，自然从今天视图消失。
 * v8.95：完成归属只认 doneOn；doneAt 只做审计，不再把过去补勾的 DDL 拖回今天。
 * v8.79：本地桶也套同一口径（见 visibleTodos），顺延源记录一并排除。
 */
function mergeDdlTodos(local: TodoRecord[], active: TodoRecord[], date: DateKey): TodoRecord[] {
  const localIds = new Set(local.map((t) => t.id))
  const injected = active.filter(
    (t) =>
      !localIds.has(t.id) &&
      keyOf(t.createdAt) <= date &&
      // v9.2.3 提醒型（timeType='at'）只在提醒日期当天显示，不逐日注入。
      // v9.16 修复：date（归桶日 = 创建日）不跟随 deadline——编辑改提醒日期后
      // date≠deadline，旧逻辑只在本地 date 桶显示，导致待办从 deadline 当天「消失」。
      // 现让 deadline===date 当天也注入（本地 date 桶兜底创建当天、无 deadline 的提醒型）。
      ((t.timeType ?? 'due') !== 'at' || t.deadline === date) &&
      // 未完成每天注入；已完成仅「完成归属日」保留，次日消失
      (!t.done || todoDoneDay(t) === date),
  )
  return [...visibleTodos(local, date), ...injected].sort((a, b) => {
    const da = a.deadline !== undefined
    const db = b.deadline !== undefined
    if (da !== db) return da ? -1 : 1
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline < b.deadline ? -1 : 1
    return (a.createdAt ?? 0) - (b.createdAt ?? 0)
  })
}

/**
 * v8.104 周视图待办预览排序。
 *
 * 截止型仍整体置顶（既有语义：截止任务先看到，避免漏 DDL），组内再按时间：
 * 有时间的按 `HH:mm` 升序，无时间的保持原序沉到组内末尾。
 * 只在「取前 3 条预览」这一步生效，不影响 todoDone/todoTotal 计数。
 */
function sortPreviewByTime(list: TodoRecord[]): TodoRecord[] {
  return list
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      // 1) 截止型在前（与原 mergeDdlTodos 一致）
      const da = a.t.deadline !== undefined ? 0 : 1
      const db = b.t.deadline !== undefined ? 0 : 1
      if (da !== db) return da - db
      // 2) 组内：有时间的在前，按时间升序
      const ta = a.t.time
      const tb = b.t.time
      if (!!ta !== !!tb) return ta ? -1 : 1
      if (ta && tb && ta !== tb) return ta < tb ? -1 : 1
      // 3) 同样没时间 / 同时刻：保持原序
      return a.i - b.i
    })
    .map((x) => x.t)
}

/**
 * v8.98 某一天的「逾期完成」历史痕迹（日视图用）。
 *
 * 只取：截止日 = 当天、截止型、已完成、且完成归属日晚于截止日的记录。
 * 这一条在日视图的 todos 里已经被 visibleTodos 排掉（它只属于完成日），
 * 所以单独返回，供截止日渲染一条“当时未完成”的灰色痕迹。
 * 不参与任何计数，提醒型不参与。
 */
function overdueTracesOn(records: readonly TodoRecord[], date: DateKey): OverdueTrace[] {
  const out: OverdueTrace[] = []
  for (const t of records) {
    if (!t.done || t.rolledTo) continue
    if ((t.timeType ?? 'due') !== 'due') continue
    if (!t.deadline || t.deadline !== date) continue
    const doneOn = todoDoneDay(t)
    if (!doneOn || doneOn <= t.deadline) continue
    out.push({ id: t.id, text: t.text, doneOn })
  }
  return out.sort((a, b) => (a.doneOn !== b.doneOn ? (a.doneOn < b.doneOn ? -1 : 1) : a.id < b.id ? -1 : 1))
}

/** buildRangeDetailed 的中间产物：指示器 + 原始记录 + 农历（周行预览要用后两个） */
interface DayBuild {
  agg: DayAggregate
  bucket: DayBucket
  info: LunarInfo | null
  /** v8.52 周视图格子显示复盘正文：范围查询里已拿到，直接带上（null = 当天没写复盘） */
  review: ReviewRecord | null
}

/** 把一批记录按 date 分桶。O(n)，不排序（`byDateAll` 已保证 date 升序 + 同日 createdAt 升序） */
function bucketize(data: {
  todos: TodoRecord[]
  notes: NoteRecord[]
  expenses: ExpenseRecord[]
}): Map<DateKey, DayBucket> {
  const m = new Map<DateKey, DayBucket>()
  const put = <T>(date: DateKey, rec: T, key: keyof DayBucket) => {
    let b = m.get(date)
    if (!b) {
      b = emptyBucket()
      m.set(date, b)
    }
    ;(b[key] as T[]).push(rec)
  }
  for (const r of data.todos) put(r.date, r, 'todos')
  for (const r of data.notes) put(r.date, r, 'notes')
  for (const r of data.expenses) put(r.date, r, 'expenses')
  return m
}

// ---------------------------------------------------------------------------
// 分类解析（PRD E21）
// ---------------------------------------------------------------------------

/** v0 固定 8 个分类里的兜底那一个（`DEFAULT_CATEGORIES` 末位） */
const OTHER_NAME = '其他'
/** 分类被删且连「其他」也不存在时的显示文案（PRD E21） */
export const DELETED_CAT_LABEL = '已删除分类'
/**
 * 占位 catId：E21 要求把删掉的分类**归入汇总的「其他」**；但若连「其他」也被删了，
 * 就得留一个独立的桶。真实 catId 是 UUID，撞不上这个字面量。
 */
const DELETED_CAT_ID = '__deleted_cat__'

/**
 * catId → 显示名。
 *
 * `categories.nameMap()` 只含**活着的**分类（`store.all()` 默认排墓碑），
 * 所以"查不到"就等于该分类已被删除或从来不存在 → 按 E21 归入「其他」，
 * 历史支出**不级联删除**，当日总额也**不受影响**（钱确实花掉了）。
 */
interface CatResolver {
  name(catId: string): string | null
  /** 活着的「其他」分类 id；用户把它也删了则为 null */
  otherId: string | null
}

function makeCatResolver(catMap: ReadonlyMap<string, string>): CatResolver {
  let otherId: string | null = null
  for (const [id, name] of catMap) {
    if (name === OTHER_NAME) {
      otherId = id
      break
    }
  }
  return { otherId, name: (catId) => catMap.get(catId) ?? null }
}

// ---------------------------------------------------------------------------
// 纪念日匹配（v7.5 扩展：weekly / monthly）
// ---------------------------------------------------------------------------

/**
 * 单日命中判定（纯函数）。
 *
 * - none：一次性，就是 date 本身（公历）或 date 指定年份的农历（农历一次性）
 * - yearly：每年同月日（公历按 MM-DD；农历走 lunar.lunarAnniversary，年份取目标年）
 * - monthly：每月同日号（date 的 DD；不存在的日期——如 2 月 31 日——自动不命中）
 * - weekly：每周同星期几（date 只是"参考日期"，取它的 dow）
 * - weekly / monthly 仅公历；农历 repeat 只允许 none / yearly（设置 UI 约束），
 *   防御性兜底：非法组合返回 false
 */
function annivHitsOn(r: AnniversaryRecord, date: DateKey, lunar: LunarApi | null): boolean {
  if (r.deleted) return false
  if (!r.isLunar) {
    switch (r.repeat) {
      case 'none':
        return isValidKey(r.date) && r.date === date
      case 'weekly':
        // r.date 是"参考日期"（公历 YYYY-MM-DD 定宽），只看星期几
        return dowOf(r.date as DateKey) === dowOf(date)
      case 'monthly':
        // 同日号。date 本身是合法存在的日期，所以不存在的日号天然不会命中
        return r.date.slice(8) === date.slice(8)
      case 'yearly':
        return r.date.slice(5) === date.slice(5)
    }
  }
  if (!lunar) return false
  if (r.repeat === 'none') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false
    return lunar.lunarAnniversary(r.date, Number(r.date.slice(0, 4)), r.isLeapMonth).key === date
  }
  if (r.repeat === 'yearly') {
    return lunar.lunarAnniversary(r.date, fromKey(date).y, r.isLeapMonth).key === date
  }
  return false
}

export { annivHitsOn }

export function createAggregates(deps: AggregateDeps): Aggregates {
  const { store, repos } = deps
  const lunar = deps.lunar ?? null

  /** 分类名缓存。见 `invalidate()` 的说明 */
  let names: Map<string, string> | null = null

  const catNames = async (): Promise<Map<string, string>> => {
    if (!names) names = await repos.categories.nameMap()
    return names
  }

  /**
   * 区间内每天命中的纪念日标题。
   *
   * 一次 `anniversaries.all()`（表很小）+ 逐日纯计算（周/月视图 7~42 天 × 纪念日数，
   * 微秒级），**不逐日查询**。weekly/monthly/yearly/一次性统一走 `annivHitsOn`。
   * 农历命中依赖 `lunar`——**农历库不可用时整类跳过**（PRD E4），
   * 公历纪念日必须照常显示，否则农历一挂连"妈妈生日"都没了。
   */
  const anniversaryTitles = async (
    from: DateKey,
    to: DateKey,
  ): Promise<Map<DateKey, string[]>> => {
    const out = new Map<DateKey, string[]>()
    const all = await repos.anniversaries.all()
    const recs = all.filter((r) => !r.deleted)
    if (recs.length === 0) return out

    for (const k of rangeKeys(from, to)) {
      for (const r of recs) {
        if (annivHitsOn(r, k, lunar)) {
          const a = out.get(k)
          if (a) a.push(r.title)
          else out.set(k, [r.title])
        }
      }
    }
    return out
  }

  /** 当天命中的 AnniversaryRecord（日视图要显示完整信息，不只是标题） */
  const anniversaryRecordsOn = async (date: DateKey): Promise<AnniversaryRecord[]> => {
    const all = await repos.anniversaries.all()
    return all.filter((r) => annivHitsOn(r, date, lunar))
  }

  // -------------------------------------------------------------------------
  // 目标与阶段（v7.9）
  // -------------------------------------------------------------------------

  const goalSummaries = async (): Promise<GoalSummary[]> => {
    const [goalsList, stagesList, subtasksList, foldersList] = await Promise.all([
      repos.goals.all(),
      store.all<StageRecord>('stages'),
      store.all<SubtaskRecord>('subtasks'),
      store.all<FolderRecord>('folders'),
    ])
    const live = goalsList.filter((g) => !g.deleted)
    // v9.14 文件夹映射：folderId → 活文件夹（墓碑/不存在的 folderId 一律未分类）
    const folderById = new Map<string, { id: string; name: string; collapsed: boolean }>()
    for (const f of foldersList) {
      if (f.deleted) continue
      folderById.set(f.id, { id: f.id, name: f.name, collapsed: f.collapsed ?? false })
    }
    const stageGroups = new Map<string, StageRecord[]>()
    for (const s of stagesList) {
      if (s.deleted) continue
      const a = stageGroups.get(s.goalId)
      if (a) a.push(s)
      else stageGroups.set(s.goalId, [s])
    }
    // v8.7：子任务计数（活记录，不含墓碑）
    const subtaskGroups = new Map<string, number>()
    // v8.45：目标已进行天数 = 子任务 workDates 并集（去重）。按目标累加日期到 Set
    const activeDaySets = new Map<string, Set<string>>()
    for (const t of subtasksList) {
      if (t.deleted) continue
      subtaskGroups.set(t.goalId, (subtaskGroups.get(t.goalId) ?? 0) + 1)
      const dates = t.workDates
      if (!Array.isArray(dates) || dates.length === 0) continue
      let set = activeDaySets.get(t.goalId)
      if (!set) {
        set = new Set()
        activeDaySets.set(t.goalId, set)
      }
      for (const d of dates) set.add(d)
    }
    // 进行中的在前（createdAt 升序）、已完成的沉底（createdAt 降序，最新完成在前），
    // UI 据此分成「进行中 / 已完成」两组。旧记录 done 缺省 → 归一化 false
    const sorted = [...live].sort((a, b) => {
      const ad = a.done ?? false
      const bd = b.done ?? false
      if (ad !== bd) return ad ? 1 : -1
      // v8.43 目标收藏：收藏置顶；收藏内部按收藏时间新的在前（favoritedAt 倒序）；
      // 未收藏的维持 createdAt 升序。完成的目标不参与置顶（已完成组内也不按收藏排）
      const af = a.favorite ?? false
      const bf = b.favorite ?? false
      if (af !== bf) return af ? -1 : 1
      if (af && bf) return (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0)
      return a.createdAt - b.createdAt
    })
    return sorted.map((goal) => {
      const stages = stageGroups.get(goal.id) ?? []
      const cur = stages.find((s) => s.isCurrent) ?? null
      return {
        // done 归一化：旧记录/旧备份无此字段，UI 一律拿到 boolean
        goal: { ...goal, done: goal.done ?? false, favorite: goal.favorite ?? false },
        stageCount: stages.length,
        subtaskCount: subtaskGroups.get(goal.id) ?? 0,
        current: cur ? { id: cur.id, title: cur.title } : null,
        activeDays: activeDaySets.get(goal.id)?.size ?? 0,
        // v9.14 folderId 归一化：无字段/指向已删文件夹 → null（未分类）
        folder: goal.folderId ? (folderById.get(goal.folderId) ?? null) : null,
      }
    })
  }

  /** v9.14 文件夹列表：活文件夹，收藏置顶（内部按收藏时间新的在前）+ createdAt 升序；附目标数（读路径归一化后） */
  const foldersAll = async (): Promise<FolderSummary[]> => {
    const [folderList, goalsList] = await Promise.all([repos.folders.all(), repos.goals.all()])
    const liveFolders = [...folderList].sort((a, b) => {
      const af = a.favorite ?? false
      const bf = b.favorite ?? false
      if (af !== bf) return af ? -1 : 1
      if (af && bf) return (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0)
      return a.createdAt - b.createdAt
    })
    const liveGoals = goalsList.filter((g) => !g.deleted)
    return liveFolders.map((folder) => ({
      folder,
      // folderId === 本文件夹的目标数；指向已删文件夹/无字段的目标天然归未分类（不进任何文件夹计数）
      count: liveGoals.filter((g) => g.folderId === folder.id).length,
    }))
  }

  const stagesOfGoal = async (goalId: string): Promise<StageRecord[]> => {
    const all = await store.all<StageRecord>('stages')
    const live = all.filter((s) => s.goalId === goalId && !s.deleted)
    // v9.46 阶段纯 createdAt 升序：当前阶段不置顶，列表顺序即时间线
    return [...live].sort((a, b) => a.createdAt - b.createdAt)
  }

  const subtasksOfGoal = async (goalId: string): Promise<SubtaskRecord[]> => {
    const all = await store.all<SubtaskRecord>('subtasks')
    const live = all.filter((s) => s.goalId === goalId && !s.deleted)
    // v9.46 子任务纯 createdAt 升序：完成不改变组内顺序，避免勾选后行跳动
    return [...live].sort((a, b) => a.createdAt - b.createdAt)
  }

  /**
   * 一天的指示器。纯计算，不发查询——所有输入都由调用方一次取好。
   */
  const buildDay = (
    date: DateKey,
    b: DayBucket,
    anniv: readonly string[],
    info: LunarInfo | null,
    cats: CatResolver,
    review: ReviewRecord | null = null,
  ): DayAggregate => {
    // v8.79 进度按「可见待办」算，与日详情/周行同一口径：
    // 不显示的东西也不该出现在 1/3、+N 项待办这类计数里
    const visible = visibleTodos(b.todos, date)
    const { done, total } = todoProgress(visible)

    let costCents = 0
    const perCat = new Map<string, number>()
    for (const e of b.expenses) {
      costCents += e.amountCents
      // PRD E21：分类已删 → 这笔钱并进「其他」的桶，不单独成行
      const key = cats.name(e.catId) !== null ? e.catId : (cats.otherId ?? DELETED_CAT_ID)
      perCat.set(key, (perCat.get(key) ?? 0) + e.amountCents)
    }
    const byCat: CatSlice[] = [...perCat.entries()]
      .map(([catId, cents]) => ({
        catId,
        name: cats.name(catId) ?? DELETED_CAT_LABEL,
        cents,
      }))
      // 金额降序；同额按 catId，避免 Map 迭代序泄漏成不确定的输出
      .sort((x, y) => (y.cents !== x.cents ? y.cents - x.cents : x.catId < y.catId ? -1 : 1))

    return {
      date,
      todoDone: done,
      todoTotal: total,
      noteCount: b.notes.length,
      costCents,
      byCat,
      anniversaries: [...anniv],
      label: cellLabel(info, anniv),
      hasReview: review !== null,
      // v8.79：空态判定与展示口径一致（顺延痕迹、完成在别的日子的 DDL 都不算"这天的内容"）
      isEmpty: visible.length === 0 && b.notes.length === 0 && b.expenses.length === 0,
    }
  }

  /**
   * 取 `[from, to]` 的全部数据并逐日建好 DayAggregate。
   * 三个视图共用这一条路径，**查询次数固定为 3**，与区间天数无关。
   */
  const buildRangeDetailed = async (keys: readonly DateKey[]): Promise<DayBuild[]> => {
    if (keys.length === 0) return []
    const from = keys[0]!
    const to = keys[keys.length - 1]!

    // 三次并发：byDateAll 内部已是单事务三请求，另两个是各自的小表全量
    // v8.42 加第四路：reviews 走 byDate 范围查询（不 all()），建 date→review 映射算 hasReview
    const [data, anniv, catMap, reviewRows] = await Promise.all([
      store.byDateAll(from, to),
      anniversaryTitles(from, to),
      catNames(),
      store.byDate<ReviewRecord>('reviews', from, to),
    ])

    const buckets = bucketize(data)
    const cats = makeCatResolver(catMap)
    const reviewsByDate = new Map<string, ReviewRecord>()
    for (const r of reviewRows) if (!r.deleted) reviewsByDate.set(r.date, r)
    return keys.map((k) => {
      const bucket = buckets.get(k) ?? emptyBucket()
      const info = lunar?.lunarOf(k) ?? null
      const review = reviewsByDate.get(k) ?? null
      return {
        agg: buildDay(k, bucket, anniv.get(k) ?? [], info, cats, review),
        bucket,
        info,
        review,
      }
    })
  }

  const buildRange = async (keys: readonly DateKey[]): Promise<DayAggregate[]> =>
    (await buildRangeDetailed(keys)).map((d) => d.agg)

  // v8.20：从全量习惯 + 打卡集合算出 date 上该做的习惯项（暂停/不命中的排除）。
  // habitDay 与 aggregateDayDetail 共用，保证日详情与今日习惯区块口径一致。
  // v8.57：习惯只从「设定那天」起存在——翻到创建之前的日期不再出现（与 v8.54 DDL 同构，keyOf(createdAt) <= date）。
  const buildHabitItems = (
    habits: readonly HabitRecord[],
    done: ReadonlySet<string>,
    date: DateKey,
  ): HabitDayItem[] => {
    const dow = dowOf(date)
    const items: HabitDayItem[] = []
    // v9.37：按用户拖拽的 order 排（此前按 getAll 原始顺序，设置页改了今日区块也不跟着变）
    for (const h of sortHabits([...habits])) {
      if (h.deleted || h.paused) continue // 暂停的习惯不出现在今日（设置页仍可见）
      if (keyOf(h.createdAt) > date) continue // 创建日晚于查看日 → 设定之前的日子不出现
      const due = h.freq.kind === 'daily' || h.freq.weekdays.includes(dow)
      if (!due) continue // 每周模式：今天不在选中星期 → 不出现
      items.push({ id: h.id, name: h.name, freq: h.freq, done: done.has(h.id) })
    }
    return items
  }

  return {
    async aggregateDay(date) {
      const [d] = await buildRange([date])
      return d!
    },

    async aggregateWeek(cursor, opts) {
      const keys = weekKeys(cursor, opts?.weekStartsOn ?? 1)
      const built = await buildRangeDetailed(keys)
      // v8.62 周行习惯预览（形态 B）：每日该做习惯 + 打卡态，与日详情/今日区块同口径
      // （buildHabitItems：排除删除/暂停，只从设定那天起出现，freq 命中才列出）。
      // 数据层无条件带，UI 按「周视图显示习惯」开关渲染。
      const [habits, dones, ddl] = await Promise.all([
        store.all<HabitRecord>('habits'),
        Promise.all(keys.map((k) => repos.checkins.doneOn(k))),
        repos.todos.ddlAll(),
      ])

      // v8.95 截止任务在周视图的两种落点：
      //  1) 已完成：归位到完成归属日（日期行只显示它，不吞掉）；
      //  2) 逾期完成：截止日再留一条「当时未完成」的痕迹（不计入 0/1，避免同周重复统计）。
      // 未完成 / 逾期未完成的截止任务不额外注入，仍只在截止日那一行。
      // 提醒型没有截止语义：不参与完成日归位，也绝不生成逾期痕迹。
      const completedByDoneDay = new Map<DateKey, TodoRecord[]>()
      const overdueByDeadline = new Map<DateKey, OverdueTrace[]>()
      for (const t of ddl) {
        if (!t.done || t.rolledTo) continue
        if ((t.timeType ?? 'due') !== 'due') continue
        const deadline = t.deadline
        if (!deadline) continue
        const doneOn = todoDoneDay(t)
        if (!doneOn) continue

        if (doneOn !== t.date && keys.includes(doneOn)) {
          const list = completedByDoneDay.get(doneOn) ?? []
          list.push(t)
          completedByDoneDay.set(doneOn, list)
        }

        // 完成归属日晚于截止日，才在截止日造「当时未完成」痕迹。
        if (doneOn > deadline && keys.includes(deadline)) {
          const list = overdueByDeadline.get(deadline) ?? []
          list.push({ id: t.id, text: t.text, doneOn })
          overdueByDeadline.set(deadline, list)
        }
      }
      for (const list of overdueByDeadline.values()) {
        list.sort((a, b) => (a.doneOn !== b.doneOn ? (a.doneOn < b.doneOn ? -1 : 1) : a.id < b.id ? -1 : 1))
      }

      const days: WeekDay[] = built.map(({ agg, bucket, info, review }, i) => {
        const date = keys[i]!
        const completed = completedByDoneDay.get(date) ?? []
        const trace = overdueByDeadline.get(date) ?? []
        // mergeDdlTodos 负责：按 id 去重、按完成归属日过滤、DDL 置顶排序。
        // 完成日传入当天归位的已完成 DDL，于是计数与预览同时正确。
        const visible = mergeDdlTodos(bucket.todos, completed, date)
        return {
          ...agg,
          todoDone: visible.filter((t) => t.done).length,
          todoTotal: visible.length,
          // v8.104 预览按时间排：截止型置顶，组内有时间升序、无时间沉底
          todoPreview: sortPreviewByTime(visible).slice(0, 3),
          overdueTrace: trace,
          notePreview: bucket.notes.slice(0, 2),
          reviewPreview: review ? { id: review.id, text: review.text } : null,
          habitPreview: buildHabitItems(habits, dones[i] ?? new Set<string>(), date),
          lunarDay: info?.lunarDay,
          // 只有逾期痕迹也算「有内容」，否则会被误判成「空白的一天」
          isEmpty: agg.isEmpty && visible.length === 0 && trace.length === 0,
        }
      })

      const total: WeekTotal = { todoDone: 0, todoTotal: 0, daysWithNotes: 0, costCents: 0 }
      for (const d of days) {
        total.todoDone += d.todoDone
        total.todoTotal += d.todoTotal
        total.costCents += d.costCents
        if (d.noteCount > 0) total.daysWithNotes += 1
      }
      return { days, total }
    },

    async aggregateMonth(cursor, opts) {
      // 恒 42 格：包含上月尾与下月头的补齐日，视图不需要自己算
      return buildRange(monthGrid(cursor, opts?.weekStartsOn ?? 1))
    },

    async monthSummary(cursor) {
      const keys = monthKeys(cursor)
      const days = await buildRange(keys)
      let daysWithRecords = 0
      let costCents = 0
      for (const d of days) {
        if (!d.isEmpty) daysWithRecords += 1
        costCents += d.costCents
      }
      return { daysWithRecords, costCents }
    },

    async aggregateDayDetail(date) {
      const prev = addDays(date, -1)

      // ⚠️ 区间开成 [date-1, date]：一次查询同时拿到「今天的内容」和
      //    「昨天有几条待办可顺延」。不要为了后者再发一次 byDateAll。
      // v8.20 加 habits 全量 + 打卡集合：日详情带当日习惯（侧页与落地一致渲染）。
      // v8.29 加纪念日勾选集合（annivDones）。
      // v8.53 加第九路 activeDdl：活跃 DDL 待办注入"每天出现"。
      // v8.60 改用 ddlAll（含已完成）：完成当天保留显示，次日起不再注入。
      // v8.107 加第十到十二路 goals/stages/subtasks：拼「目标推进」的归属信息（目标名、阶段、workDates）。
      // 三张都是小表，内存过滤；aggregateDayDetail 的查询次数因此从 9 路升到 12 路。
      const [
        data,
        annivTitles,
        catMap,
        annivRecs,
        habits,
        done,
        annivDone,
        review,
        ddl,
        goalsAll,
        stagesAll,
        subtasksAll,
      ] = await Promise.all([
        store.byDateAll(prev, date),
        anniversaryTitles(date, date),
        catNames(),
        anniversaryRecordsOn(date),
        store.all<HabitRecord>('habits'),
        repos.checkins.doneOn(date),
        repos.annivChecks.doneOn(date),
        // v8.42 当日复盘（每日一条）
        repos.reviews.byDate(date),
        repos.todos.ddlAll(),
        store.all<GoalRecord>('goals'),
        store.all<StageRecord>('stages'),
        store.all<SubtaskRecord>('subtasks'),
      ])

      const buckets = bucketize(data)
      const today = buckets.get(date) ?? emptyBucket()
      const yesterday = buckets.get(prev) ?? emptyBucket()

      const cats = makeCatResolver(catMap)
      const info = lunar?.lunarOf(date) ?? null
      const titles = annivTitles.get(date) ?? []
      const progress = buildProgress(today.todos, goalsAll, stagesAll, subtasksAll, date)
      // v8.107 子任务来源的待办已挪进「目标推进」：待办列表与 0/3 计数都不再含它们（同一件事不双显）
      const plainTodos = today.todos.filter((t) => !t.subtaskId)
      const base = buildDay(date, { ...today, todos: plainTodos }, titles, info, cats, review)
      const overdueTrace = overdueTracesOn(ddl, date)
      const summary = overdueTrace.length > 0 || progress.length > 0
        ? { ...base, isEmpty: false }
        : base

      return {
        date,
        // v8.98 只有逾期痕迹也算「有内容」，否则日视图会误显示「这一天还什么都没有」。
        // v8.107 只有「目标推进」也算有内容。
        summary,
        // v8.53：todos = 当天本地待办 + 注入的活跃 DDL（截止日当天去重）。
        // 排序：带截止日的 DDL 置顶（截止日升序，逾期自然最前），普通待办保持 createdAt 升序。
        // ⚠️ 进度（todoTotal/todoDone）**不含**注入的 DDL 项——DDL 是跨天任务，不稀释每天的进度。
        todos: mergeDdlTodos(plainTodos, ddl, date),
        overdueTrace,
        notes: today.notes,
        expenses: today.expenses,
        anniversaries: annivRecs,
        annivDones: [...annivDone],
        lunar: info,
        prevDayRollable: yesterday.todos.filter(isRollable).length,
        habits: buildHabitItems(habits, done, date),
        review: review ? { id: review.id, text: review.text } : null,
        progress,
      }
    },

    goalSummaries,
    foldersAll,
    stagesOfGoal,
    subtasksOfGoal,

    // -----------------------------------------------------------------------
    // 习惯（v8.0）：date 上「今天该做的习惯」+ 打卡状态
    // -----------------------------------------------------------------------

    async habitDay(date) {
      const [habits, done] = await Promise.all([
        store.all<HabitRecord>('habits'),
        repos.checkins.doneOn(date),
      ])
      const items = buildHabitItems(habits, done, date)
      return {
        date,
        items,
        doneCount: items.filter((x) => x.done).length,
        dueCount: items.length,
      }
    },

    /**
     * v8.13 想法 tab 数据源。全量活想法（store.all 默认排墓碑；再显式 filter 防呆），
     * 时间倒序：date 降序、同日 createdAt 降序（最新的想法在最上）。
     * 返回浅拷贝，避免 UI 侧意外改动污染 store 内引用。
     */
    async notesAll() {
      const all = await store.all<NoteRecord>('notes')
      return all
        .filter((r) => !r.deleted)
        .map((r) => ({ ...r }))
        .sort((a, b) => {
          // v8.24 收藏置顶：pinned 优先；同收藏态再按 date 降序、同日 createdAt 降序
          const ap = a.pinned ? 1 : 0
          const bp = b.pinned ? 1 : 0
          if (ap !== bp) return bp - ap
          return a.date === b.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date)
        })
    },

    /** v8.42 复盘列表：日期倒序（最新在前）；同日只可能有一条 */
    async reviewsAll() {
      const all = await store.all<ReviewRecord>('reviews')
      return all
        .filter((r) => !r.deleted)
        .map((r) => ({ ...r }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },

    /** v9.10 每周/每月报告：数据口径全部收敛在 core/report.ts */
    buildReport(kind, cursor, opts) {
      return buildReport({
        kind,
        cursor,
        weekStartsOn: opts?.weekStartsOn ?? 1,
        store,
        repos,
        lunar,
      })
    },

    invalidate() {
      names = null
    },
  }
}

export { formatMoney, formatMoneyCsv, formatMoneyShort } from './money'
