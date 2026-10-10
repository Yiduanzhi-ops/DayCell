/**
 * aggregate 层测试。
 *
 * 三类重点：
 *  1. **算得对**：进度排除 rolledTo、分类汇总降序、E21 归并、墓碑排除、E4 农历降级
 *  2. **查得少**：CORE-API §6 的查询次数是硬契约，用间谍断言，退化即失败
 *  3. **形状稳**：月恒 42 格、周恒 7 行、顺序确定（React key 与快照测试都依赖它）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeClock, type FakeClock } from '../clock'
import { createSeqIdGen } from '../id'
import type { AnniversaryResolution, LunarApi, LunarInfo } from '../lunar'
import { createRepos, DEFAULT_CATEGORIES, type Repos } from '../repo'
import { createMemoryStore } from '../store/memory'
import type { RecordStore } from '../store/types'
import type { DateKey } from '../types'
import { createAggregates, DELETED_CAT_LABEL, type Aggregates } from './index'

const k = (s: string): DateKey => s as DateKey

// ---------------------------------------------------------------------------
// 假农历：可控、同步、不引入 lunar-typescript（真库要动态 import，测试里是纯负担）
// ---------------------------------------------------------------------------

/** 农历日 → 各年的公历落点。键形如 '2026|08-15' */
type LunarAnnivMap = Record<string, string>

function fakeLunar(
  infos: Record<string, LunarInfo>,
  anniv: LunarAnnivMap = {},
): LunarApi {
  return {
    lunarOf: (key) => infos[key] ?? null,
    lunarAnniversary: (lunarDate, year): AnniversaryResolution => {
      const mmdd = lunarDate.slice(5)
      const hit = anniv[`${year}|${mmdd}`]
      return {
        key: hit ? k(hit) : null,
        usedFallbackMonth: false,
        usedFallbackDay: false,
      }
    },
    supportedRange: () => ({ from: k('1900-01-01'), to: k('2100-12-31') }),
  }
}

const LUNAR: Record<string, LunarInfo> = {
  '2026-09-29': { lunarDay: '十九', lunarMonth: '八', isLeapMonth: false },
  '2026-09-25': { lunarDay: '十五', lunarMonth: '八', isLeapMonth: false, festival: '中秋节' },
  '2026-09-07': { lunarDay: '廿六', lunarMonth: '七', isLeapMonth: false, solarTerm: '白露' },
  '2026-10-02': { lunarDay: '廿二', lunarMonth: '八', isLeapMonth: false },
}

// ---------------------------------------------------------------------------

let store: RecordStore
let repos: Repos
let agg: Aggregates
let catId: Record<string, string>
let clock: FakeClock

beforeEach(async () => {
  clock = createFakeClock(1_700_000_000_000)
  store = createMemoryStore({ now: clock })
  await store.init()
  repos = createRepos({ store, now: clock, idGen: createSeqIdGen() })
  await repos.categories.seedDefaults()
  agg = createAggregates({ store, repos, lunar: fakeLunar(LUNAR, { '2026|10-02': '2026-10-02' }) })

  const m = await repos.categories.nameMap()
  catId = {}
  for (const [id, name] of m) catId[name] = id
})

/**
 * 造一天的数据。
 *
 * ⚠️ **每条记录之间推进时钟**：否则 createdAt 全部相同，顺序会落到 sortDated 的
 *    id 字典序兜底上，"按创建顺序返回"这个断言就测不到真东西了。
 */
async function seedDay(
  date: string,
  o: { todos?: number; done?: number; notes?: number; expenses?: Array<[string, number]> } = {},
): Promise<void> {
  for (let i = 0; i < (o.todos ?? 0); i++) {
    const t = await repos.todos.create(k(date), `${date} 待办${i + 1}`)
    clock.advance(1000)
    if (i < (o.done ?? 0)) await repos.todos.toggle(t.id)
  }
  for (let i = 0; i < (o.notes ?? 0); i++) {
    await repos.notes.create(k(date), `${date} 想法${i + 1}`)
    clock.advance(1000)
  }
  for (const [name, cents] of o.expenses ?? []) {
    await repos.expenses.create(k(date), { amountCents: cents, catId: catId[name]!, note: name })
    clock.advance(1000)
  }
}

// ===========================================================================

describe('aggregateDay — 单日指示器', () => {
  it('计数、金额、isEmpty', async () => {
    await seedDay('2026-09-29', { todos: 3, done: 1, notes: 2, expenses: [['餐饮', 2850], ['交通', 1000]] })
    const d = await agg.aggregateDay(k('2026-09-29'))

    expect(d.date).toBe('2026-09-29')
    expect(d.todoDone).toBe(1)
    expect(d.todoTotal).toBe(3)
    expect(d.noteCount).toBe(2)
    expect(d.costCents).toBe(3850)
    expect(d.isEmpty).toBe(false)
  })

  it('空的一天：三类全 0、isEmpty 为 true', async () => {
    const d = await agg.aggregateDay(k('2026-09-21'))
    expect(d).toMatchObject({ todoDone: 0, todoTotal: 0, noteCount: 0, costCents: 0, isEmpty: true })
    expect(d.byCat).toEqual([])
  })

  it('byCat 金额降序，且带分类名', async () => {
    await seedDay('2026-09-29', {
      expenses: [['餐饮', 1000], ['交通', 5000], ['购物', 3000], ['娱乐', 3000]],
    })
    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.byCat.map((c) => c.name)).toEqual(['交通', '购物', '娱乐', '餐饮'])
    expect(d.byCat.map((c) => c.cents)).toEqual([5000, 3000, 3000, 1000])
  })

  it('同额分类按 catId 升序 —— 输出必须确定，否则 React key 会抖', async () => {
    await seedDay('2026-09-29', { expenses: [['娱乐', 3000], ['购物', 3000]] })
    const a = await agg.aggregateDay(k('2026-09-29'))
    const b = await agg.aggregateDay(k('2026-09-29'))
    expect(a.byCat).toEqual(b.byCat)
    expect(a.byCat[0]!.catId < a.byCat[1]!.catId).toBe(true)
  })

  it('同分类多笔合并成一行', async () => {
    await seedDay('2026-09-29', { expenses: [['餐饮', 1000], ['餐饮', 2000], ['交通', 500]] })
    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.byCat).toHaveLength(2)
    expect(d.byCat[0]).toMatchObject({ name: '餐饮', cents: 3000 })
  })

  it('★ PRD US-04：进度排除已顺延出去的待办', async () => {
    await seedDay('2026-09-28', { todos: 3, done: 1 })
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))

    const from = await agg.aggregateDay(k('2026-09-28'))
    // 原 3 条、完成 1 条、顺延 2 条 → 这天只剩 1 条且已完成
    expect(from.todoDone).toBe(1)
    expect(from.todoTotal).toBe(1)

    const to = await agg.aggregateDay(k('2026-09-29'))
    expect(to.todoTotal).toBe(2)
    expect(to.todoDone).toBe(0)
  })

  it('软删除的记录不计入任何数字', async () => {
    await seedDay('2026-09-29', { todos: 2, notes: 2, expenses: [['餐饮', 1000]] })
    const t = (await repos.todos.byDate(k('2026-09-29')))[0]!
    const n = (await repos.notes.byDate(k('2026-09-29')))[0]!
    const e = (await repos.expenses.byDate(k('2026-09-29')))[0]!
    await repos.todos.softDelete(t.id)
    await repos.notes.softDelete(n.id)
    await repos.expenses.softDelete(e.id)

    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.todoTotal).toBe(1)
    expect(d.noteCount).toBe(1)
    expect(d.costCents).toBe(0)
    expect(d.byCat).toEqual([])
  })

  it('label 由 cellLabel 决定：节日 > 纪念日 > 节气 > 农历', async () => {
    await repos.anniversaries.create({ title: '妈妈生日', date: '2000-10-02', isLunar: true, repeat: 'yearly' })
    const midAutumn = await agg.aggregateDay(k('2026-09-25'))
    expect(midAutumn.label.text).toBe('中秋节')

    const term = await agg.aggregateDay(k('2026-09-07'))
    expect(term.label.text).toBe('白露')

    const anniv = await agg.aggregateDay(k('2026-10-02'))
    expect(anniv.anniversaries).toEqual(['妈妈生日'])
    expect(anniv.label.text).toBe('妈妈生日')

    const plain = await agg.aggregateDay(k('2026-09-29'))
    expect(plain.label.text).toBe('十九')
  })

  it('★ PRD E4：农历库不可用时不抛错，label 降级、公历纪念日照常', async () => {
    const noLunar = createAggregates({ store, repos, lunar: null })
    await repos.anniversaries.create({ title: '结婚纪念', date: '2020-09-29', isLunar: false, repeat: 'yearly' })
    await repos.anniversaries.create({ title: '妈妈生日', date: '2000-10-02', isLunar: true, repeat: 'yearly' })
    await seedDay('2026-09-29', { notes: 1 })

    const d = await noLunar.aggregateDay(k('2026-09-29'))
    expect(d.anniversaries).toEqual(['结婚纪念']) // 农历那条整类跳过
    expect(d.label.text).toBe('结婚纪念')
    expect(d.noteCount).toBe(1)
  })

  it('★ PRD E21：分类被删 → 这笔钱并进「其他」，不单独成行', async () => {
    const tmp = await repos.categories.create('临时')
    await seedDay('2026-09-29', { expenses: [['其他', 1000]] })
    await repos.expenses.create(k('2026-09-29'), { amountCents: 2500, catId: tmp.id, note: 'x' })
    await repos.categories.softDelete(tmp.id)

    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.costCents).toBe(3500) // 总额不受影响：钱确实花掉了
    expect(d.byCat).toHaveLength(1)
    expect(d.byCat[0]).toMatchObject({ name: '其他', cents: 3500 })
  })

  it('★ PRD E21 极端情况：连「其他」也被删了 → 显示「已删除分类」', async () => {
    const tmp = await repos.categories.create('临时')
    await repos.expenses.create(k('2026-09-29'), { amountCents: 2500, catId: tmp.id, note: 'x' })
    await repos.categories.softDelete(tmp.id)
    await repos.categories.softDelete(catId['其他']!)

    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.costCents).toBe(2500)
    expect(d.byCat).toHaveLength(1)
    expect(d.byCat[0]!.name).toBe(DELETED_CAT_LABEL)
  })

  it('分类改名后需 invalidate()，否则显示旧名（缓存的代价，写在契约里）', async () => {
    await seedDay('2026-09-29', { expenses: [['餐饮', 1000]] })
    expect((await agg.aggregateDay(k('2026-09-29'))).byCat[0]!.name).toBe('餐饮')

    await repos.categories.rename(catId['餐饮']!, '吃喝')
    expect((await agg.aggregateDay(k('2026-09-29'))).byCat[0]!.name).toBe('餐饮') // 仍是缓存

    agg.invalidate()
    expect((await agg.aggregateDay(k('2026-09-29'))).byCat[0]!.name).toBe('吃喝')
  })
})

describe('aggregateWeek — 恒 7 行', () => {
  it('返回 7 天，周一开头，含选中日', async () => {
    const { days } = await agg.aggregateWeek(k('2026-09-29')) // 周二
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.date)).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
      '2026-10-02', '2026-10-03', '2026-10-04',
    ])
  })

  it('weekStartsOn=0 时改成周日开头', async () => {
    const { days } = await agg.aggregateWeek(k('2026-09-29'), { weekStartsOn: 0 })
    expect(days[0]!.date).toBe('2026-09-27')
    expect(days).toHaveLength(7)
  })

  it('total 汇总三类，daysWithNotes 只数有想法的天', async () => {
    await seedDay('2026-09-28', { todos: 2, done: 2, notes: 1, expenses: [['餐饮', 1000]] })
    await seedDay('2026-09-29', { todos: 3, done: 1, notes: 2, expenses: [['交通', 2000]] })
    await seedDay('2026-09-30', { todos: 1, done: 0 })

    const { total } = await agg.aggregateWeek(k('2026-09-29'))
    expect(total).toEqual({ todoDone: 3, todoTotal: 6, daysWithNotes: 2, costCents: 3000 })
  })

  it('★ 查询次数：一周只发 1 次 byDateAll（CORE-API §6）', async () => {
    const spy = vi.spyOn(store, 'byDateAll')
    await agg.aggregateWeek(k('2026-09-29'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual(['2026-09-28', '2026-10-04'])
  })

  it('周行带正文预览：待办前 3、想法前 2（US-08）', async () => {
    await seedDay('2026-09-29', { todos: 5, done: 1, notes: 3 })
    const { days } = await agg.aggregateWeek(k('2026-09-29'))
    const tue = days[1]!
    expect(tue.todoPreview.map((t) => t.text)).toEqual([
      '2026-09-29 待办1', '2026-09-29 待办2', '2026-09-29 待办3',
    ]) // 已完成的也在前 3（周行要划线显示），只有 rolledTo 才排除
    expect(tue.notePreview.map((n) => n.text)).toEqual(['2026-09-29 想法1', '2026-09-29 想法2'])
  })

  it('预览排除已顺延出去的待办；来源日显示「顺延 →」由 UI 按 rolledTo 判断', async () => {
    await seedDay('2026-09-28', { todos: 2 })
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    const { days } = await agg.aggregateWeek(k('2026-09-29'))
    const mon = days[0]! // 09-28：原有 2 条都顺延出去了
    expect(mon.todoPreview).toHaveLength(0)
    expect(mon.todoTotal).toBe(0)
    const tue = days[1]! // 09-29：顺延来的 2 条，带 rolledFrom
    expect(tue.todoPreview.map((t) => t.rolledFrom)).toEqual(['2026-09-28', '2026-09-28'])
  })

  it('lunarDay 给 UI 拼「中秋节 · 十五」（label 被节日占用时的副标签）', async () => {
    const { days } = await agg.aggregateWeek(k('2026-09-25'))
    const fri = days.find((d) => d.date === '2026-09-25')!
    expect(fri.label.text).toBe('中秋节')
    expect(fri.lunarDay).toBe('十五')
  })
})

describe('aggregateMonth — 恒 42 格', () => {
  it('返回 42 天，首格是本月 1 号所在周的周一', async () => {
    const days = await agg.aggregateMonth(k('2026-09-15'))
    expect(days).toHaveLength(42)
    expect(days[0]!.date).toBe('2026-08-31') // 2026-09-01 是周二
    expect(days[41]!.date).toBe('2026-10-11')
  })

  it('邻月补齐日也照常聚合（视图不需要自己判断）', async () => {
    await seedDay('2026-08-31', { notes: 1 })
    const days = await agg.aggregateMonth(k('2026-09-15'))
    expect(days[0]!.noteCount).toBe(1)
  })

  it('★ 查询次数：42 格只发 1 次 byDateAll，**不逐日查询**（CORE-API §6）', async () => {
    const spy = vi.spyOn(store, 'byDateAll')
    await agg.aggregateMonth(k('2026-09-15'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual(['2026-08-31', '2026-10-11'])
  })

  it('★ 禁止用 all() 拿内容记录：全程不调用 store.all 于三个内容表', async () => {
    const spy = vi.spyOn(store, 'all')
    await agg.aggregateMonth(k('2026-09-15'))
    const stores = spy.mock.calls.map((c) => c[0])
    expect(stores.filter((s) => s === 'todos' || s === 'notes' || s === 'expenses')).toEqual([])
    // 只允许 anniversaries / categories 这两张小表走 all()
    expect(new Set(stores)).toEqual(new Set(['anniversaries', 'categories']))
  })

  it('跨年那一格：月视图覆盖到两个年份，纪念日按各自年份解析', async () => {
    await repos.anniversaries.create({ title: '元旦', date: '2020-01-01', isLunar: false, repeat: 'yearly' })
    const days = await agg.aggregateMonth(k('2026-12-15'))
    expect(days[0]!.date).toBe('2026-11-30')
    const newYear = days.find((d) => d.date === '2027-01-01')
    expect(newYear?.anniversaries).toEqual(['元旦'])
  })

  it('一次性纪念日（repeat=none）只在自己那一天出现', async () => {
    await repos.anniversaries.create({ title: '搬家', date: '2026-09-20', isLunar: false, repeat: 'none' })
    const days = await agg.aggregateMonth(k('2026-09-15'))
    expect(days.find((d) => d.date === '2026-09-20')?.anniversaries).toEqual(['搬家'])
    expect(days.filter((d) => d.anniversaries.includes('搬家'))).toHaveLength(1)
  })
})

describe('monthSummary — 标题栏', () => {
  it('只数本月的天，不含月格补齐的邻月日期', async () => {
    await seedDay('2026-08-31', { notes: 1, expenses: [['餐饮', 9999]] }) // 上月，不该计入
    await seedDay('2026-09-05', { todos: 1 })
    await seedDay('2026-09-06', { notes: 1, expenses: [['交通', 1000]] })
    await seedDay('2026-10-01', { notes: 1 }) // 下月，不该计入

    const s = await agg.monthSummary(k('2026-09-15'))
    expect(s.daysWithRecords).toBe(2)
    expect(s.costCents).toBe(1000)
  })

  it('整月无记录 → 0 / 0', async () => {
    expect(await agg.monthSummary(k('2026-09-15'))).toEqual({ daysWithRecords: 0, costCents: 0 })
  })

  it('只有纪念日的一天**算**有记录吗？—— 不算，纪念日不是用户写的东西', async () => {
    await repos.anniversaries.create({ title: '搬家', date: '2026-09-20', isLunar: false, repeat: 'none' })
    const s = await agg.monthSummary(k('2026-09-15'))
    expect(s.daysWithRecords).toBe(0)
  })
})

describe('aggregateDayDetail — v6 首屏关键路径', () => {
  it('返回全文记录，summary 与 aggregateDay 一致', async () => {
    await seedDay('2026-09-29', { todos: 2, done: 1, notes: 1, expenses: [['餐饮', 2850]] })
    const detail = await agg.aggregateDayDetail(k('2026-09-29'))
    const plain = await agg.aggregateDay(k('2026-09-29'))

    expect(detail.todos).toHaveLength(2)
    expect(detail.todos[0]!.text).toBe('2026-09-29 待办1')
    expect(detail.notes).toHaveLength(1)
    expect(detail.expenses).toHaveLength(1)
    expect(detail.summary).toEqual(plain)
  })

  it('todos 按 createdAt 升序，且**含 rolledTo 项**（进度计算要自己排除）', async () => {
    await seedDay('2026-09-28', { todos: 2 })
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))

    const d = await agg.aggregateDayDetail(k('2026-09-28'))
    expect(d.todos).toHaveLength(2) // 记录还在这天，只是被标记为已顺延
    expect(d.todos.every((t) => t.rolledTo === '2026-09-29')).toBe(true)
    expect(d.summary.todoTotal).toBe(0) // 但进度里不算
  })

  it('★ prevDayRollable：昨天未完成且未顺延的条数，一次查询顺带拿到', async () => {
    await seedDay('2026-09-28', { todos: 3, done: 1 })
    const d = await agg.aggregateDayDetail(k('2026-09-29'))
    expect(d.prevDayRollable).toBe(2)
  })

  it('昨天全完成 / 已顺延过 → 0（PRD E10：为 0 时不显示横幅）', async () => {
    await seedDay('2026-09-28', { todos: 2, done: 2 })
    expect((await agg.aggregateDayDetail(k('2026-09-29'))).prevDayRollable).toBe(0)

    await seedDay('2026-09-30', { todos: 2 })
    await repos.todos.rollOver(k('2026-09-30'), k('2026-10-01'))
    expect((await agg.aggregateDayDetail(k('2026-10-01'))).prevDayRollable).toBe(0)
  })

  it('★ 查询次数：**1 次** byDateAll 同时覆盖昨天和今天，不为顺延横幅多查一次', async () => {
    const spy = vi.spyOn(store, 'byDateAll')
    await agg.aggregateDayDetail(k('2026-09-29'))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]).toEqual(['2026-09-28', '2026-09-29'])
  })

  it('翻日时不重查分类表（缓存生效，CORE-API §6）', async () => {
    const spy = vi.spyOn(repos.categories, 'nameMap')
    await agg.aggregateDayDetail(k('2026-09-29'))
    await agg.aggregateDayDetail(k('2026-09-30'))
    await agg.aggregateDayDetail(k('2026-10-01'))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('lunar 字段：有农历时给对象，库不可用时给 null（PRD E4）', async () => {
    expect((await agg.aggregateDayDetail(k('2026-09-29'))).lunar).toEqual(LUNAR['2026-09-29'])
    expect((await agg.aggregateDayDetail(k('2026-09-20'))).lunar).toBeNull() // 假农历表里没有

    const noLunar = createAggregates({ store, repos, lunar: null })
    expect((await noLunar.aggregateDayDetail(k('2026-09-29'))).lunar).toBeNull()
  })

  it('anniversaries 返回**完整记录**（日视图要显示"第几个周年"，不只是标题）', async () => {
    await repos.anniversaries.create({ title: '结婚纪念', date: '2020-09-29', isLunar: false, repeat: 'yearly' })
    const d = await agg.aggregateDayDetail(k('2026-09-29'))
    expect(d.anniversaries).toHaveLength(1)
    expect(d.anniversaries[0]).toMatchObject({ title: '结婚纪念', isLunar: false, repeat: 'yearly' })
    expect(d.summary.anniversaries).toEqual(['结婚纪念'])
  })

  it('空白日：三类皆空 → isEmpty 为 true，供 v6.1 的自动展开表单判定', async () => {
    await repos.anniversaries.create({ title: '搬家', date: '2026-09-20', isLunar: false, repeat: 'none' })
    const d = await agg.aggregateDayDetail(k('2026-09-20'))
    // 有纪念日，但用户什么也没写 → 仍然算空白
    expect(d.summary.anniversaries).toEqual(['搬家'])
    expect(d.summary.isEmpty).toBe(true)
    expect(d.todos).toEqual([])
  })

  it('1 月 1 日：prevDay 跨年不炸', async () => {
    await seedDay('2025-12-31', { todos: 2 })
    const d = await agg.aggregateDayDetail(k('2026-01-01'))
    expect(d.prevDayRollable).toBe(2)
  })
})

describe('纪念日解析（公历 / 农历 / 一次性 / 脏数据）', () => {
  it('一次性农历纪念日只在自己那一年出现（repeat=none + isLunar）', async () => {
    await repos.anniversaries.create({ title: '那天的事', date: '2026-10-02', isLunar: true, repeat: 'none' })

    // 2026 命中：假农历表里 '2026|10-02' → 2026-10-02
    const this_year = await agg.aggregateMonth(k('2026-09-15'))
    expect(this_year.find((d) => d.date === '2026-10-02')?.anniversaries).toEqual(['那天的事'])

    // 2027 不命中：repeat=none 不做年份替换，落点仍是 2026-10-02，被区间过滤掉
    const next_year = await agg.aggregateMonth(k('2027-09-15'))
    expect(next_year.some((d) => d.anniversaries.includes('那天的事'))).toBe(false)
  })

  it('农历纪念日在 dayDetail.anniversaries 里返回完整记录（日视图要显示 isLunar / 闰月）', async () => {
    await repos.anniversaries.create({
      title: '妈妈生日', date: '2000-10-02', isLunar: true, repeat: 'yearly', isLeapMonth: false,
    })
    const d = await agg.aggregateDayDetail(k('2026-10-02'))
    expect(d.anniversaries).toHaveLength(1)
    expect(d.anniversaries[0]).toMatchObject({ title: '妈妈生日', isLunar: true, repeat: 'yearly' })
    expect(d.summary.anniversaries).toEqual(['妈妈生日'])
  })

  it('一次性农历纪念日在 dayDetail 里也取得到', async () => {
    await repos.anniversaries.create({ title: '一次性', date: '2026-10-02', isLunar: true, repeat: 'none' })
    const d = await agg.aggregateDayDetail(k('2026-10-02'))
    expect(d.anniversaries.map((a) => a.title)).toEqual(['一次性'])
  })

  it('同一天多个纪念日：label 只放第一个，extra 记剩下的数量', async () => {
    await repos.anniversaries.create({ title: '甲', date: '2020-09-29', isLunar: false, repeat: 'yearly' })
    await repos.anniversaries.create({ title: '乙', date: '2021-09-29', isLunar: false, repeat: 'yearly' })
    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.anniversaries).toHaveLength(2)
    expect(d.label.text).toBe('甲')
    expect(d.label.extra).toBe(1)
  })

  it('★ date 字段损坏的纪念日不会让月视图崩掉（防御分支）', async () => {
    // 绕过 repo 的校验直接写脏数据：模拟导入了一份被手工改坏的备份
    await store.put('anniversaries', {
      id: 'bad-1', type: 'anniversary', title: '脏数据', date: '不是日期',
      isLunar: true, repeat: 'yearly', createdAt: 1, updatedAt: 1, deleted: false,
    })
    await store.put('anniversaries', {
      id: 'bad-2', type: 'anniversary', title: '脏数据2', date: '2026-13-45',
      isLunar: false, repeat: 'none', createdAt: 1, updatedAt: 1, deleted: false,
    })

    const days = await agg.aggregateMonth(k('2026-09-15'))
    expect(days).toHaveLength(42)
    expect(days.some((d) => d.anniversaries.some((t) => t.startsWith('脏数据')))).toBe(false)

    // dayDetail 同样不能炸
    const d = await agg.aggregateDayDetail(k('2026-09-29'))
    expect(d.anniversaries).toEqual([])
  })

  it('已软删除的纪念日不出现', async () => {
    const a = await repos.anniversaries.create({ title: '不再纪念', date: '2020-09-29', isLunar: false, repeat: 'yearly' })
    await repos.anniversaries.softDelete(a.id)
    expect((await agg.aggregateDay(k('2026-09-29'))).anniversaries).toEqual([])
    expect((await agg.aggregateDayDetail(k('2026-09-29'))).anniversaries).toEqual([])
  })

  it('weekly：每周同星期几命中（date 只取星期）', async () => {
    // 2026-10-07 是周三；date 只是参考日期
    await repos.anniversaries.create({ title: '每周例会', date: '2026-10-07', isLunar: false, repeat: 'weekly' })

    // 9 月视图 42 格覆盖 8/31~10/11：其中的周三都命中
    const days = await agg.aggregateMonth(k('2026-09-15'))
    for (const d of ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07']) {
      expect(days.find((x) => x.date === d)?.anniversaries).toEqual(['每周例会'])
    }
    expect(days.find((x) => x.date === '2026-09-08')?.anniversaries ?? []).toEqual([]) // 周二不命中

    // 日视图是任意日查询，不限于网格：10/21（周三）也能取到
    const detail = await agg.aggregateDayDetail(k('2026-10-21'))
    expect(detail.anniversaries.map((a) => a.title)).toEqual(['每周例会'])
    expect(detail.anniversaries[0]).toMatchObject({ repeat: 'weekly', isLunar: false })
  })

  it('monthly：每月同日号命中，不存在的日期不命中', async () => {
    await repos.anniversaries.create({ title: '还信用卡', date: '2026-01-15', isLunar: false, repeat: 'monthly' })
    // 9 月视图 42 格覆盖 8/31~10/11：其中的 15 号命中
    const days = await agg.aggregateMonth(k('2026-09-15'))
    expect(days.find((x) => x.date === '2026-09-15')?.anniversaries).toEqual(['还信用卡'])
    expect(days.find((x) => x.date === '2026-08-31')?.anniversaries ?? []).toEqual([]) // 31 号不命中
    expect(days.find((x) => x.date === '2026-09-14')?.anniversaries ?? []).toEqual([])
  })

  it('monthly 31 号：没有 31 号的月份不命中', async () => {
    await repos.anniversaries.create({ title: '月底', date: '2026-01-31', isLunar: false, repeat: 'monthly' })
    // 2 月视图（1/26~3/8）：1/31 命中（1 月有 31 号），2/28 不命中（2 月无 31 号）
    const feb = await agg.aggregateMonth(k('2026-02-15'))
    expect(feb.find((x) => x.date === '2026-01-31')?.anniversaries).toEqual(['月底'])
    expect(feb.find((x) => x.date === '2026-02-28')?.anniversaries ?? []).toEqual([])
    // 3 月视图：3/31 命中、3/30 不命中
    const mar = await agg.aggregateMonth(k('2026-03-15'))
    expect(mar.find((x) => x.date === '2026-03-31')?.anniversaries).toEqual(['月底'])
    expect(mar.find((x) => x.date === '2026-03-30')?.anniversaries ?? []).toEqual([])
  })
})

describe('默认分类完整性', () => {
  it('seedDefaults 的 8 个分类都能被 byCat 正确命名', async () => {
    for (const name of DEFAULT_CATEGORIES) {
      await repos.expenses.create(k('2026-09-29'), { amountCents: 100, catId: catId[name]!, note: '' })
    }
    const d = await agg.aggregateDay(k('2026-09-29'))
    expect(d.byCat.map((c) => c.name).sort()).toEqual([...DEFAULT_CATEGORIES].sort())
    expect(d.costCents).toBe(800)
  })
})

describe('notesAll — v8.13 想法列表数据源', () => {
  it('全量活想法：date 降序、同日 createdAt 降序（最新在最上）；墓碑排除；返回拷贝', async () => {
    await repos.notes.create(k('2026-09-28'), '昨天第一条')
    clock.advance(5000)
    await repos.notes.create(k('2026-09-28'), '昨天第二条（更新）')
    clock.advance(5000)
    await repos.notes.create(k('2026-09-29'), '今天第一条')
    clock.advance(5000)
    const del = await repos.notes.create(k('2026-09-25'), '已删除')
    clock.advance(5000)
    await repos.notes.softDelete(del.id)

    const all = await agg.notesAll()
    expect(all.map((n) => n.text)).toEqual(['今天第一条', '昨天第二条（更新）', '昨天第一条'])
    expect(all.map((n) => n.date)).toEqual(['2026-09-29', '2026-09-28', '2026-09-28'])

    // 返回拷贝：改动不污染 store 内引用
    all[0]!.text = 'x'
    const again = await agg.notesAll()
    expect(again[0]!.text).toBe('今天第一条')
  })

  it('没有想法时返回空数组', async () => {
    expect(await agg.notesAll()).toEqual([])
  })
})
