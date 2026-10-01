/**
 * repo 层测试。
 *
 * 重点覆盖 PRD 里有条款编号的行为：
 *  - US-04 待办顺延（含 rolledTo 配对、进度排除、不顺延两次）
 *  - E10 无可顺延项时 rollableCount 为 0
 *  - E21 分类删除后历史支出仍可读
 *  - E24 首次启动播种 8 个默认分类
 *  - ADR-0003 金额只接受整数分
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { DateKey, TodoRecord, ExpenseRecord, CategoryRecord } from '../types'
import { createMemoryStore } from '../store/memory'
import type { RecordStore } from '../store/types'
import { createFakeClock, type FakeClock } from '../clock'
import { createSeqIdGen } from '../id'
import { NotFoundError, ValidationError } from '../errors'
import {
  createRepos, todoProgress, isRollable, toYuan, toCents,
  DEFAULT_CATEGORIES, type Repos,
} from './index'

const k = (s: string): DateKey => s as DateKey

let store: RecordStore
let repos: Repos
let clock: FakeClock

beforeEach(async () => {
  clock = createFakeClock(1_700_000_000_000)
  // createFakeClock 返回的对象**本身就是** Clock（可调用），没有 .now 属性
  store = createMemoryStore({ now: clock })
  await store.init()
  repos = createRepos({ store, now: clock, idGen: createSeqIdGen() })
})

describe('todos.create / byDate', () => {
  it('创建后可按日期读回', async () => {
    const t = await repos.todos.create(k('2026-09-29'), '回客户邮件')
    expect(t.text).toBe('回客户邮件')
    expect(t.done).toBe(false)
    expect(t.date).toBe('2026-09-29')

    const list = await repos.todos.byDate(k('2026-09-29'))
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(t.id)
  })

  it('自动打时间戳，且来自注入的时钟', async () => {
    clock.set(1_700_000_123_000)
    const t = await repos.todos.create(k('2026-09-29'), 'x')
    expect(t.createdAt).toBe(1_700_000_123_000)
    expect(t.updatedAt).toBe(1_700_000_123_000)
  })

  it('文本会被 trim、多行压成单行', async () => {
    const t = await repos.todos.create(k('2026-09-29'), '  买牛奶\n买鸡蛋  ')
    expect(t.text).toBe('买牛奶 买鸡蛋')
  })

  it('空文本抛 ValidationError 而不是落库', async () => {
    await expect(repos.todos.create(k('2026-09-29'), '   ')).rejects.toBeInstanceOf(ValidationError)
    expect(await repos.todos.byDate(k('2026-09-29'))).toHaveLength(0)
  })

  it('超长文本抛 TOO_LONG，且带可展示的中文文案', async () => {
    await expect(repos.todos.create(k('2026-09-29'), 'a'.repeat(501))).rejects.toMatchObject({
      validateCode: 'TOO_LONG',
    })
  })

  it('非法日期抛 BAD_DATE', async () => {
    await expect(repos.todos.create(k('2026-02-30'), 'x')).rejects.toMatchObject({ validateCode: 'BAD_DATE' })
  })
})

describe('todos.setText / toggle / softDelete', () => {
  it('setText 更新文字并刷新 updatedAt', async () => {
    const t = await repos.todos.create(k('2026-09-29'), '原文')
    clock.advance(3000)
    const u = await repos.todos.setText(t.id, '改过了')
    expect(u.text).toBe('改过了')
    expect(u.updatedAt).toBe(t.updatedAt + 3000)
    expect(u.createdAt).toBe(t.createdAt) // 创建时间不变
  })

  it('toggle 翻转 done 并维护 doneAt', async () => {
    const t = await repos.todos.create(k('2026-09-29'), 'x')
    expect(t.doneAt).toBeUndefined()

    clock.advance(1000)
    const done = await repos.todos.toggle(t.id)
    expect(done.done).toBe(true)
    expect(done.doneAt).toBe(t.createdAt + 1000)

    const undone = await repos.todos.toggle(t.id)
    expect(undone.done).toBe(false)
    expect(undone.doneAt).toBeUndefined()
  })

  it('softDelete 后 byDate 查不到，但 get 仍能拿到墓碑', async () => {
    const t = await repos.todos.create(k('2026-09-29'), 'x')
    await repos.todos.softDelete(t.id)
    expect(await repos.todos.byDate(k('2026-09-29'))).toHaveLength(0)
    expect((await store.get<TodoRecord>('todos', t.id))!.deleted).toBe(true)
  })

  it('操作不存在的 id 抛 NotFoundError', async () => {
    await expect(repos.todos.setText('nope', 'x')).rejects.toBeInstanceOf(NotFoundError)
    await expect(repos.todos.toggle('nope')).rejects.toBeInstanceOf(NotFoundError)
    await expect(repos.todos.softDelete('nope')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('操作已删除的记录同样抛 NotFoundError', async () => {
    const t = await repos.todos.create(k('2026-09-29'), 'x')
    await repos.todos.softDelete(t.id)
    await expect(repos.todos.toggle(t.id)).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('todoProgress（PRD US-04：排除已顺延项）', () => {
  const t = (over: Partial<TodoRecord>): TodoRecord => ({
    id: 'x', type: 'todo', date: k('2026-09-28'), text: 'x',
    done: false, createdAt: 1, updatedAt: 1, deleted: false, ...over,
  })

  it('常规统计', () => {
    expect(todoProgress([t({ done: true }), t({}), t({})])).toEqual({ done: 1, total: 3 })
  })

  it('已顺延出去的不计入分母（1/3 → 1/1）', () => {
    const before = [t({ id: 'a', done: true }), t({ id: 'b' }), t({ id: 'c' })]
    expect(todoProgress(before)).toEqual({ done: 1, total: 3 })

    const after = [
      t({ id: 'a', done: true }),
      t({ id: 'b', rolledTo: k('2026-09-29') }),
      t({ id: 'c', rolledTo: k('2026-09-29') }),
    ]
    expect(todoProgress(after)).toEqual({ done: 1, total: 1 })
  })

  it('全部顺延后分母为 0，不是 NaN', () => {
    const p = todoProgress([t({ rolledTo: k('2026-09-29') })])
    expect(p).toEqual({ done: 0, total: 0 })
  })

  it('空数组', () => {
    expect(todoProgress([])).toEqual({ done: 0, total: 0 })
  })

  it('isRollable：未完成且未顺延过', () => {
    expect(isRollable(t({}))).toBe(true)
    expect(isRollable(t({ done: true }))).toBe(false)
    expect(isRollable(t({ rolledTo: k('2026-09-29') }))).toBe(false)
    // 已顺延进来的新待办仍可再顺延到下一天（正常行为）
    expect(isRollable(t({ rolledFrom: k('2026-09-27') }))).toBe(true)
  })
})

describe('todos.rollOver（PRD US-04 / E11）', () => {
  beforeEach(async () => {
    // 09-28：1 条已完成 + 2 条未完成
    const done1 = await repos.todos.create(k('2026-09-28'), '已完成的')
    await repos.todos.create(k('2026-09-28'), '要顺延 A')
    await repos.todos.create(k('2026-09-28'), '要顺延 B')
    await repos.todos.toggle(done1.id)
  })

  it('★ 保序：顺延后的顺序 = 源日顺序，即使新 id 的字典序是反的', async () => {
    // 这条守的是一个真实 bug：rollOver 曾在同步循环里对每条记录取同一个 now()，
    // 于是整批 createdAt 完全相同，排序退化成 sortDated 的 id 字典序兜底；
    // 生产环境 id 是 UUID → **顺延过来的待办顺序随机**，和昨天对不上。
    //
    // 为了不让"恰好 id 也是递增的"掩盖问题，这里故意注入一个字典序**递减**的 idGen。
    const desc = ['z', 'y', 'x', 'w', 'v', 'u']
    let n = 0
    const r2 = createRepos({ store, now: clock, idGen: { next: () => desc[n++]! } })

    // 源日三条，用递增的 createdAt 把源顺序钉死成 A/B/C
    await r2.todos.create(k('2026-10-05'), 'A'); clock.advance(1000)
    await r2.todos.create(k('2026-10-05'), 'B'); clock.advance(1000)
    await r2.todos.create(k('2026-10-05'), 'C')
    expect((await r2.todos.byDate(k('2026-10-05'))).map((t) => t.text)).toEqual(['A', 'B', 'C'])

    await r2.todos.rollOver(k('2026-10-05'), k('2026-10-06'))

    // 关键断言：读回来的顺序（= UI 看到的）仍是 A/B/C。
    // 新 id 是 w/v/u，字典序会把它们排成 u(C) v(B) w(A)——只有 createdAt 递增才压得住。
    const moved = await r2.todos.byDate(k('2026-10-06'))
    expect(moved.map((t) => t.text)).toEqual(['A', 'B', 'C'])
    expect(moved[0]!.createdAt < moved[1]!.createdAt).toBe(true)
    expect(moved[1]!.createdAt < moved[2]!.createdAt).toBe(true)
  })

  it('批量顺延的时间戳一致：createdAt 不得晚于 updatedAt', async () => {
    const r = await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    for (const m of r.moved) {
      // keepTimestamps 绕过了 put 的自动刷新，所以这个不变量要自己守
      expect(m.createdAt).toBeLessThanOrEqual(m.updatedAt)
      expect(m.deleted).toBe(false)
    }
  })

  it('把未完成的搬到目标日，并标 rolledFrom', async () => {
    const r = await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(r.moved).toHaveLength(2)
    expect(r.moved.map((x) => x.text).sort()).toEqual(['要顺延 A', '要顺延 B'])
    for (const m of r.moved) {
      expect(m.date).toBe('2026-09-29')
      expect(m.rolledFrom).toBe('2026-09-28')
      expect(m.done).toBe(false)
    }
  })

  it('源记录被标 rolledTo', async () => {
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    const src = await repos.todos.byDate(k('2026-09-28'))
    const rolled = src.filter((x) => x.rolledTo === '2026-09-29')
    expect(rolled).toHaveLength(2)
  })

  it('已完成的不顺延', async () => {
    const r = await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(r.moved.some((x) => x.text === '已完成的')).toBe(false)
  })

  it('源日进度从 1/3 变成 1/1', async () => {
    expect(todoProgress(await repos.todos.byDate(k('2026-09-28')))).toEqual({ done: 1, total: 3 })
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(todoProgress(await repos.todos.byDate(k('2026-09-28')))).toEqual({ done: 1, total: 1 })
  })

  it('目标日进度包含顺延来的 2 条', async () => {
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(todoProgress(await repos.todos.byDate(k('2026-09-29')))).toEqual({ done: 0, total: 2 })
  })

  it('同一条不顺延两次：第二次调用 skipped=2、moved 为空（PRD E11）', async () => {
    const first = await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(first.moved).toHaveLength(2)
    expect(first.skipped).toBe(0)

    const second = await repos.todos.rollOver(k('2026-09-28'), k('2026-09-30'))
    expect(second.moved).toHaveLength(0)
    expect(second.skipped).toBe(2)

    // 09-30 什么都没多出来
    expect(await repos.todos.byDate(k('2026-09-30'))).toHaveLength(0)
  })

  it('无可顺延项时 rollableCount 为 0，UI 据此不显示横幅（PRD E10）', async () => {
    expect(await repos.todos.rollableCount(k('2026-09-28'))).toBe(2)
    await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(await repos.todos.rollableCount(k('2026-09-28'))).toBe(0)
  })

  it('空日子 rollableCount 为 0', async () => {
    expect(await repos.todos.rollableCount(k('2026-09-21'))).toBe(0)
  })

  it('全部已完成时不顺延、返回空', async () => {
    for (const t of await repos.todos.byDate(k('2026-09-28'))) {
      if (!t.done) await repos.todos.toggle(t.id)
    }
    const r = await repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))
    expect(r.moved).toEqual([])
    expect(r.skipped).toBe(0)
  })

  it('事务失败时不留半成品（不会出现"复制了但没标记"）', async () => {
    // 用一个中途抛错的 store 包装来模拟
    const realPut = store.put.bind(store)
    let calls = 0
    store.put = (async (s: never, rec: never, o?: never) => {
      if (++calls === 3) throw new Error('模拟写入失败')
      return realPut(s, rec, o)
    }) as typeof store.put

    await expect(repos.todos.rollOver(k('2026-09-28'), k('2026-09-29'))).rejects.toThrow('模拟写入失败')

    const src = await store.byDate<TodoRecord>('todos', k('2026-09-28'), k('2026-09-28'))
    const dst = await store.byDate<TodoRecord>('todos', k('2026-09-29'), k('2026-09-29'))
    // 回滚后：目标日为空，源日没有任何 rolledTo 标记
    expect(dst).toHaveLength(0)
    expect(src.filter((x) => x.rolledTo)).toHaveLength(0)
  })
})

describe('notes', () => {
  it('保留内部换行（PRD D6）', async () => {
    const n = await repos.notes.create(k('2026-09-29'), '第一行\n第二行')
    expect(n.text).toBe('第一行\n第二行')
    expect(n.type).toBe('note')
  })

  it('首尾空白被 trim', async () => {
    expect((await repos.notes.create(k('2026-09-29'), '  x  ')).text).toBe('x')
  })

  it('空文本抛 ValidationError', async () => {
    await expect(repos.notes.create(k('2026-09-29'), '\n  \n')).rejects.toBeInstanceOf(ValidationError)
  })

  it('超过 5000 字抛 TOO_LONG', async () => {
    await expect(repos.notes.create(k('2026-09-29'), 'a'.repeat(5001))).rejects.toMatchObject({
      validateCode: 'TOO_LONG',
    })
  })

  it('setText / softDelete', async () => {
    const n = await repos.notes.create(k('2026-09-29'), '原文')
    expect((await repos.notes.setText(n.id, '新文')).text).toBe('新文')
    await repos.notes.softDelete(n.id)
    expect(await repos.notes.byDate(k('2026-09-29'))).toHaveLength(0)
  })
})

describe('expenses（ADR-0003）', () => {
  it('创建并读回，金额是整数分', async () => {
    const e = await repos.expenses.create(k('2026-09-29'), { amountCents: 4500, catId: 'c1', note: '午饭' })
    expect(e.amountCents).toBe(4500)
    expect(e.catId).toBe('c1')
    expect(e.note).toBe('午饭')
    expect(await repos.expenses.byDate(k('2026-09-29'))).toHaveLength(1)
  })

  it('备注可以为空', async () => {
    const e = await repos.expenses.create(k('2026-09-29'), { amountCents: 100, catId: 'c1' })
    expect(e.note).toBe('')
  })

  it('拒绝 0、负数、非整数', async () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      await expect(
        repos.expenses.create(k('2026-09-29'), { amountCents: bad, catId: 'c1' }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })

  it('拒绝超出安全整数与业务上限', async () => {
    await expect(
      repos.expenses.create(k('2026-09-29'), { amountCents: 1e16, catId: 'c1' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('update 可单独改金额 / 分类 / 备注', async () => {
    const e = await repos.expenses.create(k('2026-09-29'), { amountCents: 4500, catId: 'c1', note: '午饭' })
    expect((await repos.expenses.update(e.id, { amountCents: 5000 })).amountCents).toBe(5000)
    expect((await repos.expenses.update(e.id, { catId: 'c2' })).catId).toBe('c2')
    expect((await repos.expenses.update(e.id, { note: '晚饭' })).note).toBe('晚饭')
    // 未改的字段保持
    const after = await store.get<ExpenseRecord>('expenses', e.id)
    expect(after).toMatchObject({ amountCents: 5000, catId: 'c2', note: '晚饭' })
  })

  it('update 同样拒绝非法金额', async () => {
    const e = await repos.expenses.create(k('2026-09-29'), { amountCents: 4500, catId: 'c1' })
    await expect(repos.expenses.update(e.id, { amountCents: 0 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('备注超长抛 TOO_LONG', async () => {
    await expect(
      repos.expenses.create(k('2026-09-29'), { amountCents: 100, catId: 'c1', note: 'a'.repeat(201) }),
    ).rejects.toMatchObject({ validateCode: 'TOO_LONG' })
  })
})

describe('categories（PRD E21 / E24 / D8）', () => {
  it('seedDefaults 播种 8 个默认分类，order 连续', async () => {
    expect(await repos.categories.seedDefaults()).toBe(true)
    const all = await repos.categories.all()
    expect(all.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES])
    expect(all.map((c) => c.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('已有分类时 seedDefaults 不重复播种', async () => {
    await repos.categories.seedDefaults()
    expect(await repos.categories.seedDefaults()).toBe(false)
    expect(await repos.categories.all()).toHaveLength(8)
  })

  it('有墓碑也算"已有"，不会把用户删掉的默认分类复活', async () => {
    await repos.categories.seedDefaults()
    const all = await repos.categories.all()
    for (const c of all) await repos.categories.softDelete(c.id)
    expect(await repos.categories.seedDefaults()).toBe(false)
    expect(await repos.categories.all()).toHaveLength(0)
  })

  it('新建分类排到最后', async () => {
    await repos.categories.seedDefaults()
    const c = await repos.categories.create('宠物')
    expect(c.order).toBe(8)
    const all = await repos.categories.all()
    expect(all[all.length - 1]!.name).toBe('宠物')
  })

  it('rename / reorder', async () => {
    await repos.categories.seedDefaults()
    const all = await repos.categories.all()
    expect((await repos.categories.rename(all[0]!.id, '吃饭')).name).toBe('吃饭')

    const reversed = [...all].reverse().map((c) => c.id)
    await repos.categories.reorder(reversed)
    expect((await repos.categories.all()).map((c) => c.name)[0]).toBe('其他')
  })

  it('nameMap 一次取完，供聚合层避免逐笔查询', async () => {
    await repos.categories.seedDefaults()
    const m = await repos.categories.nameMap()
    expect(m.size).toBe(8)
    expect([...m.values()]).toContain('餐饮')
  })

  it('删除分类后 resolveName 返回「已删除分类」（PRD E21）', async () => {
    const c = await repos.categories.create('临时')
    expect(await repos.categories.resolveName(c.id)).toBe('临时')
    await repos.categories.softDelete(c.id)
    expect(await repos.categories.resolveName(c.id)).toBe('已删除分类')
  })

  it('引用不存在的分类同样返回「已删除分类」', async () => {
    expect(await repos.categories.resolveName('不存在的 id')).toBe('已删除分类')
  })

  it('删除分类不级联删除历史支出', async () => {
    const c = await repos.categories.create('餐饮')
    await repos.expenses.create(k('2026-09-29'), { amountCents: 4500, catId: c.id, note: '午饭' })
    await repos.categories.softDelete(c.id)

    const list = await repos.expenses.byDate(k('2026-09-29'))
    expect(list).toHaveLength(1)
    expect(list[0]!.catId).toBe(c.id) // 引用仍在
    expect(await repos.categories.resolveName(c.id)).toBe('已删除分类')
  })

  it('分类名去空白、限长 12', async () => {
    expect((await repos.categories.create('  餐饮  ')).name).toBe('餐饮')
    await expect(repos.categories.create('a'.repeat(13))).rejects.toMatchObject({ validateCode: 'TOO_LONG' })
  })
})

describe('anniversaries', () => {
  it('创建公历纪念日', async () => {
    const a = await repos.anniversaries.create({
      title: '体检', date: '2026-09-30', isLunar: false, repeat: 'yearly',
    })
    expect(a.title).toBe('体检')
    expect(a.isLunar).toBe(false)
    expect(a.repeat).toBe('yearly')
    expect(a.isLeapMonth).toBe(false)
  })

  it('创建农历纪念日并保留闰月标记（PRD E13）', async () => {
    const a = await repos.anniversaries.create({
      title: '妈妈生日', date: '2026-08-15', isLunar: true, repeat: 'yearly', isLeapMonth: true,
    })
    expect(a.isLunar).toBe(true)
    expect(a.isLeapMonth).toBe(true)
  })

  it('标题去空白、拒绝空标题', async () => {
    expect((await repos.anniversaries.create({ title: '  体检  ', date: '2026-09-30', isLunar: false, repeat: 'none' })).title).toBe('体检')
    await expect(
      repos.anniversaries.create({ title: '', date: '2026-09-30', isLunar: false, repeat: 'none' }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it('拒绝格式错误的日期', async () => {
    await expect(
      repos.anniversaries.create({ title: 'x', date: '2026-9-30', isLunar: false, repeat: 'none' }),
    ).rejects.toMatchObject({ validateCode: 'BAD_DATE' })
  })

  it('update / softDelete / all', async () => {
    const a = await repos.anniversaries.create({ title: '体检', date: '2026-09-30', isLunar: false, repeat: 'none' })
    expect((await repos.anniversaries.update(a.id, { title: '年度体检' })).title).toBe('年度体检')
    expect(await repos.anniversaries.all()).toHaveLength(1)
    await repos.anniversaries.softDelete(a.id)
    expect(await repos.anniversaries.all()).toHaveLength(0)
  })

  it('v7.5 创建 weekly / monthly 纪念日', async () => {
    const w = await repos.anniversaries.create({ title: '周会', date: '2026-10-07', isLunar: false, repeat: 'weekly' })
    expect(w.repeat).toBe('weekly')
    const m = await repos.anniversaries.create({ title: '还款', date: '2026-01-15', isLunar: false, repeat: 'monthly' })
    expect(m.repeat).toBe('monthly')
  })

  it('v7.5 每周/每月重复拒绝农历组合', async () => {
    await expect(
      repos.anniversaries.create({ title: 'x', date: '2026-10-07', isLunar: true, repeat: 'weekly' }),
    ).rejects.toMatchObject({ validateCode: 'BAD_VALUE' })
    await expect(
      repos.anniversaries.create({ title: 'x', date: '2026-01-15', isLunar: true, repeat: 'monthly' }),
    ).rejects.toMatchObject({ validateCode: 'BAD_VALUE' })
  })

  it('v7.5 update 改成农历 + weekly 也拒绝', async () => {
    const a = await repos.anniversaries.create({ title: '周会', date: '2026-10-07', isLunar: false, repeat: 'weekly' })
    await expect(
      repos.anniversaries.update(a.id, { isLunar: true }),
    ).rejects.toMatchObject({ validateCode: 'BAD_VALUE' })
  })
})

describe('settings', () => {
  it('读写与 fallback', async () => {
    expect(await repos.settings.get('accentColor', '#2E4BA6')).toBe('#2E4BA6')
    await repos.settings.set('accentColor', '#2C6B57')
    expect(await repos.settings.get('accentColor', '#2E4BA6')).toBe('#2C6B57')
  })

  it('onboarded 标记（PRD S1 首启引导）', async () => {
    expect(await repos.settings.get('onboarded', false)).toBe(false)
    await repos.settings.set('onboarded', true)
    expect(await repos.settings.get('onboarded', false)).toBe(true)
  })
})

describe('toYuan / toCents（ADR-0003：UI 不得自行 *100 或 /100）', () => {
  it('toYuan 只用于展示', () => {
    expect(toYuan(4500)).toBe(45)
    expect(toYuan(2856)).toBe(28.56)
    expect(toYuan(1)).toBe(0.01)
  })

  it('toCents 走 parseAmount，与校验层同源（不会出现两套换算）', () => {
    expect(toCents('1.005')).toEqual({ ok: true, value: 101 })
    expect(toCents('45')).toEqual({ ok: true, value: 4500 })
    expect(toCents('abc').ok).toBe(false)
    expect(toCents('0').ok).toBe(false)
  })
})

describe('store 层没有被绕过', () => {
  it('repo 写入的记录都带 type 与 deleted 字段（同步与聚合依赖它们）', async () => {
    await repos.todos.create(k('2026-09-29'), 'x')
    await repos.notes.create(k('2026-09-29'), 'y')
    await repos.expenses.create(k('2026-09-29'), { amountCents: 100, catId: 'c' })

    const all = await Promise.all([
      store.all<TodoRecord>('todos'),
      store.all('notes'),
      store.all('expenses'),
    ])
    for (const group of all) {
      for (const r of group) {
        expect(r.deleted).toBe(false)
        expect(typeof (r as { type: string }).type).toBe('string')
        expect(typeof r.createdAt).toBe('number')
        expect(typeof r.updatedAt).toBe('number')
      }
    }
  })

  it('repo 不会物理删除记录（ADR-0001）', async () => {
    const t = await repos.todos.create(k('2026-09-29'), 'x')
    await repos.todos.softDelete(t.id)
    const withTombs = await store.all<TodoRecord>('todos', { includeDeleted: true })
    expect(withTombs).toHaveLength(1)
    expect(withTombs[0]!.deleted).toBe(true)
  })

  it('分类记录的 order 是数字（sortCategories 依赖）', async () => {
    await repos.categories.seedDefaults()
    const all = await store.all<CategoryRecord>('categories')
    expect(all.every((c) => typeof c.order === 'number')).toBe(true)
  })
})
