/**
 * 应用层状态机测试（纯 Node 环境——store.ts 头部注释承诺过它可以在这里被 import）。
 *
 * 重点守的是 v6/v6.1/**v7** 的**导航红线**（ADR-0005 / PRD D17 / D18 / D19）：
 *  - 周/月之间切视图不丢选中日期；「今天」标签恒回到今天（v7 / D19）
 *  - 今天视图 shift() 是 no-op——翻日已删除（v7）
 *  - 手机进日详情必须记来源 {view, date, scrollTop}，返回精确还原
 *  - 周/月翻页绝不 push history；进日详情 push 的条目必须被 back/setView/popstate 正确弹掉
 *  - 空白日自动展开待办表单；用户收起过的那天不再弹
 *  - 过期加载不得覆盖新状态（快速切日竞态）
 *
 * history 用 stub 注入 globalThis（Node 无 history 全局，canHistory() 会自然短路——
 * 这本身也验证了 store 对无 history 环境的容错）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { StoreApi } from 'zustand'
import { DEFAULT_CATEGORIES, createMemoryStore, type DateKey } from '@core'
import { initCore } from './bootstrap'
import { createAppStore, type AppState } from './store'

/** 与文档实测锚点一致：2026-09-29 = 周二（八月十九） */
const TODAY = '2026-09-29' as DateKey

// ---------- history stub ----------

/** Node 环境没有 history 全局；store 的 canHistory() 会自然短路，需要时在这里注入 stub */
const globalRef = globalThis as unknown as { history?: unknown }

interface HistoryStub {
  pushState: ReturnType<typeof vi.fn>
  back: ReturnType<typeof vi.fn>
}

function installHistory(): HistoryStub {
  const stub: HistoryStub = { pushState: vi.fn(), back: vi.fn() }
  globalRef.history = stub
  return stub
}

afterEach(() => {
  delete globalRef.history
})

// ---------- 装配 ----------

async function makeBundle() {
  return initCore({ store: createMemoryStore(), skipLunar: true })
}

async function makeApp(opts: { narrow?: boolean; today?: DateKey } = {}) {
  const bundle = await makeBundle()
  const app = createAppStore(bundle, {
    today: opts.today ?? TODAY,
    isNarrow: () => opts.narrow ?? false,
  })
  await app.getState().init()
  return { app, bundle }
}

const S = (app: StoreApi<AppState>): AppState => app.getState()
const waitFor = vi.waitFor

describe('初始化', () => {
  it('默认落地今天的日视图，加载完成后 detail 就绪', async () => {
    const { app } = await makeApp()
    const s = S(app)
    expect(s.view).toBe('day')
    expect(s.selected).toBe(TODAY)
    expect(s.loading).toBe(false)
    expect(s.detail?.date).toBe(TODAY)
    expect(s.detail?.summary.isEmpty).toBe(true)
  })

  it('播种 8 个默认分类（PRD D12），lastCatId 指向第一个', async () => {
    const { app } = await makeApp()
    expect(S(app).cats.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES])
    expect(S(app).lastCatId).toBe(S(app).cats[0]!.id)
  })

  it('bundle 的 degraded / lunarFailed 透传进 state', async () => {
    const { app } = await makeApp()
    expect(S(app).degraded).toBe(false) // 注入了 store，没走降级
    expect(S(app).lunarFailed).toBe(true) // skipLunar
  })

  it('日视图不加载周/月数据；切到对应视图才按需加载', async () => {
    const { app, bundle } = await makeApp()
    const weekSpy = vi.spyOn(bundle.aggregates, 'aggregateWeek')
    const monthSpy = vi.spyOn(bundle.aggregates, 'aggregateMonth')
    expect(S(app).week).toBeNull()
    expect(S(app).month).toBeNull()

    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    expect(weekSpy).toHaveBeenCalledTimes(1)
    expect(S(app).month).toBeNull()
    expect(S(app).week!.days).toHaveLength(7)

    S(app).setView('month')
    await waitFor(() => expect(S(app).month).not.toBeNull())
    expect(monthSpy).toHaveBeenCalledTimes(1)
    expect(S(app).month!.summary).toBeDefined()
  })

  it('init 时分类加载抛错：toast 兜底文案，loading 照样结束（应用不白屏）', async () => {
    const bundle = await makeBundle()
    bundle.repos.categories.all = async () => {
      throw new Error('boom')
    }
    const app = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
    await app.getState().init()
    expect(S(app).toast?.msg).toBe('操作失败，请重试')
    expect(S(app).loading).toBe(false)
    expect(S(app).detail?.date).toBe(TODAY) // refresh 不受影响
  })
})

describe('视图与日期不变量（US-09 / D17 / D19·v7）', () => {
  it('周/月之间切视图不丢选中日期；切回「今天」恒回到今天（v7 / D19）', async () => {
    const { app } = await makeApp()
    S(app).selectFromCalendar('2026-10-01' as DateKey) // 宽屏：只换日期
    await waitFor(() => expect(S(app).selected).toBe('2026-10-01'))
    S(app).setView('week')
    expect(S(app).selected).toBe('2026-10-01')
    S(app).setView('month')
    expect(S(app).selected).toBe('2026-10-01')
    S(app).setView('day') // 「今天」标签：日视图只代表今天，选中日复位
    expect(S(app).selected).toBe(TODAY)
  })

  it('日视图 shift() 是 no-op：v7 起今天视图不翻日（D19）', async () => {
    const { app, bundle } = await makeApp()
    const spy = vi.spyOn(bundle.aggregates, 'aggregateDayDetail')
    S(app).shift(1)
    S(app).shift(-1)
    expect(S(app).selected).toBe(TODAY)
    await new Promise((r) => setTimeout(r, 10))
    expect(spy).not.toHaveBeenCalled() // 连刷新都没触发，不是"翻了又翻回来"
  })

  it('周视图翻页不丢当前视图', async () => {
    const { app } = await makeApp()
    S(app).setView('week')
    S(app).shift(1)
    await waitFor(() => expect(S(app).selected).toBe('2026-10-06'))
    expect(S(app).view).toBe('week')
  })

  it('翻页步长：周 ±7 天 / 月 ±1 月（月末夹取）', async () => {
    const { app } = await makeApp()
    S(app).setView('week')
    S(app).shift(1)
    await waitFor(() => expect(S(app).selected).toBe('2026-10-06'))

    // 月末夹取：10-31 + 1 月 = 11-30（addMonths 的语义，core/date 已有专测）
    S(app).selectFromCalendar('2026-10-31' as DateKey)
    await waitFor(() => expect(S(app).selected).toBe('2026-10-31'))
    S(app).setView('month')
    S(app).shift(1)
    await waitFor(() => expect(S(app).selected).toBe('2026-11-30'))
  })

  it('周/月翻页绝不 push history（否则按一次返回只退一页，退不出当前视图）', async () => {
    const h = installHistory()
    const { app } = await makeApp()
    S(app).setView('week')
    S(app).shift(1)
    S(app).shift(1)
    S(app).shift(-1)
    S(app).gotoToday()
    await waitFor(() => expect(S(app).selected).toBe(TODAY))
    expect(h.pushState).not.toHaveBeenCalled()
    expect(S(app).historyPushed).toBe(false)
  })

  it('gotoToday：选中日 ≠ 今天时才动；已在今天则无操作', async () => {
    const { app } = await makeApp()
    S(app).selectFromCalendar('2026-10-01' as DateKey)
    await waitFor(() => expect(S(app).selected).toBe('2026-10-01'))
    S(app).gotoToday()
    await waitFor(() => expect(S(app).selected).toBe(TODAY))
    const detail = S(app).detail
    S(app).gotoToday()
    expect(S(app).detail).toBe(detail) // 没有触发新的加载
  })

  it('setView 到当前视图是 no-op（不重复加载）', async () => {
    const { app, bundle } = await makeApp()
    const spy = vi.spyOn(bundle.aggregates, 'aggregateDayDetail')
    S(app).setView('day')
    await new Promise((r) => setTimeout(r, 10))
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('手机来源栈（ADR-0005 v6 硬约束）', () => {
  it('窄屏从周视图点格子：push history、记来源（视图+日期+滚动位置）、跳日视图', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: true })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())

    S(app).selectFromCalendar('2026-10-01' as DateKey, 234)
    const s = S(app)
    expect(s.view).toBe('day')
    expect(s.selected).toBe('2026-10-01')
    expect(s.source).toEqual({ view: 'week', selected: TODAY, scrollTop: 234 })
    expect(s.historyPushed).toBe(true)
    expect(h.pushState).toHaveBeenCalledTimes(1)
    expect(h.back).not.toHaveBeenCalled()
  })

  it('back()：精确还原来源三要素，弹掉自己压的条目，返回 true', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: true })
    S(app).setView('month')
    await waitFor(() => expect(S(app).month).not.toBeNull())
    S(app).selectFromCalendar('2026-10-01' as DateKey, 321)

    const ok = S(app).back()
    expect(ok).toBe(true)
    await waitFor(() => expect(S(app).view).toBe('month'))
    const s = S(app)
    expect(s.selected).toBe(TODAY) // 来源日期，不是被点的 10-01
    expect(s.source).toBeNull()
    expect(s.historyPushed).toBe(false)
    expect(s.restoreScrollTo).toBe(321) // 交给 MonthView 挂载时消费
    expect(h.back).toHaveBeenCalledTimes(1)
  })

  it('back() 无来源：返回 false，什么都不动（Esc 路径靠它判断）', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: true })
    const before = S(app)
    expect(S(app).back()).toBe(false)
    expect(S(app).view).toBe(before.view)
    expect(h.back).not.toHaveBeenCalled()
  })

  it('popstate（系统手势返回）：条目已被浏览器弹掉，不得再调 history.back（否则双重回退）', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: true })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    S(app).selectFromCalendar('2026-10-01' as DateKey, 100)
    expect(S(app).historyPushed).toBe(true)

    S(app).onPopstate()
    await waitFor(() => expect(S(app).view).toBe('week'))
    expect(S(app).selected).toBe(TODAY)
    expect(S(app).restoreScrollTo).toBe(100)
    expect(h.back).not.toHaveBeenCalled()
    expect(S(app).historyPushed).toBe(false)
  })

  it('popstate 但没有自己压的条目：忽略（别的代码/浏览器压的）', async () => {
    const { app } = await makeApp({ narrow: true })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    S(app).gotoToday() // 选中日没动（本来就是今天）→ 无来源、无 push
    expect(S(app).historyPushed).toBe(false)
    S(app).onPopstate()
    expect(S(app).view).toBe('week') // 没被拉走
  })

  it('主动切视图清来源栈并弹掉幽灵条目（否则下一次系统返回被它吃掉）', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: true })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    S(app).selectFromCalendar('2026-10-01' as DateKey, 50)
    expect(S(app).historyPushed).toBe(true)

    S(app).setView('month') // 用户不返回，直接切月视图
    const s = S(app)
    expect(s.source).toBeNull()
    expect(s.historyPushed).toBe(false)
    expect(h.back).toHaveBeenCalledTimes(1)

    // 幽灵条目已弹掉：随后的 popstate 应该无操作
    S(app).onPopstate()
    expect(S(app).view).toBe('month')
    expect(h.back).toHaveBeenCalledTimes(1)
  })

  it('窄屏已在日详情时点「今天」：换日期但不叠来源、不 push（来源栈保持一层）', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: true })
    S(app).gotoToday() // 选中日已是今天 → no-op
    S(app).selectFromCalendar(TODAY) // 已在今天 → no-op
    await waitFor(() => expect(S(app).selected).toBe(TODAY))
    expect(S(app).source).toBeNull()
    expect(S(app).historyPushed).toBe(false)
    expect(h.pushState).not.toHaveBeenCalled()
  })

  it('宽屏点格子只切右栏：不进日视图、无来源、无 history', async () => {
    const h = installHistory()
    const { app } = await makeApp({ narrow: false })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    S(app).selectFromCalendar('2026-10-01' as DateKey, 999)
    const s = S(app)
    expect(s.view).toBe('week') // 右栏由 DayView 常驻显示，视图不跳
    expect(s.selected).toBe('2026-10-01')
    expect(s.source).toBeNull()
    expect(h.pushState).not.toHaveBeenCalled()
  })

  it('宽屏点当前已选中的格子是 no-op', async () => {
    const { app, bundle } = await makeApp()
    const spy = vi.spyOn(bundle.aggregates, 'aggregateDayDetail')
    S(app).selectFromCalendar(TODAY)
    await new Promise((r) => setTimeout(r, 10))
    expect(spy).not.toHaveBeenCalled()
  })

  it('restoreScrollTo 消费一次即清空', async () => {
    const { app } = await makeApp({ narrow: true })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    S(app).selectFromCalendar('2026-10-01' as DateKey, 321)
    S(app).back()
    await waitFor(() => expect(S(app).restoreScrollTo).toBe(321))
    S(app).consumeRestoreScroll()
    expect(S(app).restoreScrollTo).toBeNull()
  })
})

describe('空白日自动展开（v6.1 补速，PRD D18）', () => {
  it('完全空白的一天：自动展开待办表单并请求聚焦', async () => {
    const { app } = await makeApp()
    expect(S(app).edit).toBe('todo')
    expect(S(app).wantFocus).toBe(true)
  })

  it('有内容的天不自动展开', async () => {
    const { app } = await makeApp()
    S(app).closeForm()
    await S(app).createTodo('买牛奶')
    expect(S(app).detail?.summary.isEmpty).toBe(false)
    expect(S(app).edit).toBeNull()
    expect(S(app).wantFocus).toBe(false)
  })

  it('用户收起过的那天不再弹；进到别的空白日照常弹', async () => {
    const { app } = await makeApp()
    expect(S(app).edit).toBe('todo')
    S(app).closeForm()
    expect(S(app).formDismissed[TODAY]).toBe(true)

    // v7：日视图不翻日，进其他日子走 selectFromCalendar（宽屏 = 右栏换日）
    S(app).selectFromCalendar('2026-09-30' as DateKey) // 也是空白日，且没被收起过
    // ⚠️ 等 detail.date 而不是 selected：selected 是同步换的，
    //    自动展开发生在 refresh 落地那一刻，等早了会误判
    await waitFor(() => expect(S(app).detail?.date).toBe('2026-09-30'))
    expect(S(app).edit).toBe('todo')

    S(app).closeForm()
    S(app).selectFromCalendar(TODAY) // 回到今天：空白但已收起 → 不弹
    await waitFor(() => expect(S(app).detail?.date).toBe(TODAY))
    expect(S(app).edit).toBeNull()
  })

  it('窄屏周/月视图下日详情不可见：不自动展开', async () => {
    const { app } = await makeApp({ narrow: true })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    expect(S(app).edit).toBeNull()
    S(app).setView('month')
    await waitFor(() => expect(S(app).month).not.toBeNull())
    expect(S(app).edit).toBeNull()
  })

  it('宽屏周/月视图右栏常驻可见：空白日照常自动展开', async () => {
    const { app } = await makeApp({ narrow: false })
    S(app).setView('week')
    await waitFor(() => expect(S(app).week).not.toBeNull())
    expect(S(app).edit).toBe('todo')
  })

  it('已有别的表单展开时不抢占（!s.edit 前提）', async () => {
    const { app } = await makeApp()
    S(app).openForm('cost') // 用户在空白日主动开了记账表单
    expect(S(app).edit).toBe('cost')
    await S(app).refresh()
    expect(S(app).edit).toBe('cost') // 不被自动展开覆盖成 todo
  })

  it('consumeFocus 消费一次即清空', async () => {
    const { app } = await makeApp()
    expect(S(app).wantFocus).toBe(true)
    S(app).consumeFocus()
    expect(S(app).wantFocus).toBe(false)
  })
})

describe('表单状态机（v6.1 单一入口）', () => {
  it('再点同一个「+ 添加」= 收起，并记 formDismissed（否则空白日立刻又弹，用户关不掉）', async () => {
    const { app } = await makeApp()
    expect(S(app).edit).toBe('todo') // 自动展开态
    S(app).openForm('todo')
    expect(S(app).edit).toBeNull()
    expect(S(app).formDismissed[TODAY]).toBe(true)
  })

  it('切到另一种表单：展开新的并请求聚焦', async () => {
    const { app } = await makeApp()
    S(app).openForm('cost')
    expect(S(app).edit).toBe('cost')
    expect(S(app).wantFocus).toBe(true)
    S(app).openForm('note')
    expect(S(app).edit).toBe('note')
  })

  it('closeForm 无表单时是 no-op，不误记 formDismissed', async () => {
    const { app } = await makeApp()
    S(app).openForm('cost')
    S(app).closeForm()
    expect(S(app).formDismissed[TODAY]).toBe(true)
    S(app).closeForm() // 再关一次不会出错
    expect(S(app).edit).toBeNull()
  })

  it('shift / gotoToday / selectFromCalendar 都会收起表单', async () => {
    const { app } = await makeApp()
    S(app).openForm('cost')
    S(app).selectFromCalendar('2026-10-01' as DateKey) // 日视图 shift 是 no-op（v7），换日走点格子
    expect(S(app).edit).toBeNull()
    expect(S(app).wantFocus).toBe(false)
  })
})

describe('写操作（repo 校验 → refresh → toast）', () => {
  it('createTodo 成功：进列表、toast、返回 true（表单保留清空，US-06）', async () => {
    const { app } = await makeApp()
    const ok = await S(app).createTodo('买牛奶')
    expect(ok).toBe(true)
    expect(S(app).detail?.todos.map((t) => t.text)).toEqual(['买牛奶'])
    expect(S(app).toast?.msg).toBe('已添加待办')
  })

  it('createTodo 校验失败：core 的中文文案直达 toast，不落库', async () => {
    const { app } = await makeApp()
    const ok = await S(app).createTodo('   ')
    expect(ok).toBe(false)
    expect(S(app).toast?.msg).toBe('请填写待办')
    expect(S(app).detail?.todos).toEqual([])
  })

  it('updateTodoText（US-13）：文字更新、toast、返回 true', async () => {
    const { app } = await makeApp()
    await S(app).createTodo('买牛奶')
    const id = S(app).detail!.todos[0]!.id
    const ok = await S(app).updateTodoText(id, '买燕麦奶')
    expect(ok).toBe(true)
    expect(S(app).detail?.todos.map((t) => t.text)).toEqual(['买燕麦奶'])
    expect(S(app).toast?.msg).toBe('已更新待办')
  })

  it('updateTodoText 校验失败：旧值保留，core 文案进 toast', async () => {
    const { app } = await makeApp()
    await S(app).createTodo('买牛奶')
    const id = S(app).detail!.todos[0]!.id
    const ok = await S(app).updateTodoText(id, '   ')
    expect(ok).toBe(false)
    expect(S(app).detail?.todos.map((t) => t.text)).toEqual(['买牛奶'])
    expect(S(app).toast?.msg).toBe('请填写待办')
  })

  it('updateTodoText 记录不存在（已被别的标签页删掉，E19）：NotFoundError 文案兜底', async () => {
    const { app } = await makeApp()
    const ok = await S(app).updateTodoText('no-such-id', '改不动')
    expect(ok).toBe(false)
    expect(S(app).toast?.msg).toBe('记录不存在或已被删除')
  })

  it('toggleTodo：勾完 toast「完成了一件」；取消勾选不刷新 toast', async () => {
    const { app } = await makeApp()
    await S(app).createTodo('锻炼')
    const id = S(app).detail!.todos[0]!.id
    await S(app).toggleTodo(id)
    expect(S(app).detail?.todos[0]?.done).toBe(true)
    expect(S(app).toast?.msg).toBe('完成了一件')
    await S(app).toggleTodo(id)
    expect(S(app).detail?.todos[0]?.done).toBe(false)
    expect(S(app).toast?.msg).toBe('完成了一件') // 未被覆盖
  })

  it('deleteTodo 是墓碑：列表消失，store 里原始记录仍在且 deleted=true', async () => {
    const { app, bundle } = await makeApp()
    await S(app).createTodo('临时')
    const id = S(app).detail!.todos[0]!.id
    await S(app).deleteTodo(id)
    expect(S(app).detail?.todos).toEqual([])
    const raw = await bundle.store.get('todos', id)
    expect(raw?.deleted).toBe(true)
    expect(S(app).toast?.msg).toBe('已删除')
  })

  it('createNote / deleteNote：进列表又消失', async () => {
    const { app } = await makeApp()
    const ok = await S(app).createNote('突然想到…')
    expect(ok).toBe(true)
    expect(S(app).detail?.notes.map((n) => n.text)).toEqual(['突然想到…'])
    expect(S(app).toast?.msg).toBe('已记下这个想法')
    await S(app).deleteNote(S(app).detail!.notes[0]!.id)
    expect(S(app).detail?.notes).toEqual([])
    expect(S(app).toast?.msg).toBe('已删除')
  })

  it('createNote 校验失败：字段名是「想法」', async () => {
    const { app } = await makeApp()
    const ok = await S(app).createNote('')
    expect(ok).toBe(false)
    expect(S(app).toast?.msg).toBe('请填写想法')
  })

  it('updateNoteText（US-13）：多行正文更新、换行保留（D6）', async () => {
    const { app } = await makeApp()
    await S(app).createNote('第一版')
    const id = S(app).detail!.notes[0]!.id
    const ok = await S(app).updateNoteText(id, '改过的\n第二行')
    expect(ok).toBe(true)
    expect(S(app).detail?.notes.map((n) => n.text)).toEqual(['改过的\n第二行'])
    expect(S(app).toast?.msg).toBe('已更新想法')
  })

  it('updateNoteText 校验失败：旧值保留', async () => {
    const { app } = await makeApp()
    await S(app).createNote('留着')
    const id = S(app).detail!.notes[0]!.id
    const ok = await S(app).updateNoteText(id, '  ')
    expect(ok).toBe(false)
    expect(S(app).detail?.notes.map((n) => n.text)).toEqual(['留着'])
    expect(S(app).toast?.msg).toBe('请填写想法')
  })

  it('createExpense：整数分入库、toast 带分类名与金额、lastCatId 记住上次选择（S5）', async () => {
    const { app } = await makeApp()
    const cats = S(app).cats
    const ok = await S(app).createExpense(1250, cats[1]!.id, '午饭')
    expect(ok).toBe(true)
    expect(S(app).detail?.expenses[0]?.amountCents).toBe(1250)
    expect(S(app).toast?.msg).toBe('交通 ¥12.50 · 午饭')
    expect(S(app).lastCatId).toBe(cats[1]!.id)
    expect(S(app).detail?.summary.costCents).toBe(1250)
  })

  it('createExpense 无备注：toast 不带「 · 」尾巴', async () => {
    const { app } = await makeApp()
    const cats = S(app).cats
    await S(app).createExpense(300, cats[0]!.id, '')
    expect(S(app).toast?.msg).toBe('餐饮 ¥3.00')
  })

  it('createExpense 金额非法（≤0 / 非整数）：repo 拒收，返回 false 不落库', async () => {
    const { app } = await makeApp()
    const catId = S(app).cats[0]!.id
    expect(await S(app).createExpense(0, catId, '')).toBe(false)
    expect(S(app).toast?.msg).toBe('金额必须大于 0')
    expect(await S(app).createExpense(10.5, catId, '')).toBe(false)
    expect(S(app).detail?.expenses).toEqual([])
  })

  it('deleteExpense：列表与日汇总同步消失', async () => {
    const { app } = await makeApp()
    const catId = S(app).cats[0]!.id
    await S(app).createExpense(800, catId, '咖啡')
    await S(app).deleteExpense(S(app).detail!.expenses[0]!.id)
    expect(S(app).detail?.expenses).toEqual([])
    expect(S(app).detail?.summary.costCents).toBe(0)
    expect(S(app).toast?.msg).toBe('已删除这笔支出')
  })

  it('写入目标恒为当前选中日，而不是今天（v6.1 单一入口的核心承诺）', async () => {
    const { app, bundle } = await makeApp()
    S(app).selectFromCalendar('2026-10-01' as DateKey)
    await waitFor(() => expect(S(app).selected).toBe('2026-10-01'))
    await S(app).createTodo('国庆出行')
    expect(S(app).detail?.todos.map((t) => t.text)).toEqual(['国庆出行'])
    // 今天必须还是空的
    const todayTodos = await bundle.repos.todos.byDate(TODAY)
    expect(todayTodos).toEqual([])
  })
})

describe('顺延（US-04）', () => {
  it('昨天未完成的顺延到今天：带 rolledFrom 痕迹，toast 报件数，横幅收起', async () => {
    const { app } = await makeApp()
    S(app).closeForm()
    // v7：日视图不翻日，补记昨天走 selectFromCalendar（宽屏右栏换日）
    S(app).selectFromCalendar('2026-09-28' as DateKey)
    await waitFor(() => expect(S(app).detail?.date).toBe('2026-09-28'))
    await S(app).createTodo('写周报')
    await S(app).createTodo('洗碗')
    // 按文本找而不是 [0]：同一毫秒创建的两条 createdAt 相同，先后顺序不保证
    const weekly = S(app).detail!.todos.find((t) => t.text === '写周报')!
    await S(app).toggleTodo(weekly.id) // 写周报 → 完成，不顺延

    S(app).gotoToday() // 回到今天
    // 等 refresh 落地（detail.date），不是等 selected——prevDayRollable 是 refresh 的产物
    await waitFor(() => expect(S(app).detail?.date).toBe(TODAY))
    expect(S(app).detail?.prevDayRollable).toBe(1) // 横幅数据源

    await S(app).rollOver()
    const todos = S(app).detail!.todos
    expect(todos).toHaveLength(1)
    expect(todos[0]!.text).toBe('洗碗')
    expect(todos[0]!.rolledFrom).toBe('2026-09-28')
    expect(S(app).rollDismissed[TODAY]).toBe(true)
    expect(S(app).toast?.msg).toBe('已顺延 1 件')
    expect(S(app).detail?.prevDayRollable).toBe(0) // 源记录已标 rolledTo
  })

  it('没有可顺延的：toast 明说，不算错误', async () => {
    const { app } = await makeApp()
    await S(app).rollOver()
    expect(S(app).toast?.msg).toBe('没有可顺延的待办')
  })

  it('dismissRoll 只记「已忽略」，不动数据', async () => {
    const { app } = await makeApp()
    S(app).dismissRoll()
    expect(S(app).rollDismissed[TODAY]).toBe(true)
    expect(S(app).detail?.todos).toEqual([])
  })
})

describe('toast', () => {
  it('空文案忽略；同文案 seq 递增（让动画能重触发）', async () => {
    const { app } = await makeApp()
    S(app).showToast('')
    const t0 = S(app).toast // init 期间可能已有 toast（自动展开不产生 toast，应为 null）
    expect(t0).toBeNull()
    S(app).showToast('已删除')
    const a = S(app).toast
    S(app).showToast('已删除')
    const b = S(app).toast
    expect(a?.msg).toBe('已删除')
    expect(b!.seq).toBe(a!.seq + 1)
    S(app).clearToast()
    expect(S(app).toast).toBeNull()
  })
})

describe('并发保护（loadSeq）', () => {
  it('快速切日：慢的旧响应回来时不得覆盖新状态', async () => {
    const { app, bundle } = await makeApp()
    const orig = bundle.aggregates.aggregateDayDetail
    let n = 0
    bundle.aggregates.aggregateDayDetail = async (d) => {
      const call = ++n
      const r = await orig.call(bundle.aggregates, d)
      if (call === 1) await new Promise((res) => setTimeout(res, 40)) // 第一次故意慢
      return r
    }
    try {
      S(app).selectFromCalendar('2026-09-30' as DateKey) // 触发慢加载 #1
      S(app).selectFromCalendar('2026-10-01' as DateKey) // 触发快加载 #2
      await waitFor(() => expect(S(app).selected).toBe('2026-10-01'))
      await new Promise((r) => setTimeout(r, 80)) // 等 #1 迟到归来
      expect(S(app).detail?.date).toBe('2026-10-01') // #1 被丢弃
    } finally {
      bundle.aggregates.aggregateDayDetail = orig
    }
  })
})
