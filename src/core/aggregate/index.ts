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
  fromKey,
  isValidKey,
  monthGrid,
  monthKeys,
  weekKeys,
  type WeekStartsOn,
} from '../date'
import { cellLabel, type CellLabel } from '../label'
import { resolveSolarAnniversary, type LunarApi, type LunarInfo } from '../lunar'
import { isRollable, todoProgress, type Repos } from '../repo'
import type { RecordStore } from '../store/types'
import type {
  AnniversaryRecord,
  DateKey,
  ExpenseRecord,
  NoteRecord,
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
   *    所以这天不算"空白"。纪念日不计入——它不是用户写的东西，
   *    一天只有纪念日时仍然要走 v6.1 的"空白日自动展开待办表单"。
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
  aggregateWeek(cursor: DateKey, opts?: ViewOpts): Promise<{ days: DayAggregate[]; total: WeekTotal }>
  aggregateMonth(cursor: DateKey, opts?: ViewOpts): Promise<DayAggregate[]>
  monthSummary(cursor: DateKey): Promise<MonthSummary>
  aggregateDayDetail(date: DateKey): Promise<DayDetail>
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

/** 区间覆盖到的年份。42 格的月视图最多跨 2 年（跨年那一格） */
function yearsOf(from: DateKey, to: DateKey): number[] {
  const a = fromKey(from).y
  const b = fromKey(to).y
  const out: number[] = []
  for (let y = a; y <= b; y++) out.push(y)
  return out
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

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
   * 一次 `anniversaries.all()`（表很小）+ 纯计算，**不逐日查询**。
   * 公历走 `resolveSolarAnniversary`（纯函数，不依赖农历库），
   * 农历走 `lunar.lunarAnniversary`——**农历库不可用时整类跳过**（PRD E4），
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

    const years = yearsOf(from, to)
    const push = (k: DateKey | null, title: string): void => {
      // 'YYYY-MM-DD' 定宽，字典序即时间序，可以直接比
      if (k === null || k < from || k > to) return
      const a = out.get(k)
      if (a) a.push(title)
      else out.set(k, [title])
    }

    for (const r of recs) {
      if (!r.isLunar) {
        if (r.repeat === 'none') {
          // 一次性公历：就是它自己那一天，不做年份替换
          if (isValidKey(r.date)) push(r.date, r.title)
        } else {
          for (const y of years) push(resolveSolarAnniversary(r.date, y).key, r.title)
        }
        continue
      }
      // 农历纪念日
      if (!lunar) continue
      if (r.repeat === 'none') {
        // 一次性农历：年份有意义（type 注释说的"年份被忽略"只针对 yearly）
        const y = /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? Number(r.date.slice(0, 4)) : null
        if (y !== null) push(lunar.lunarAnniversary(r.date, y, r.isLeapMonth).key, r.title)
      } else {
        for (const y of years) {
          push(lunar.lunarAnniversary(r.date, y, r.isLeapMonth).key, r.title)
        }
      }
    }
    return out
  }

  /** 当天命中的 AnniversaryRecord（日视图要显示完整信息，不只是标题） */
  const anniversaryRecordsOn = async (date: DateKey): Promise<AnniversaryRecord[]> => {
    const all = await repos.anniversaries.all()
    const y = fromKey(date).y
    return all.filter((r) => {
      if (r.deleted) return false
      if (!r.isLunar) {
        if (r.repeat === 'none') return isValidKey(r.date) && r.date === date
        return resolveSolarAnniversary(r.date, y).key === date
      }
      if (!lunar) return false
      if (r.repeat === 'none') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return false
        return lunar.lunarAnniversary(r.date, Number(r.date.slice(0, 4)), r.isLeapMonth).key === date
      }
      return lunar.lunarAnniversary(r.date, y, r.isLeapMonth).key === date
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
  const buildRange = async (keys: readonly DateKey[]): Promise<DayAggregate[]> => {
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
    return keys.map((k) =>
      buildDay(k, buckets.get(k) ?? emptyBucket(), anniv.get(k) ?? [], lunar?.lunarOf(k) ?? null, cats),
    )
  }

  return {
    async aggregateDay(date) {
      const [d] = await buildRange([date])
      return d!
    },

    async aggregateWeek(cursor, opts) {
      const keys = weekKeys(cursor, opts?.weekStartsOn ?? 1)
      const days = await buildRange(keys)

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

    invalidate() {
      names = null
    },
  }
}

export { formatMoney, formatMoneyCsv, formatMoneyShort } from './money'
