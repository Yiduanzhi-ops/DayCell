/**
 * core/report —— 每周 / 每月报告的唯一数据源（v9.10）。
 *
 * 存在的理由（同 aggregate）：报告不应该让 UI 自己拼数据——把"完成率怎么算、
 * 特殊日怎么命中、习惯 streak 怎么数、顺延怎么排除"的规则复制到渲染层，
 * 就会各自漂移。这里集中定义口径，UI 只消费。
 *
 * ## 统计口径（写死在这里，UI / AI 都不得另起）
 *
 * - **区间**：周 = 周一起 7 天（weekStartsOn）；月 = 自然月天数。
 * - **待办完成**：doneAt 落在区间内的完成（date 在不在区间都算——10-29 建、
 *   11-2 勾掉的待办计入 11 月完成），老数据无 doneAt 时按 done && date 在区间；
 *   记录 date 在区间、非 rolledTo（顺延出去的不算，同 aggregate）。
 *   总待办 = date 在区间的记录 ∪ 区间内完成（去重）。
 * - **顺延**：rolledFrom 落在区间的条数（= 区间内被顺延出去的次数）。
 * - **逾期**：区间内出现过（date 或 deadline 在区间）、至今未完成、deadline < 今天的
 *   DDL 待办数——语义是"拖到现在还欠着"。
 * - **特殊日**：区间内每天 × 全量纪念日，复用 aggregate 的 `annivHitsOn`
 *   （yearly/monthly/weekly/none + 农历），勾选与否看 annivchecks。
 * - **习惯**：暂停的习惯不出现；due = 区间内"该习惯应该打卡"的天数
 *   （daily = 区间天数；weekly = 命中星期几的天数）；streak = 区间内最长连续打卡段。
 * - **目标**：活目标；子任务完成/总数 = 该目标活子任务；workDays = workDates 与区间的交集天数。
 * - **活跃天数**：区间内有待办 / 想法 / 打卡 / 复盘的天数（纪念日不算，它不是用户写的）。
 *
 * ## 性能纪律（对齐 aggregate）
 *
 * - 内容记录走 `store.byDate` 区间查询（3 次：todos / notes / reviews）。
 * - 小表（纪念日 / 目标 / 子任务 / 习惯 / 打卡 / 勾选）走一次 `all()` 全量，
 *   与 aggregate 的 `anniversaries.all()` 同款——打卡表很小（每天每习惯一条），
 *   repo 的 doneOn 本来就是全表扫内存过滤（见 repo/index.ts 注释）。
 * - **禁止**：循环里逐日查 / 用 all() 拿内容记录再内存过滤日期。
 */

import { annivHitsOn } from './aggregate'
import { compareKey, daysBetween, dowOf, fromKey, keyOf, monthKeys, startOfWeek, weekKeys, type WeekStartsOn } from './date'
import type { LunarApi } from './lunar'
import type { RecordStore } from './store/types'
import type { Repos } from './repo'
import type {
  AnnivCheckRecord,
  CheckinRecord,
  DateKey,
  HabitFreq,
  NoteRecord,
  ReviewRecord,
  SubtaskRecord,
  TodoRecord,
} from './types'

export type ReportKind = 'week' | 'month'

/** AI 洞察要用的原文素材（想法 + 复盘，时间倒序截断） */
export interface ReportTextSample {
  date: DateKey
  kind: 'note' | 'review'
  text: string
}

export interface ReportPeriod {
  kind: ReportKind
  /** 闭区间 */
  from: DateKey
  to: DateKey
  /** 展示标题：周 = 「10/26 – 11/1」；月 = 「2026 年 10 月」 */
  label: string
}

export interface ReportOverview {
  /** 区间天数（周 7 / 月 28–31） */
  days: number
  /** 有记录的天数（待办/想法/打卡/复盘） */
  activeDays: number
  todoDone: number
  todoTotal: number
  /** 0–100 整数 */
  completionRate: number
  checkinCount: number
  noteCount: number
  reviewDays: number
}

export interface ReportSpecialDay {
  date: DateKey
  title: string
  /** 当天是否已勾选（当作待办勾掉） */
  checked: boolean
}

export interface ReportHabitRow {
  habitId: string
  name: string
  freq: HabitFreq
  /** 区间内应打卡天数 */
  dueCount: number
  /** 区间内实际打卡天数 */
  doneCount: number
  /** 区间内最长连续打卡天数 */
  streak: number
}

export interface ReportGoalRow {
  goalId: string
  title: string
  done: boolean
  /** 目标手填进度百分比（可空） */
  pct?: number
  /** 区间内完成子任务数 */
  subtaskDone: number
  /** 区间内子任务总数（活） */
  subtaskTotal: number
  /** 区间内打卡（workDates ∩ 区间）天数 */
  workDays: number
  /** 目标创建时间（AI 偏差分析用） */
  createdAt: number
}

export interface ReportTodoStats {
  done: number
  /** 区间内出现、至今未完成、deadline < 今天的 DDL 待办数 */
  overdue: number
  /** 区间内被顺延出去的次数（rolledFrom 在区间） */
  rolled: number
  /** 单日完成最多的一天；空区间为 null */
  busiestDay: { date: DateKey; done: number } | null
  /** 按周一到周日聚合的完成数（索引 0=周一 … 6=周日） */
  weekdayDone: number[]
}

/** AI 深度复盘的输入素材（会员侧，渲染层不消费） */
export interface ReportAiFeed {
  period: ReportPeriod
  overview: ReportOverview
  specialDays: ReportSpecialDay[]
  habits: ReportHabitRow[]
  goals: ReportGoalRow[]
  todoStats: ReportTodoStats
  /** 想法 + 复盘原文（时间倒序，最多 12 条） */
  texts: ReportTextSample[]
}

export interface ReportData {
  period: ReportPeriod
  overview: ReportOverview
  specialDays: ReportSpecialDay[]
  habits: ReportHabitRow[]
  goals: ReportGoalRow[]
  todoStats: ReportTodoStats
  /** 留给 AI 的原文素材（渲染层忽略） */
  aiFeed: ReportAiFeed
}

/** AI 深度复盘结果（L2 六段，会员专属）。后端 /ai/review 返回同形 JSON。 */
export interface ReportAiResult {
  /** 效率趋势 */
  trend: string
  /** 习惯警报 */
  habits: string
  /** 拖延信号 */
  procrastination: string
  /** 想法洞察 */
  thoughts: string
  /** 目标偏差 */
  goals: string
  /** 下周/下月建议 */
  advice: string
}

export interface BuildReportInput {
  kind: ReportKind
  /** 周：区间内任意一天；月：该月任意一天 */
  cursor: DateKey
  weekStartsOn?: WeekStartsOn
  store: RecordStore
  repos: Repos
  lunar?: LunarApi | null
}

const WEEKDAY_ORDER = 1 as const // 周起始（周一的 dow=1），对齐 startOfWeek

function dueCountOf(freq: HabitFreq, days: DateKey[]): number {
  if (freq.kind === 'daily') return days.length
  const set = new Set(freq.weekdays)
  return days.filter((k) => set.has(dowOf(k))).length
}

/** 区间内最长连续打卡段（按日期排序后扫连续） */
function longestStreak(dates: DateKey[]): number {
  const sorted = [...new Set(dates)].sort(compareKey)
  let best = 0
  let run = 0
  let prev: DateKey | null = null
  for (const k of sorted) {
    if (prev !== null && daysBetween(prev, k) === 1) run += 1
    else run = 1
    if (run > best) best = run
    prev = k
  }
  return best
}

export function buildReport(input: BuildReportInput): Promise<ReportData> {
  const { kind, cursor, weekStartsOn = 1, store, repos, lunar = null } = input
  const days: DateKey[] = kind === 'week' ? weekKeys(cursor, weekStartsOn) : monthKeys(cursor)
  const from = days[0]
  const to = days[days.length - 1]
  const daySet = new Set(days)

  const label =
    kind === 'week'
      ? `${Number(from.slice(5, 7))}/${Number(from.slice(8, 10))} – ${Number(to.slice(5, 7))}/${Number(to.slice(8, 10))}`
      : `${from.slice(0, 4)} 年 ${Number(from.slice(5, 7))} 月`

  return (async () => {
    const [todosByDate, notes, reviews, anniversaries, goals, habits, subtasks, checkins, annivChecks] =
      await Promise.all([
        store.byDate<TodoRecord>('todos', from, to),
        store.byDate<NoteRecord>('notes', from, to),
        store.byDate<ReviewRecord>('reviews', from, to),
        repos.anniversaries.all(),
        repos.goals.all(),
        repos.habits.all(),
        store.all<SubtaskRecord>('subtasks'),
        store.all<CheckinRecord>('checkins'),
        store.all<AnnivCheckRecord>('annivchecks'),
      ])

    // 口径：完成数按 doneAt 落区间，不要求 date 也在区间——
    // 「10-29 建的待办、11-2 才勾掉」要算进 11 月完成（否则完成分布漏人）。
    // 做法：byDate 之外，再从全量 todo 补 date 在区间外但 doneAt 在区间内的完成。
    const allTodos = await store.all<TodoRecord>('todos')
    const extraDone = allTodos.filter(
      (t) =>
        t.done &&
        t.doneAt !== undefined &&
        keyOf(t.doneAt) >= from &&
        keyOf(t.doneAt) <= to &&
        !t.rolledTo,
    )
    const seen = new Set(todosByDate.map((t) => t.id))
    for (const t of extraDone) {
      if (!seen.has(t.id)) {
        seen.add(t.id)
        todosByDate.push(t)
      }
    }
    const todos = todosByDate

    // ---- 概览 ----
    const checkinDates = new Set(checkins.filter((c) => daySet.has(c.date)).map((c) => c.date))
    const noteDates = new Set(notes.map((n) => n.date))
    const reviewDates = new Set(reviews.map((r) => r.date))
    const activeDays = new Set<string>()
    for (const d of days) {
      if (checkinDates.has(d) || noteDates.has(d) || reviewDates.has(d)) activeDays.add(d)
    }
    const todosInRange = todos.filter((t) => !t.rolledTo)
    const todoDone = todosInRange.filter((t) => {
      if (t.doneAt === undefined) return t.done
      const d = keyOf(t.doneAt)
      return d >= from && d <= to
    }).length
    const todoTotal = todosInRange.length
    const todayKey = keyOf(Date.now())
    const overdue = todos.filter(
      (t) =>
        !t.done &&
        !!t.deadline &&
        t.deadline < todayKey &&
        (daySet.has(t.date) || (t.deadline >= from && t.deadline <= to)),
    ).length
    const rolled = todos.filter((t) => t.rolledFrom !== undefined && daySet.has(t.rolledFrom as DateKey)).length

    // 单日完成数与周一到周日聚合（只统计已完成，未完成不进分布）
    const doneByDate = new Map<DateKey, number>()
    for (const t of todosInRange) {
      if (!t.done) continue
      const d = t.doneAt !== undefined ? keyOf(t.doneAt) : t.date
      if (d < from || d > to) continue
      doneByDate.set(d, (doneByDate.get(d) ?? 0) + 1)
    }
    const busiestDay = (() => {
      let best: { date: DateKey; done: number } | null = null
      for (const d of days) {
        const n = doneByDate.get(d) ?? 0
        if (n > 0 && (best === null || n > best.done)) best = { date: d, done: n }
      }
      return best
    })()
    const weekdayDone = Array.from({ length: 7 }, (_, i) => {
      const wd = (i + WEEKDAY_ORDER) % 7
      let sum = 0
      for (const d of days) if (dowOf(d) === wd) sum += doneByDate.get(d) ?? 0
      return sum
    })

    // ---- 特殊日 ----
    const checkedAnniv = new Map<string, DateKey[]>() // annivId -> 勾选日期
    for (const ac of annivChecks) {
      const arr = checkedAnniv.get(ac.annivId) ?? []
      arr.push(ac.date)
      checkedAnniv.set(ac.annivId, arr)
    }
    const specialDays: ReportSpecialDay[] = []
    for (const d of days) {
      for (const a of anniversaries) {
        if (!annivHitsOn(a, d, lunar)) continue
        const checked = (checkedAnniv.get(a.id) ?? []).includes(d)
        specialDays.push({ date: d, title: a.title, checked })
      }
    }
    specialDays.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))

    // ---- 习惯 ----
    const checkinByHabit = new Map<string, DateKey[]>()
    for (const c of checkins) {
      if (!daySet.has(c.date)) continue
      const arr = checkinByHabit.get(c.habitId) ?? []
      arr.push(c.date)
      checkinByHabit.set(c.habitId, arr)
    }
    const habitsReport: ReportHabitRow[] = habits
      .filter((h) => !h.paused)
      .map((h) => {
        const dates = checkinByHabit.get(h.id) ?? []
        return {
          habitId: h.id,
          name: h.name,
          freq: h.freq,
          dueCount: dueCountOf(h.freq, days),
          doneCount: dates.length,
          streak: longestStreak(dates),
        }
      })
      .sort((a, b) => b.doneCount - a.doneCount || b.streak - a.streak || (a.name < b.name ? -1 : 1))

    // ---- 目标 ----
    const liveGoals = goals.filter((g) => !g.done)
    const goalsReport: ReportGoalRow[] = liveGoals.map((g) => {
      const sts = subtasks.filter((s) => s.goalId === g.id && !s.deleted)
      const workDays = sts.reduce(
        (acc, s) => acc + (Array.isArray(s.workDates) ? s.workDates.filter((d) => daySet.has(d as DateKey)).length : 0),
        0,
      )
      return {
        goalId: g.id,
        title: g.title,
        done: g.done,
        pct: g.progress?.pct,
        subtaskDone: sts.filter((s) => s.done).length,
        subtaskTotal: sts.length,
        workDays,
        createdAt: g.createdAt,
      }
    })
    goalsReport.sort((a, b) => (a.title < b.title ? -1 : 1))

    // ---- AI 素材 ----
    const texts: ReportTextSample[] = [
      ...reviews.map((r) => ({ date: r.date, kind: 'review' as const, text: r.text })),
      ...notes.map((n) => ({ date: n.date, kind: 'note' as const, text: n.text })),
    ]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 12)

    const overview: ReportOverview = {
      days: days.length,
      activeDays: activeDays.size,
      todoDone,
      todoTotal,
      completionRate: todoTotal === 0 ? 0 : Math.round((todoDone / todoTotal) * 100),
      checkinCount: checkins.filter((c) => daySet.has(c.date)).length,
      noteCount: notes.length,
      reviewDays: reviewDates.size,
    }
    const todoStats: ReportTodoStats = { done: todoDone, overdue, rolled, busiestDay, weekdayDone }

    const period: ReportPeriod = { kind, from, to, label }
    const aiFeed: ReportAiFeed = {
      period,
      overview,
      specialDays,
      habits: habitsReport,
      goals: goalsReport,
      todoStats,
      texts,
    }
    return {
      period,
      overview,
      specialDays,
      habits: habitsReport,
      goals: goalsReport,
      todoStats,
      aiFeed,
    }
  })()
}

/** 周/月平移：当前光标 +delta（周 ±7 天；月 ±1 月），返回新光标 */
export function shiftCursor(kind: ReportKind, cursor: DateKey, delta: number): DateKey {
  if (kind === 'week') {
    const s = startOfWeek(cursor, WEEKDAY_ORDER)
    const d = new Date(Date.UTC(fromKey(s).y, fromKey(s).m - 1, fromKey(s).d + delta * 7))
    return keyOf(d.getTime())
  }
  // 月：夹取到目标月的同一天
  const { y, m, d } = fromKey(cursor)
  const target = new Date(y, m - 1 + delta, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return keyOf(new Date(target.getFullYear(), target.getMonth(), Math.min(d, lastDay)).getTime())
}
