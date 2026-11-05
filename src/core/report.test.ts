/**
 * core/report 测试——每周/每月报告统计层。
 *
 * 重点：
 *  1. **算得对**：完成率口径（doneAt 在区间）、rolledTo 排除、顺延/逾期口径、
 *     特殊日命中（yearly/monthly/weekly + 勾选）、习惯 due/done/streak、
 *     目标子任务统计、活跃天数、最忙一天、周一到周日聚合
 *  2. **形状稳**：周恒 7 天、月按自然月天数、排序确定
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeClock, type FakeClock } from './clock'
import { createSeqIdGen } from './id'
import type { LunarApi, LunarInfo } from './lunar'
import { createRepos, type Repos } from './repo'
import { createMemoryStore } from './store/memory'
import type { RecordStore } from './store/types'
import type { DateKey } from './types'
import { createAggregates, type Aggregates } from './aggregate/index'
import { shiftCursor } from './report'

const k = (s: string): DateKey => s as DateKey

/** 基准：2026-10-26（周一）中午，本地时区构造，避开午夜/夏令时边界 */
const BASE_MS = new Date(2026, 9, 26, 12).getTime()

function fakeLunar(infos: Record<string, LunarInfo>): LunarApi {
  return {
    lunarOf: (key) => infos[key] ?? null,
    lunarAnniversary: () => ({ key: null, usedFallbackMonth: false, usedFallbackDay: false }),
    supportedRange: () => ({ from: k('1900-01-01'), to: k('2100-12-31') }),
  }
}

const LUNAR: Record<string, LunarInfo> = {
  '2026-10-02': { lunarDay: '廿二', lunarMonth: '八', isLeapMonth: false },
}

let store: RecordStore
let repos: Repos
let agg: Aggregates
let clock: FakeClock

beforeEach(async () => {
  clock = createFakeClock(BASE_MS)
  store = createMemoryStore({ now: clock })
  await store.init()
  repos = createRepos({ store, now: clock, idGen: createSeqIdGen() })
  await repos.categories.seedDefaults()
  agg = createAggregates({ store, repos, lunar: fakeLunar(LUNAR) })
})

/** 把时钟拨到 date 的中午再勾掉待办——让 doneAt 落到指定日期 */
async function doneOn(id: string, date: string): Promise<void> {
  const target = new Date(`${date}T12:00:00`).getTime()
  const base = new Date('2026-10-26T12:00:00').getTime()
  clock.set(BASE_MS + Math.round((target - base) / 86_400_000) * 86_400_000)
  await repos.todos.toggle(id)
}

// ===========================================================================

describe('buildReport · 周报', () => {
  it('概览：完成数（doneAt 在区间）、完成率、活跃天数、想法/复盘/打卡', async () => {
    // 2026-10-26（周一）~ 11-01（周日）
    const monday = k('2026-10-26')
    // 周一 3 件完成 2；周三 1 件完成 1；周四 1 件完成 0
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const t = await repos.todos.create(monday, `t${i}`)
      clock.advance(1000)
      ids.push(t.id)
    }
    await doneOn(ids[0]!, '2026-10-26')
    await doneOn(ids[1]!, '2026-10-26')
    const wed = k('2026-10-28')
    const tw = await repos.todos.create(wed, 'tw')
    await doneOn(tw.id, '2026-10-28')
    await repos.todos.create(k('2026-10-29'), 'th')
    // 想法 2 条（周一、周三各 1）；复盘 2 天（周一、周五）；打卡 3 次
    await repos.notes.create(monday, '想法一')
    await repos.notes.create(wed, '想法二')
    await repos.reviews.upsert(monday, '复盘一')
    await repos.reviews.upsert(k('2026-10-30'), '复盘二')
    const habit = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    for (const d of [monday, wed, k('2026-10-31')]) {
      await repos.checkins.toggle(d, habit.id)
      clock.advance(1000)
    }

    const r = await agg.buildReport('week', monday)

    expect(r.period.from).toBe('2026-10-26')
    expect(r.period.to).toBe('2026-11-01')
    expect(r.period.kind).toBe('week')
    expect(r.overview.days).toBe(7)
    expect(r.overview.activeDays).toBe(4) // 周一/周三/周五/周六（打卡在周六）
    expect(r.overview.todoDone).toBe(3)
    expect(r.overview.todoTotal).toBe(5)
    expect(r.overview.completionRate).toBe(60)
    expect(r.overview.checkinCount).toBe(3)
    expect(r.overview.noteCount).toBe(2)
    expect(r.overview.reviewDays).toBe(2)
  })

  it('待办统计：rolledTo 排除、顺延、逾期、最忙一天、周一到周日聚合', async () => {
    const monday = k('2026-10-26')
    // 周一 2 件全完成 → 最忙 = 周一
    const ids: string[] = []
    for (let i = 0; i < 2; i++) {
      const t = await repos.todos.create(monday, `m${i}`)
      clock.advance(1000)
      ids.push(t.id)
    }
    await doneOn(ids[0]!, '2026-10-26')
    await doneOn(ids[1]!, '2026-10-26')
    // 周二 1 件顺延到周三
    const tue = k('2026-10-27')
    await repos.todos.create(tue, 'roll')
    await repos.todos.rollOver(tue, k('2026-10-28'))
    // 周三完成 1 件
    const wed = k('2026-10-28')
    const t2 = await repos.todos.create(wed, 'w')
    await doneOn(t2.id, '2026-10-28')
    // DDL 逾期：截止 10-25、未完成（区间内出现）
    await repos.todos.create(k('2026-10-26'), 'late', '2026-10-25')

    const r = await agg.buildReport('week', monday)

    expect(r.todoStats.done).toBe(3) // 2(周一) + 1(周三)；roll 不算（rolledTo）
    expect(r.todoStats.rolled).toBe(1)
    expect(r.todoStats.overdue).toBe(1)
    expect(r.todoStats.busiestDay).toEqual({ date: monday, done: 2 })
    // 周一 2、周三 1，其余 0；索引 0=周一
    expect(r.todoStats.weekdayDone).toEqual([2, 0, 1, 0, 0, 0, 0])
  })
})

describe('buildReport · 月报', () => {
  it('区间为自然月天数，跨月数据不混入', async () => {
    const nov = k('2026-11-15')
    const oct = k('2026-10-26')
    await repos.todos.create(oct, '十月待办')
    const t = await repos.todos.create(nov, '十一月待办')
    await doneOn(t.id, '2026-11-15')

    const r = await agg.buildReport('month', k('2026-11-01'))
    expect(r.period.from).toBe('2026-11-01')
    expect(r.period.to).toBe('2026-11-30')
    expect(r.overview.days).toBe(30)
    expect(r.overview.todoDone).toBe(1)
    expect(r.overview.todoTotal).toBe(1)
    expect(r.overview.completionRate).toBe(100)
  })

  it('月报 label 与周报 label 格式', async () => {
    const rw = await agg.buildReport('week', k('2026-10-29'))
    expect(rw.period.label).toBe('10/26 – 11/1')
    const rm = await agg.buildReport('month', k('2026-10-15'))
    expect(rm.period.label).toBe('2026 年 10 月')
  })

  it('date 在区间外、doneAt 落区间的完成计入当月（10-29 建、11-02 勾）', async () => {
    // 造在 10 月底的待办，11-02 才勾掉 → 完成算 11 月，总待办也含它
    const t = await repos.todos.create(k('2026-10-29'), '十月建的待办')
    await doneOn(t.id, '2026-11-02')

    const r = await agg.buildReport('month', k('2026-11-15'))
    expect(r.overview.todoDone).toBe(1)
    expect(r.overview.todoTotal).toBe(1)
    expect(r.overview.completionRate).toBe(100)
    expect(r.todoStats.busiestDay).toEqual({ date: '2026-11-02', done: 1 })

    // 10 月那边：date 在 10 月但完成在 11 月 → 10 月完成 0、总待办含它
    const ro = await agg.buildReport('month', k('2026-10-15'))
    expect(ro.overview.todoDone).toBe(0)
    expect(ro.overview.todoTotal).toBe(1)
  })
})

describe('buildReport · 特殊日', () => {
  it('yearly/monthly/weekly/lunar 命中 + 勾选态', async () => {
    const y = await repos.anniversaries.create({ title: '妈妈生日', date: '2000-10-02', isLunar: true, repeat: 'yearly' })
    const m = await repos.anniversaries.create({ title: '发薪日', date: '2020-10-20', isLunar: false, repeat: 'monthly' })
    const w = await repos.anniversaries.create({ title: '家庭日', date: '2026-10-28', isLunar: false, repeat: 'weekly' }) // 周三
    const one = await repos.anniversaries.create({ title: '一次性的', date: '2026-10-26', isLunar: false, repeat: 'none' })

    const r = await agg.buildReport('week', k('2026-10-26'))

    const titles = r.specialDays.map((s) => `${s.date} ${s.title}`)
    // 10-28 周三命中 weekly 家庭日；10-26 命中一次性；10-02 在区间外
    expect(titles).toContain('2026-10-26 一次性的')
    expect(titles).toContain('2026-10-28 家庭日')
    expect(r.specialDays.every((s) => s.title !== '妈妈生日')).toBe(true) // 农历命中需 lunar 提供，fakeLunar 返回 null
    expect(r.specialDays.every((s) => s.title !== '发薪日')).toBe(true) // 20 日不在本周

    // 勾选：勾掉家庭日 → checked=true
    await repos.annivChecks.toggle(k('2026-10-28'), w.id)
    const r2 = await agg.buildReport('week', k('2026-10-26'))
    const fam = r2.specialDays.find((s) => s.title === '家庭日')
    expect(fam?.checked).toBe(true)
    expect(r2.specialDays.find((s) => s.title === '一次性的')?.checked).toBe(false)

    void y
    void one
    void m
  })
})

describe('buildReport · 习惯', () => {
  it('daily 全勤/部分；weekly 只数命中星期；streak 区间内最长连续', async () => {
    const mon = k('2026-10-26')
    const daily = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    const weekly = await repos.habits.create({ name: '学英语', freq: { kind: 'weekly', weekdays: [1, 3, 5] } }) // 一三五
    // 喝水：周一~周三连打（streak 3），周四停
    for (const d of [mon, k('2026-10-27'), k('2026-10-28')]) {
      await repos.checkins.toggle(d, daily.id)
      clock.advance(1000)
    }
    // 学英语：只打周一、周五（2 次，应 3 次）
    await repos.checkins.toggle(mon, weekly.id)
    await repos.checkins.toggle(k('2026-10-30'), weekly.id)

    const r = await agg.buildReport('week', mon)
    const drink = r.habits.find((h) => h.name === '喝水')
    const eng = r.habits.find((h) => h.name === '学英语')

    expect(drink).toMatchObject({ dueCount: 7, doneCount: 3, streak: 3 })
    expect(eng).toMatchObject({ dueCount: 3, doneCount: 2 })
    // 排行：doneCount 降序 → 喝水在前
    expect(r.habits[0]?.name).toBe('喝水')
  })

  it('暂停的习惯不出现', async () => {
    const mon = k('2026-10-26')
    const h = await repos.habits.create({ name: '健身', freq: { kind: 'daily' } })
    await repos.habits.update(h.id, { paused: true })
    const r = await agg.buildReport('week', mon)
    expect(r.habits.some((x) => x.name === '健身')).toBe(false)
  })
})

describe('buildReport · 目标', () => {
  it('子任务完成/总数、workDays 区间交集、pct；已完成目标排除', async () => {
    const mon = k('2026-10-26')
    const g = await repos.goals.create({ title: '考驾照', progress: { pct: 60 } })
    const s1 = await repos.subtasks.create({ goalId: g.id, title: '科目二' })
    await repos.subtasks.create({ goalId: g.id, title: '科目三' })
    await repos.subtasks.setDone(s1.id, true)
    await repos.subtasks.setWork(s1.id, mon, true)
    await repos.subtasks.setWork(s1.id, k('2026-10-28'), true)

    const doneG = await repos.goals.create({ title: '已完成目标' })
    await repos.goals.setDone(doneG.id, true)

    const r = await agg.buildReport('week', mon)
    const row = r.goals.find((x) => x.title === '考驾照')
    expect(row).toMatchObject({ pct: 60, subtaskDone: 1, subtaskTotal: 2, workDays: 2 })
    expect(r.goals.some((x) => x.title === '已完成目标')).toBe(false)
  })
})

describe('shiftCursor · 周/月平移', () => {
  it('周 ±7 天保周一起点', () => {
    expect(shiftCursor('week', k('2026-10-29'), 1)).toBe(k('2026-11-02'))
    expect(shiftCursor('week', k('2026-10-29'), -1)).toBe(k('2026-10-19'))
  })

  it('月平移夹取月底', () => {
    expect(shiftCursor('month', k('2026-10-31'), 1)).toBe(k('2026-11-30'))
    expect(shiftCursor('month', k('2026-10-15'), -1)).toBe(k('2026-09-15'))
  })
})
