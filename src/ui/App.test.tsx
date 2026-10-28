/**
 * UI 冒烟测试（守"上线的东西能跑"）：
 *  1. 应用挂载 → 默认「今天」视图显示今天（v6 落地页 / v7 并入今天语义）；空白日不自动展开表单（v7.2），手动点「+ 添加」才弹出
 *  2. 点「添加待办」→ 表单里敲字回车 → 待办出现在列表里（v6.1 单一录入入口全链路）
 *  3. 点已存待办的文字 → 就地编辑（v7 / US-13）
 *  4. 切到月视图 → 42 格网格；点「今天」标签 → 回到今天（v7 / D19：切回今天恒复位选中日）
 *
 * 更细的交互（来源栈、快捷键、日视图不翻日）已在 src/app/store.test.ts 的状态机层覆盖，
 * 这里只验证"渲染 + 事件接线"没有断。
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { addDays, createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

// vitest 没开 globals，RTL 的自动 cleanup 不会注册——必须手动，否则渲染跨用例累积
afterEach(cleanup)

// v8.56 安装引导：默认 jsdom UA 是桌面 Linux，banner 不显示；用例需临时 mock 移动端 UA / standalone，
// 否则其他用例不受影响。afterEach 统一还原。
const DEFAULT_UA = window.navigator.userAgent
function mockUA(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { get: () => ua, configurable: true })
}
function restoreUA() {
  Object.defineProperty(window.navigator, 'userAgent', { get: () => DEFAULT_UA, configurable: true })
}
afterEach(restoreUA)

const TODAY = '2026-09-29' as DateKey

async function renderApp() {
  // v7.5：夜间模式读 localStorage，测试间必须清掉，否则上个用例切了 dark 会串场
  localStorage.clear()
  const bundle = await initCore({
    store: createMemoryStore(),
    skipLunar: true,
    // v8.54：注入与 TODAY 一致的递增假时钟——首条 createdAt 落在 9/29（本地时区），
    // 每次 +1ms 保证 createdAt 严格递增（想法列表按 createdAt 降序排序才稳定），
    // 同时 DDL「只从创建当天起注入」的过滤语义自洽。
    now: (() => { let t = new Date(2026, 8, 29, 12).getTime(); return () => (t += 1) })(),
  })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

describe('App 冒烟', () => {
  it('日视图滑动翻页 v8.11：左滑到明天、右滑回今天、短滑回弹不翻（手势跟手 + 两阶段滑入）', async () => {
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    const scroller = screen.getByTestId('day-scroll')

    // 左滑（dx = -120）→ 阶段一滑出 → transitionEnd → 切到明天 + 阶段二滑入
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 140, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 30 日'))
    // 等待阶段二动画计时器复位 swipeBusy，再发起新手势
    await new Promise((r) => setTimeout(r, 400))

    // 右滑（dx = +120）→ 回到今天
    fireEvent.touchStart(scroller, { touches: [{ clientX: 140, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 260, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    await new Promise((r) => setTimeout(r, 400))

    // 短滑（dx = 30，低于阈值）→ 回弹，日期不变
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 230, clientY: 156 }] })
    fireEvent.touchEnd(scroller)
    await new Promise((r) => setTimeout(r, 50))
    expect(document.body.textContent).toContain('2026 年 9 月 29 日')
  })

  it('默认落地今天的日视图；空白日不自动展开，手动点「+ 添加」才弹出（v7.2）', async () => {
    await renderApp()
    expect(document.body.textContent).toContain('2026 年 9 月 29 日')
    expect(document.querySelector('[class*="todayMark"]')?.textContent).toBe('今天') // 日头「今天」徽标（v7.3 起 TabBar 里也有「今天」文字，需按类定位）
    expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument() // 不再自动展开（v7.2）
    expect(screen.getByRole('tab', { name: '今天' })).toBeInTheDocument() // v7：切换器首标签

    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    expect(screen.getByLabelText('新待办')).toBeInTheDocument()
  })

  it('v8.12 三页轨道：滑动途中相邻日内容同时可见（预取落地自动填充，不再白屏）', async () => {
    const store = await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    // 造数据：今天一条 + 明天一条（明天通过 shiftDay 写入后翻回今天）
    await store.getState().createTodo('今天的事')
    await store.getState().shiftDay(1)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 30 日'))
    await store.getState().createTodo('明天的事')
    await store.getState().shiftDay(-1)
    await waitFor(() => expect(document.body.textContent).toContain('今天的事'))

    // 轨道三页同屏：昨天（侧页，空态）、今天（中间）、明天（侧页，预取到待办摘要）
    expect(document.body.textContent).toContain('2026 年 9 月 28 日')
    expect(document.body.textContent).toContain('2026 年 9 月 30 日')
    await waitFor(() => expect(document.body.textContent).toContain('明天的事'))

    // 手势跟手途中，三页内容依然全部在 DOM（不是"滑过去再加载"）
    const scroller = screen.getByTestId('day-scroll')
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 140, clientY: 158 }] })
    expect(document.body.textContent).toContain('明天的事')
    expect(document.body.textContent).toContain('今天的事')
    fireEvent.touchEnd(scroller)
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 30 日'))
    await new Promise((r) => setTimeout(r, 400))
  })

  it('v8.17 轨道过渡位移防回归：左滑滑向第3页(-66.6667%)、右滑滑向第1页(0%)，不滑出屏幕外', async () => {
    // 曾误写 -133.3333%/66.6667%（translateX 百分比相对轨道自身宽 300%=3 屏 → ±4/2 屏），
    // 松手后滑到屏幕外 → 落地全白零点几秒直到重排复位。本测试在 transitionEnd 前断言过渡目标。
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    const scroller = screen.getByTestId('day-scroll')

    // 左滑超阈值 → 松手后（预取命中缓存微任务）过渡目标 = -66.6667%（显示右页，仍在屏内）
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 140, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    await waitFor(() => expect(scroller.style.transform).toBe('translateX(-66.6667%)'))
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 30 日'))
    await new Promise((r) => setTimeout(r, 400))

    // 右滑超阈值 → 过渡目标 = translateX(0%)（显示左页，仍在屏内）
    fireEvent.touchStart(scroller, { touches: [{ clientX: 140, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 260, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    await waitFor(() => expect(scroller.style.transform).toBe('translateX(0%)'))
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
  })

  it('点「添加待办」→ 敲字回车 → 待办出现在列表（单一录入入口全链路）', async () => {
    await renderApp()
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '买牛奶' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('买牛奶')).toBeInTheDocument()
    // v7.4：创建完表单收起（不再保留并清空连续录入，用户拍板改手动）
    await waitFor(() => expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument())
  })

  it('点已存待办的文字 → 就地编辑，回车保存（v7 / US-13）', async () => {
    await renderApp()
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '买牛奶' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('买牛奶')

    fireEvent.click(screen.getByLabelText('编辑待办：买牛奶'))
    const edit = await screen.findByLabelText('编辑待办')
    expect((edit as HTMLInputElement).value).toBe('买牛奶')
    fireEvent.change(edit, { target: { value: '买燕麦奶' } })
    fireEvent.keyDown(edit, { key: 'Enter' })
    expect(await screen.findByText('买燕麦奶')).toBeInTheDocument()
    expect(screen.queryByText('买牛奶')).not.toBeInTheDocument()
  })

  it('切月视图出 42 格；点「今天」标签回到今天（v7 / D19）', async () => {
    const store = await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    // v8.34 三页轨道：月视图同时渲染上/下月三屏，中间屏（month-center）才是当前月 42 格
    await waitFor(() => expect(within(screen.getByTestId('month-center')).getAllByRole('gridcell')).toHaveLength(42))

    // 月视图里点一个非今天的格子（宽屏：右栏换日，selected 跟着走）
    fireEvent.click(within(screen.getByTestId('month-center')).getByLabelText(/10月1日/))
    await waitFor(() => expect(store.getState().selected).toBe('2026-10-01'))

    // 点「今天」标签：v7 起恒复位到今天（日视图 = 今天）
    fireEvent.click(screen.getByRole('tab', { name: '今天' }))
    await waitFor(() => expect(store.getState().selected).toBe(TODAY))
    expect(store.getState().view).toBe('day')
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
  })

  it('月格：v8.4 起不再显示支出金额行；想法以点提示在右下角（v7.1）', async () => {
    const store = await renderApp()
    // v8.0 起今天视图不再录入支出（记账走 iCost），改走 store action 造数，验证月格 v8.4 不再展示金额
    await store.getState().createExpense(12900, 'other', '午饭')
    await waitFor(() => expect(store.getState().detail?.summary.costCents).toBe(12900))
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加想法' }))
    fireEvent.change(screen.getByLabelText('新想法'), { target: { value: '一个念头' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' }).at(-1)!)
    await waitFor(() => expect(store.getState().detail?.notes).toHaveLength(1))

    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    await waitFor(() => expect(within(screen.getByTestId('month-center')).getAllByRole('gridcell')).toHaveLength(42))
    const cell = within(screen.getByTestId('month-center')).getByLabelText(/2026年9月29日/)
    // v8.4：支出数据仍在（历史兼容），但月格不再渲染金额行
    expect(cell.textContent).not.toContain('¥')
    expect(cell.textContent).not.toContain('129')
    // 行3 右下角：想法点（i 元素，aria-hidden，条数 1 不带数字）
    const nind = cell.querySelector('[class*="nind"]')
    expect(nind).not.toBeNull()
    expect(nind!.querySelector('i')).not.toBeNull()
    expect(nind!.textContent).toBe('')
    // 无待办 → 不渲染进度 chip
    expect(cell.querySelector('[class*="prog"]')).toBeNull()
  })

  it('v8.36 换日（点月格）落地：中间屏不闪旧日内容（标题新日、内容旧日的错位已杜绝）', async () => {
    const store = await renderApp()
    // 今天（9/29）造一条待办
    await store.getState().createTodo('今天的事')
    await waitFor(() => expect(within(screen.getByTestId('day-center')).getByText('今天的事')).toBeInTheDocument())

    // 切月视图 → 点 10/1 格子（宽屏：右栏换日，selected 变 10/1）
    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    await waitFor(() => expect(within(screen.getByTestId('month-center')).getAllByRole('gridcell')).toHaveLength(42))
    fireEvent.click(within(screen.getByTestId('month-center')).getByLabelText(/10月1日/))
    await waitFor(() => expect(store.getState().selected).toBe('2026-10-01'))

    // 落地后中间屏是 10/1（标题用 k 恒正确）；旧日内容「今天的事」绝不出现在中间屏
    await waitFor(() => expect(within(screen.getByTestId('day-center')).getByText('2026 年 10 月 1 日')).toBeInTheDocument())
    expect(within(screen.getByTestId('day-center')).queryByText('今天的事')).toBeNull()
  })

  it('v8.34 周视图滑动：左滑下一周、右滑回本周、短滑回弹不翻（箭头仍可用）', async () => {
    const store = await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '周' }))
    const scroller = screen.getByTestId('week-scroll')
    // 本周（2026-09-28 ~ 10-04，TODAY=09-29）：中间屏含 9/29
    await waitFor(() =>
      expect(within(screen.getByTestId('week-center')).getAllByText(/9\/29/).length).toBeGreaterThan(0),
    )

    // 左滑（dx=-120）→ 预取 → 过渡 → 换下一周（selected=10/06），中间屏变下周（含 10/6）
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 140, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    // 等目标页预取完成、transitionend 监听注册后再派发过渡结束（jsdom 无真 CSS transition）
    await new Promise((r) => setTimeout(r, 120))
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(store.getState().selected).toBe('2026-10-06'))
    await waitFor(() =>
      expect(within(screen.getByTestId('week-center')).getAllByText(/10\/6/).length).toBeGreaterThan(0),
    )
    await new Promise((r) => setTimeout(r, 400))

    // 右滑（dx=+120）→ 回本周（selected=TODAY）
    fireEvent.touchStart(scroller, { touches: [{ clientX: 140, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 260, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    await new Promise((r) => setTimeout(r, 120))
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(store.getState().selected).toBe(TODAY))
    await new Promise((r) => setTimeout(r, 400))

    // 短滑（dx=30，低于阈值）→ 回弹，selected 不变
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 230, clientY: 156 }] })
    fireEvent.touchEnd(scroller)
    await new Promise((r) => setTimeout(r, 50))
    expect(store.getState().selected).toBe(TODAY)
  })

  it('v8.34 月视图滑动：左滑下一月、右滑回本月、短滑回弹不翻（箭头仍可用）', async () => {
    const store = await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    const scroller = screen.getByTestId('month-scroll')
    const center = (): HTMLElement => screen.getByTestId('month-center')
    await waitFor(() => expect(within(center()).getAllByRole('gridcell')).toHaveLength(42))
    expect(within(center()).getByLabelText(/2026年9月29日/)).toBeInTheDocument()

    // 左滑 → 下一月（selected=10/29）：中间屏变 10 月网格（含今天 10/13，9 月网格不含）
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 140, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    await new Promise((r) => setTimeout(r, 120))
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(store.getState().selected).toBe('2026-10-29'))
    await waitFor(() => expect(within(center()).getByLabelText(/2026年10月13日/)).toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 400))

    // 右滑 → 回本月（selected=TODAY）
    fireEvent.touchStart(scroller, { touches: [{ clientX: 140, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 260, clientY: 158 }] })
    fireEvent.touchEnd(scroller)
    await new Promise((r) => setTimeout(r, 120))
    fireEvent.transitionEnd(scroller)
    await waitFor(() => expect(store.getState().selected).toBe(TODAY))
    await new Promise((r) => setTimeout(r, 400))

    // 短滑 → 回弹，selected 不变
    fireEvent.touchStart(scroller, { touches: [{ clientX: 260, clientY: 150 }] })
    fireEvent.touchMove(scroller, { touches: [{ clientX: 230, clientY: 156 }] })
    fireEvent.touchEnd(scroller)
    await new Promise((r) => setTimeout(r, 50))
    expect(store.getState().selected).toBe(TODAY)
  })

  it('v7.5 今天视图顶栏不再显示日期与周几（内容区保留完整日期）', async () => {
    await renderApp()
    // 顶栏只留品牌；日期在内容区（dhead），不重复
    const header = document.querySelector('header')!
    expect(header.textContent).toContain('DayCell')
    expect(header.textContent).not.toContain('29 日')
    expect(header.textContent).not.toContain('2026 年')
    expect(document.body.textContent).toContain('2026 年 9 月 29 日') // 内容区仍在
  })

  it('v8.0 今天视图不再显示支出区块（记账走 iCost，历史数据仍进月格）', async () => {
    await renderApp()
    // 支出录入入口与区块从今天视图移除（用户拍板）
    expect(screen.queryByRole('button', { name: '记一笔支出' })).not.toBeInTheDocument()
    expect(screen.queryByText('支出')).not.toBeInTheDocument()
    // 待办/想法区块仍在
    expect(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' })).toBeInTheDocument()
    expect(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加想法' })).toBeInTheDocument()
  })

  it('v7.6 已完成的待办自动沉底，未完成保持原序', async () => {
    await renderApp()
    // 先加「甲」，再加「乙」，再勾掉「甲」→ 顺序应变 乙、甲
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    let input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '甲' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('甲')

    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '乙' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('乙')

    fireEvent.click(screen.getByRole('button', { name: '标记完成：甲' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '标记未完成：甲' })).toBeInTheDocument())

    const rows = screen.getAllByLabelText(/^编辑待办：/)
    expect(rows.map((el) => el.getAttribute('aria-label'))).toEqual(['编辑待办：乙', '编辑待办：甲'])
  })

  it('v7.5/v8.0/v8.1/v8.3/v8.4 右上角菜单：项齐全、顺序正确（含习惯/同步/使用手册/版本更新、无关于）、夜间模式开关生效', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual(['导出备份', '导入备份', '一键导出 MD', '特殊日设置', '习惯设置', '同步设置', '偏好设置', '使用手册', '版本更新'])
    expect(screen.getByRole('switch')).toBeInTheDocument() // 夜间模式行（最下面，分隔线之后）
    expect(screen.getByText('夜间模式')).toBeInTheDocument()

    // 默认浅色；点开关 → 深色（html data-theme + localStorage 持久化）
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('switch'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('daycell-theme')).toBe('dark')
  })

  it('v8.29 特殊日待办可勾选：圆圈勾掉划线置灰、再点取消恢复', async () => {
    const store = await renderApp()
    // 创建一个 09-29 的每年特殊日（today=2026-09-29 命中）
    await store.getState().createAnniversary({ title: '发工资日', date: '2025-09-29', repeat: 'yearly', isLunar: false })

    await waitFor(() => expect(document.body.textContent).toContain('发工资日'))
    // 与普通待办同款勾选圆圈（可点按钮，非只读 ◷）
    const chk = screen.getByRole('button', { name: '标记完成：发工资日' })
    expect(chk).toHaveAttribute('aria-pressed', 'false')

    // 勾掉 → 划线置灰（annivDones 持久化到当天×该特殊日）
    fireEvent.click(chk)
    await waitFor(() => expect(screen.getByRole('button', { name: '取消标记：发工资日' })).toHaveAttribute('aria-pressed', 'true'))
    expect(store.getState().detail?.annivDones).toContain(store.getState().annivList[0].id)

    // 再点 → 取消勾选
    fireEvent.click(screen.getByRole('button', { name: '取消标记：发工资日' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '标记完成：发工资日' })).toHaveAttribute('aria-pressed', 'false'))
    expect(store.getState().detail?.annivDones).not.toContain(store.getState().annivList[0].id)
  })

  it('v7.5 特殊日设置：从菜单进入、新增每周特殊日、列表显示', async () => {
    const store = await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '特殊日设置' }))

    // 设置页出现（覆盖层），从空列表开始
    expect(screen.getByRole('dialog', { name: '特殊日设置' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '＋ 新增' }))

    // 填名字、切每周、选周三
    fireEvent.change(screen.getByPlaceholderText('如：妈妈的生日、发工资'), { target: { value: '每周例会' } })
    fireEvent.click(screen.getByRole('button', { name: '每周' }))
    fireEvent.click(screen.getByRole('button', { name: '周三' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    // 回到列表：名称 + 频率描述
    expect(await screen.findByText('每周例会')).toBeInTheDocument()
    expect(screen.getByText('每周周三')).toBeInTheDocument()
    expect(store.getState().annivList).toHaveLength(1)
    expect(store.getState().annivList[0]).toMatchObject({ repeat: 'weekly', isLunar: false })
  })

  it('v7.6 想法创建成功后面板收起，不自动弹新条目（支出区块 v8.0 已移除）', async () => {
    await renderApp()

    // 想法：添加 → 保存 → 表单消失
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加想法' }))
    fireEvent.change(screen.getByLabelText('新想法'), { target: { value: '一个念头' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' }).at(-1)!)
    await screen.findByText('一个念头')
    await waitFor(() => expect(screen.queryByLabelText('新想法')).not.toBeInTheDocument())
  })
})

describe('v8.13 想法 tab（5 tab 布局 / 列表 / 分页 / 点击进日视图）', () => {
  it('底部 tab 从左到右：目标 | 想法 | 今天 | 周 | 月，默认打开今日视图', async () => {
    await renderApp()
    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(5)
    expect(tabs[0]).toHaveAccessibleName('目标')
    expect(tabs[1]).toHaveAccessibleName('回顾')
    expect(tabs[2]).toHaveAccessibleName('今天')
    expect(tabs[3]).toHaveAccessibleName('周')
    expect(tabs[4]).toHaveAccessibleName('月')
    // 默认仍是今日视图（落地页不变）
    expect(document.body.textContent).toContain('2026 年 9 月 29 日')
  })

  it('点「想法」tab：空态引导', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '回顾' }))
    await waitFor(() => expect(document.body.textContent).toContain('还没有记过想法'))
  })

  it('列表按天分组显示、点击条目进入该日日视图（编辑删除在日视图做）', async () => {
    const store = await renderApp()
    await store.getState().createNote('十月一日记的念头')
    await store.getState().shiftDay(1) // → 9/30
    await store.getState().createNote('九月三十日的念头')
    await store.getState().shiftDay(-1) // → 9/29
    await waitFor(() => expect(document.body.textContent).toContain('十月一日记的念头'))

    fireEvent.click(screen.getByRole('tab', { name: '回顾' }))
    await waitFor(() => expect(document.body.textContent).toContain('共 2 条想法'))
    expect(document.body.textContent).toContain('十月一日记的念头')

    // v8.31：点击条目 → 原地出现编辑框（不再跳日视图）
    fireEvent.click(screen.getByRole('button', { name: /九月三十日的念头/ }))
    await waitFor(() => expect(screen.getByLabelText('编辑想法')).toBeInTheDocument())
    expect(document.body.textContent).not.toContain('2026 年 9 月 30 日')

    // 修改文本并保存 → 列表文本更新、编辑框收起
    fireEvent.change(screen.getByLabelText('编辑想法'), { target: { value: '改过的念头' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(document.body.textContent).toContain('改过的念头'))
    expect(screen.queryByLabelText('编辑想法')).not.toBeInTheDocument()

    // 删除需确认：confirm 取消不删、确认后删除
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(screen.getAllByRole('button', { name: '删除这条想法' })[0])
    await waitFor(() => expect(document.body.textContent).toContain('改过的念头'))
    expect(confirmSpy).toHaveBeenCalled()
    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getAllByRole('button', { name: '删除这条想法' })[0])
    await waitFor(() => expect(document.body.textContent).toContain('共 1 条想法'))
    expect(document.body.textContent).not.toContain('改过的念头')
    confirmSpy.mockRestore()
  })

  it('10 条一页：11 条想法分两页，下一页看到第 11 条', async () => {
    const store = await renderApp()
    for (let i = 1; i <= 11; i++) await store.getState().createNote(`想法第 ${i} 条`)
    await waitFor(() => expect(document.body.textContent).toContain('想法第 1 条'))

    fireEvent.click(screen.getByRole('tab', { name: '回顾' }))
    await waitFor(() => expect(document.body.textContent).toContain('共 11 条想法'))
    await waitFor(() => expect(document.body.textContent).toContain('1 / 2'))
    // 同日按 createdAt 倒序：第一页 = 最新 10 条（第 11…2 条），第 1 条在第二页
    expect(document.body.textContent).toContain('想法第 11 条')
    expect(document.body.textContent).not.toContain('想法第 1 条')

    fireEvent.click(screen.getByRole('button', { name: '下一页 ›' }))
    await waitFor(() => expect(document.body.textContent).toContain('2 / 2'))
    expect(document.body.textContent).toContain('想法第 1 条')
    expect(document.body.textContent).not.toContain('想法第 11 条')
  })

  it('v8.30 想法收藏：点星标收藏旧想法 → 置顶（无标题）；再点取消恢复时间序', async () => {
    const store = await renderApp()
    await store.getState().createNote('最新的念头')
    await store.getState().shiftDay(-1) // → 9/28
    await store.getState().createNote('想收藏的念头')

    fireEvent.click(screen.getByRole('tab', { name: '回顾' }))
    await waitFor(() => expect(document.body.textContent).toContain('共 2 条想法'))
    // 收藏标题已去除：没有任何「⭐ 收藏」/「收藏」分组标题
    expect(document.body.textContent).not.toContain('⭐ 收藏')
    expect(screen.queryByText('收藏')).not.toBeInTheDocument()

    // 点旧想法（时间倒序在下方）的星标按钮（收藏）→ 置顶
    const stars = screen.getAllByRole('button', { name: '收藏' })
    fireEvent.click(stars[stars.length - 1])
    await waitFor(() => expect(screen.getByRole('button', { name: '取消收藏' })).toBeInTheDocument())
    // 无标题置顶：收藏的旧想法排在最新想法之前
    const pinnedIdx = document.body.textContent!.indexOf('想收藏的念头')
    const latestIdx = document.body.textContent!.indexOf('最新的念头')
    expect(pinnedIdx).toBeLessThan(latestIdx)

    // 取消收藏（按钮 label 变为 取消收藏）→ 恢复时间倒序
    fireEvent.click(screen.getByRole('button', { name: '取消收藏' }))
    await waitFor(() => expect(document.body.textContent).toContain('最新的念头'))
    expect(screen.getAllByRole('button', { name: '收藏' })).toHaveLength(2)
    const latestIdx2 = document.body.textContent!.indexOf('最新的念头')
    const pinnedIdx2 = document.body.textContent!.indexOf('想收藏的念头')
    expect(pinnedIdx2).toBeGreaterThan(latestIdx2)
  })

  it('v8.53 添加 DDL 待办：默认截止今天 → 徽标；切到明天仍在顶部；完成后消失', async () => {
    const store = await renderApp()
    // 创建表单默认「今天」= 注入时钟的 TODAY（2026-09-29）
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '交作业' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument())
    expect(within(screen.getByTestId('day-center')).getByText(/截止 9\/29/)).toBeInTheDocument()

    // 切到明天：未完成的 DDL 每天出现（注入置顶）
    store.getState().shiftDay(1)
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 30 日'))
    expect(within(screen.getByTestId('day-center')).getByText(/截止 9\/29/)).toBeInTheDocument()

    // 完成 → 从明天消失
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '标记完成：交作业' }))
    await waitFor(() => expect(within(screen.getByTestId('day-center')).queryByText(/截止 9\/29/)).not.toBeInTheDocument())
  })

  it('v8.61 逾期完成标注：完成后把截止日改成过去日期 → 徽标「逾期完成」；截止日当天完成不标', async () => {
    await renderApp()
    // 新建待办（默认截止今天 9/29）
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '交作业' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument())

    // 今天（9/29）勾选完成 → doneAt=9/29 = 截止日，不算逾期 → 无「逾期完成」徽标
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '标记完成：交作业' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '标记未完成：交作业' })).toBeInTheDocument())
    expect(within(screen.getByTestId('day-center')).queryByText(/逾期完成/)).not.toBeInTheDocument()

    // 编辑 → 自定义截止日改成昨天 9/28（完成日 9/29 > 截止日）→ 徽标「逾期完成 · 截止 9/28」
    fireEvent.click(screen.getByText('交作业'))
    fireEvent.change(screen.getByLabelText('自定义截止日'), { target: { value: '2026-09-28' } })
    fireEvent.keyDown(screen.getByLabelText('编辑待办'), { key: 'Enter' })
    await waitFor(() =>
      expect(within(screen.getByTestId('day-center')).getByText(/逾期完成 · 截止 9\/28/)).toBeInTheDocument(),
    )
  })

  it('v8.53 编辑待办可改截止日（自定义日期）', async () => {
    await renderApp()
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '交作业' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument())
    expect(screen.getByText(/截止 9\/29/)).toBeInTheDocument()

    // 点文字进编辑 → 自定义截止日（明天 = 注入时钟 +1）→ 徽标更新
    fireEvent.click(screen.getByLabelText('编辑待办：交作业'))
    const edit = await screen.findByLabelText('编辑待办')
    fireEvent.change(screen.getByLabelText('自定义截止日'), { target: { value: addDays(TODAY, 1) } })
    fireEvent.keyDown(edit, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText(/截止 9\/30/)).toBeInTheDocument())
  })

  it('v8.55 编辑态点「自定义日期」不关闭表单：焦点转移到截止行不触发 blur 保存，改完离开才保存', async () => {
    await renderApp()
    fireEvent.click(within(screen.getByTestId('day-center')).getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '交作业' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument())

    fireEvent.click(screen.getByLabelText('编辑待办：交作业'))
    const edit = await screen.findByLabelText('编辑待办')
    // 模拟点击「自定义日期」：焦点从文本输入转移到 date input → 表单不得被 blur 保存卸载
    const dateInput = screen.getByLabelText('自定义截止日')
    fireEvent.focus(dateInput)
    expect(screen.getByLabelText('编辑待办')).toBeInTheDocument()
    // 期间正常改日期 → 表单内显示新日期
    fireEvent.change(dateInput, { target: { value: addDays(TODAY, 1) } })
    await waitFor(() => expect(screen.getByText(/2026年9月30日/)).toBeInTheDocument())
    // 改完回车保存退出 → 行徽标更新为新日期
    fireEvent.keyDown(edit, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByLabelText('编辑待办')).not.toBeInTheDocument())
    expect(screen.getByText(/截止 9\/30/)).toBeInTheDocument()
  })

  it('v8.56 安装引导：iOS 手机显示苹果文案，展开步骤，点关闭后记住不再显示', async () => {
    mockUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    expect(screen.getByText('把 DayCell 装到桌面')).toBeInTheDocument()
    // 注意：<b>苹果</b> 是子元素，t2 的直接文本不含「苹果」——正则只匹配直接文本部分
    expect(screen.getByText(/Safari 打开 → 分享 ↥ → 添加到主屏幕/)).toBeInTheDocument()
    // 展开步骤
    fireEvent.click(screen.getByRole('button', { name: '查看步骤' }))
    expect(screen.getByText('苹果（Safari）')).toBeInTheDocument()
    expect(screen.getByText('「添加到主屏幕」→ 添加')).toBeInTheDocument()
    // 点 × 关闭 → 立即消失 + 本地记住（renderApp 内部会 clear，故只验证写入与即时消失）
    fireEvent.click(screen.getByRole('button', { name: '关闭安装提示' }))
    await waitFor(() => expect(screen.queryByText('把 DayCell 装到桌面')).not.toBeInTheDocument())
    expect(localStorage.getItem('daycell-install-banner-dismissed')).toBe('1')
  })

  it('v8.56 安装引导：安卓手机显示安卓文案与步骤', async () => {
    mockUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0 Mobile Safari/537.36')
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    expect(screen.getByText(/Chrome \/ Edge 打开 → 菜单 ⋮ → 安装应用/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看步骤' }))
    expect(screen.getByText('安卓（Chrome / Edge）')).toBeInTheDocument()
    expect(screen.getByText('「安装应用」')).toBeInTheDocument()
  })

  it('v8.56 安装引导：桌面浏览器 / 已安装（standalone）不显示', async () => {
    // 默认桌面 UA → 不显示
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    expect(screen.queryByText('把 DayCell 装到桌面')).not.toBeInTheDocument()
    // 已安装：iOS standalone → 不显示
    cleanup()
    Object.defineProperty(window.navigator, 'standalone', { get: () => true, configurable: true })
    mockUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    expect(screen.queryByText('把 DayCell 装到桌面')).not.toBeInTheDocument()
    // 还原，避免残留
    Object.defineProperty(window.navigator, 'standalone', { get: () => undefined, configurable: true })
  })

  it('v8.58 打开应用即写入首访时间戳（收费资格埋点）', async () => {
    await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    expect(localStorage.getItem('daycell-first-visit')).not.toBeNull()
  })

  it('v8.62 设置页：菜单 → 设置；开关「周视图显示习惯」默认关，打开后周视图列出当日习惯', async () => {
    const store = await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    // 建一条 daily 习惯（设定在今天 9/29）
    await store.getState().createHabit({ name: '跑步', freq: { kind: 'daily' } })
    await waitFor(() => expect(document.body.textContent).toContain('跑步'))

    // 默认关：切到周视图，日历区看不到习惯名（周格子里无「跑步」）
    fireEvent.click(screen.getByRole('tab', { name: '周' }))
    const cal = screen.getByLabelText('日历')
    await waitFor(() => expect(cal.textContent).toContain('9/29'))
    expect(within(cal).queryByText('跑步')).not.toBeInTheDocument()

    // 菜单 → 偏好设置 → 打开开关
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '偏好设置' }))
    expect(screen.getByText('周视图显示习惯')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: '周视图显示习惯' }))
    // 返回
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    await waitFor(() => expect(screen.queryByText('周视图显示习惯')).not.toBeInTheDocument())

    // 周视图日历区现在列出当日习惯（本周 9/28~10/04，daily 每天出现）
    await waitFor(() => expect(within(cal).getAllByText('跑步').length).toBeGreaterThan(0))
  })

  it('v8.63 子任务加入今日待办：加入 → 今日可见且不可编辑 → 勾选=打卡 → 删除撤销加入与打卡', async () => {
    const store = await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))

    // 建目标 + 子任务（store action，与 UI 同通道）
    await store.getState().createGoal('考研', '')
    await waitFor(() => expect(store.getState().goalList).toHaveLength(1))
    const gid = store.getState().goalList[0]!.goal.id
    await store.getState().createSubtask({ goalId: gid, title: '背单词' })
    await waitFor(() => expect(store.getState().goalList[0]!.subtaskCount).toBe(1))

    // 目标 tab → 打开详情 → 子任务行出现「＋ 加入今日待办」
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('考研')).toBeInTheDocument())
    fireEvent.click(screen.getByText('考研'))
    await waitFor(() => expect(screen.getByRole('button', { name: '加入今日待办：背单词' })).toBeInTheDocument())

    // 加入 → 按钮两态翻转（已加入）
    fireEvent.click(screen.getByRole('button', { name: '加入今日待办：背单词' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '移出今日待办：背单词' })).toBeInTheDocument())
    expect(store.getState().subtaskTodayIds).toHaveLength(1)

    // 今天 tab → 待办区出现「背单词」，且该行没有「编辑待办」入口（不可编辑文字）
    fireEvent.click(screen.getByRole('tab', { name: '今天' }))
    await waitFor(() => expect(screen.getByText('背单词')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '编辑待办：背单词' })).not.toBeInTheDocument()
    // v8.64 标注来源目标「· 考研」
    await waitFor(() => expect(screen.getByText('· 考研')).toBeInTheDocument())

    // 勾选完成 → 目标详情里联动为当天已打卡（切回目标 tab 回列表，需重新点开详情）
    fireEvent.click(screen.getByRole('button', { name: '标记完成：背单词' }))
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('考研')).toBeInTheDocument())
    fireEvent.click(screen.getByText('考研'))
    await waitFor(() => expect(screen.getByRole('button', { name: '取消今天的打卡：背单词' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '移出今日待办：背单词' })).toBeInTheDocument()

    // 删除今日待办 → 撤销加入 + 撤销当天打卡
    fireEvent.click(screen.getByRole('tab', { name: '今天' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '删除待办：背单词' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '删除待办：背单词' }))
    await waitFor(() => expect(screen.queryByText('背单词')).not.toBeInTheDocument())

    // 回目标详情：按钮恢复「加入今日待办」，打卡恢复未打卡（重新点开详情）
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('考研')).toBeInTheDocument())
    fireEvent.click(screen.getByText('考研'))
    await waitFor(() => expect(screen.getByRole('button', { name: '加入今日待办：背单词' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '打卡：背单词' })).toBeInTheDocument()
  })

  it('v9.2.2 待办排序：有具体时间的按时刻置顶，无时间沉底；行内显示时间标签', async () => {
    const store = await renderApp()
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
    // 无时间 / 14:00 / 09:30 三条，期望顺序：09:30 → 14:00 → 无时间（稳定沉底）
    await store.getState().createTodo('买牛奶')
    await store.getState().createTodo('交周报', TODAY, '14:00')
    await store.getState().createTodo('预约体检', TODAY, '09:30')

    await waitFor(() => expect(screen.getByText('09:30')).toBeInTheDocument())
    expect(screen.getByText('14:00')).toBeInTheDocument()
    // v9.2.2：截止日恰为今天的徽标标注「（今天）」；时间标签跟在日期后面
    expect(screen.getAllByText('截止 9/29（今天）')).toHaveLength(2)
    const rows = within(screen.getByTestId('day-center')).getAllByRole('button', { name: /编辑待办：/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      '编辑待办：预约体检',
      '编辑待办：交周报',
      '编辑待办：买牛奶',
    ])
  })
})
