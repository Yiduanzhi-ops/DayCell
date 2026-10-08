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
 * | `aggregateDayDetail` | **仍是 3 次**——见下 | ≤ 20 ms（v6 首屏关键路径） |
 *
 * `aggregateDayDetail` 还要「前一天未完成待办数」来画顺延横幅。**不是**再查一次，
 * 而是把区间开成 `[date-1, date]` 一次取两天，然后按 date 劈开。多要一天数据的代价
 * 远小于多一次 IndexedDB 往返。
 *
 * **禁止**（code review 检查项）：在循环里开事务 / 用 `all()` 拿内容记录再在内存里过滤日期 /
 * 逐日调用 `aggregateDay` 拼月视图（42 × 3 = 126 次查询）。
 */

import {
  addDays,
  dowOf,
  fromKey,
  isValidKey,
  monthGrid,
  monthKeys,
  rangeKeys,
  weekKeys,
  type WeekStartsOn,
} from '../date'
import { cellLabel, type CellLabel } from '../label'
import type { LunarApi, LunarInfo } from '../lunar'
import { isRollable, todoProgress, type Repos } from '../repo'
import type { RecordStore } from '../store/types'
import type {
  AnniversaryRecord,
  DateKey,
  ExpenseRecord,
  GoalRecord,
  HabitFreq,
  HabitRecord,
  NoteRecord,
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
  /** 均**排除 rolledTo**（PRD US-04：顺延出去的不再算这天的进度） */
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
  /**
   * 三类内容**皆无**（已排墓碑）→ 视图渲染空状态。
   *
   * ⚠️ **含 rolledTo 的待办**：那条记录仍属于这一天、仍会显示（划线态），
   *    所以这天不算"空白"。纪念日不计入——它不是用户写的东西。
   *    （v6.1 曾用此语义驱动"空白日自动展开待办表单"，v7.2 已移除该机制，
   *    isEmpty 现只被 UI 的空状态文案消费。）
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
  /** 想法的前 2 条（UI 负责每条 2 行截断） */
  notePreview: NoteRecord[]
  /** 原始农历日（'十五'）。label 是节日/节气/纪念日时，UI 拼「中秋节 · 十五」用 */
  lunarDay?: string
}

/** 日视图（v6 的默认落地页）的唯一数据源：计数 + **全文** */
export interface DayDetail {
  date: DateKey
  summary: DayAggregate
  /** 已排序（createdAt 升序）、已排墓碑；**含 rolledTo 项**——进度计算要自己排除它们 */
  todos: TodoRecord[]
  notes: NoteRecord[]
  expenses: ExpenseRecord[]
  anniversaries: AnniversaryRecord[]
  /** 农历不可用为 null（PRD E4），UI 只渲染公历 */
  lunar: LunarInfo | null
  /** 前一天可顺延的待办数。> 0 时显示横幅（PRD D5 / E10）；顺带返回，省一次查询 */
  prevDayRollable: number
}

export interface MonthSummary {
  /** **只数本月**的天（不含月格前后补齐的邻月日期） */
  daysWithRecords: number
  costCents: number
}

/** v7.9 目标列表的一行（列表页唯一数据源） */
export interface GoalSummary {
  goal: GoalRecord
  /** 活阶段数（不含墓碑） */
  stageCount: number
  /** 当前阶段（无则 null：目标建了但没阶段/当前阶段被删/已完成） */
  current: { id: string; title: string; pct?: number } | null
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
  /** v7.9 某目标的全部活阶段：当前置顶，其余按 createdAt 升序 */
  stagesOfGoal(goalId: string): Promise<StageRecord[]>
  /** v8.5 某目标的全部活子任务：未完成在前、完成后沉底，各组按 createdAt 升序 */
  subtasksOfGoal(goalId: string): Promise<SubtaskRecord[]>
  /** v8.0 今日习惯：date 上该做的习惯 + 打卡状态 */
  habitDay(date: DateKey): Promise<HabitDay>
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

/** buildRangeDetailed 的中间产物：指示器 + 原始记录 + 农历（周行预览要用后两个） */
interface DayBuild {
  agg: DayAggregate
  bucket: DayBucket
  info: LunarInfo | null
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
    const [goalsList, stagesList] = await Promise.all([
      repos.goals.all(),
      store.all<StageRecord>('stages'),
    ])
    const live = goalsList.filter((g) => !g.deleted)
    const stageGroups = new Map<string, StageRecord[]>()
    for (const s of stagesList) {
      if (s.deleted) continue
      const a = stageGroups.get(s.goalId)
      if (a) a.push(s)
      else stageGroups.set(s.goalId, [s])
    }
    // 进行中的在前（createdAt 升序）、已完成的沉底（createdAt 降序，最新完成在前），
    // UI 据此分成「进行中 / 已完成」两组。旧记录 done 缺省 → 归一化 false
    const sorted = [...live].sort((a, b) => {
      const ad = a.done ?? false
      const bd = b.done ?? false
      if (ad !== bd) return ad ? 1 : -1
      return a.createdAt - b.createdAt
    })
    return sorted.map((goal) => {
      const stages = stageGroups.get(goal.id) ?? []
      const cur = stages.find((s) => s.isCurrent) ?? null
      return {
        // done 归一化：旧记录/旧备份无此字段，UI 一律拿到 boolean
        goal: { ...goal, done: goal.done ?? false },
        stageCount: stages.length,
        current: cur ? { id: cur.id, title: cur.title, pct: cur.pct } : null,
      }
    })
  }

  const stagesOfGoal = async (goalId: string): Promise<StageRecord[]> => {
    const all = await store.all<StageRecord>('stages')
    const live = all.filter((s) => s.goalId === goalId && !s.deleted)
    // 当前置顶，其余按 createdAt 升序（列表即时间线）
    return [...live].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
      return a.createdAt - b.createdAt
    })
  }

  const subtasksOfGoal = async (goalId: string): Promise<SubtaskRecord[]> => {
    const all = await store.all<SubtaskRecord>('subtasks')
    const live = all.filter((s) => s.goalId === goalId && !s.deleted)
    // 未完成在前、完成后沉底，各组内按 createdAt 升序
    return [...live].sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1
      return a.createdAt - b.createdAt
    })
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
  ): DayAggregate => {
    const { done, total } = todoProgress(b.todos)

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
      isEmpty: b.todos.length === 0 && b.notes.length === 0 && b.expenses.length === 0,
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
    const [data, anniv, catMap] = await Promise.all([
      store.byDateAll(from, to),
      anniversaryTitles(from, to),
      catNames(),
    ])

    const buckets = bucketize(data)
    const cats = makeCatResolver(catMap)
    return keys.map((k) => {
      const bucket = buckets.get(k) ?? emptyBucket()
      const info = lunar?.lunarOf(k) ?? null
      return {
        agg: buildDay(k, bucket, anniv.get(k) ?? [], info, cats),
        bucket,
        info,
      }
    })
  }

  const buildRange = async (keys: readonly DateKey[]): Promise<DayAggregate[]> =>
    (await buildRangeDetailed(keys)).map((d) => d.agg)

  return {
    async aggregateDay(date) {
      const [d] = await buildRange([date])
      return d!
    },

    async aggregateWeek(cursor, opts) {
      const keys = weekKeys(cursor, opts?.weekStartsOn ?? 1)
      const built = await buildRangeDetailed(keys)
      const days: WeekDay[] = built.map(({ agg, bucket, info }) => ({
        ...agg,
        // 周行只展示活跃待办（已顺延出去的淡化在日详情里看，不占周行）
        todoPreview: bucket.todos.filter((t) => !t.rolledTo).slice(0, 3),
        notePreview: bucket.notes.slice(0, 2),
        lunarDay: info?.lunarDay,
      }))

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
      const [data, annivTitles, catMap, annivRecs] = await Promise.all([
        store.byDateAll(prev, date),
        anniversaryTitles(date, date),
        catNames(),
        anniversaryRecordsOn(date),
      ])

      const buckets = bucketize(data)
      const today = buckets.get(date) ?? emptyBucket()
      const yesterday = buckets.get(prev) ?? emptyBucket()

      const cats = makeCatResolver(catMap)
      const info = lunar?.lunarOf(date) ?? null
      const titles = annivTitles.get(date) ?? []

      return {
        date,
        summary: buildDay(date, today, titles, info, cats),
        todos: today.todos,
        notes: today.notes,
        expenses: today.expenses,
        anniversaries: annivRecs,
        lunar: info,
        prevDayRollable: yesterday.todos.filter(isRollable).length,
      }
    },

    goalSummaries,
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
      const dow = dowOf(date)
      const items: HabitDayItem[] = []
      for (const h of habits) {
        if (h.deleted || h.paused) continue // 暂停的习惯不出现在今日（设置页仍可见）
        const due = h.freq.kind === 'daily' || h.freq.weekdays.includes(dow)
        if (!due) continue // 每周模式：今天不在选中星期 → 不出现
        items.push({ id: h.id, name: h.name, freq: h.freq, done: done.has(h.id) })
      }
      return {
        date,
        items,
        doneCount: items.filter((x) => x.done).length,
        dueCount: items.length,
      }
    },

    invalidate() {
      names = null
    },
  }
}

export { formatMoney, formatMoneyCsv, formatMoneyShort } from './money'
