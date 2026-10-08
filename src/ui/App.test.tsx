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
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

// vitest 没开 globals，RTL 的自动 cleanup 不会注册——必须手动，否则渲染跨用例累积
afterEach(cleanup)

const TODAY = '2026-09-29' as DateKey

async function renderApp() {
  // v7.5：夜间模式读 localStorage，测试间必须清掉，否则上个用例切了 dark 会串场
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

describe('App 冒烟', () => {
  it('默认落地今天的日视图；空白日不自动展开，手动点「+ 添加」才弹出（v7.2）', async () => {
    await renderApp()
    expect(document.body.textContent).toContain('2026 年 9 月 29 日')
    expect(document.querySelector('[class*="todayMark"]')?.textContent).toBe('今天') // 日头「今天」徽标（v7.3 起 TabBar 里也有「今天」文字，需按类定位）
    expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument() // 不再自动展开（v7.2）
    expect(screen.getByRole('tab', { name: '今天' })).toBeInTheDocument() // v7：切换器首标签

    fireEvent.click(screen.getByRole('button', { name: '添加待办' }))
    expect(screen.getByLabelText('新待办')).toBeInTheDocument()
  })

  it('点「添加待办」→ 敲字回车 → 待办出现在列表（单一录入入口全链路）', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }))
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '买牛奶' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('买牛奶')).toBeInTheDocument()
    // v7.4：创建完表单收起（不再保留并清空连续录入，用户拍板改手动）
    await waitFor(() => expect(screen.queryByLabelText('新待办')).not.toBeInTheDocument())
  })

  it('点已存待办的文字 → 就地编辑，回车保存（v7 / US-13）', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }))
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
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42))

    // 月视图里点一个非今天的格子（宽屏：右栏换日，selected 跟着走）
    fireEvent.click(screen.getByLabelText(/10月1日/))
    await waitFor(() => expect(store.getState().selected).toBe('2026-10-01'))

    // 点「今天」标签：v7 起恒复位到今天（日视图 = 今天）
    fireEvent.click(screen.getByRole('tab', { name: '今天' }))
    await waitFor(() => expect(store.getState().selected).toBe(TODAY))
    expect(store.getState().view).toBe('day')
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
  })

  it('月格三行：只有支出（无待办）也显示金额；想法以点提示在右下角（v7.1）', async () => {
    const store = await renderApp()
    // v8.0 起今天视图不再录入支出（记账走 iCost），改走 store action 造数，验证月格展示
    await store.getState().createExpense(12900, 'other', '午饭')
    await waitFor(() => expect(store.getState().detail?.summary.costCents).toBe(12900))
    fireEvent.click(screen.getByRole('button', { name: '添加想法' }))
    fireEvent.change(screen.getByLabelText('新想法'), { target: { value: '一个念头' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' }).at(-1)!)
    await waitFor(() => expect(store.getState().detail?.notes).toHaveLength(1))

    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42))
    const cell = screen.getByLabelText(/2026年9月29日/)
    // 行2：支出独立显示（修复前：无待办的日子支出不可见）
    expect(cell.textContent).toContain('¥129')
    // 行3 右下角：想法点（i 元素，aria-hidden，条数 1 不带数字）
    const nind = cell.querySelector('[class*="nind"]')
    expect(nind).not.toBeNull()
    expect(nind!.querySelector('i')).not.toBeNull()
    expect(nind!.textContent).toBe('')
    // 无待办 → 不渲染进度 chip
    expect(cell.querySelector('[class*="prog"]')).toBeNull()
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
    expect(screen.getByRole('button', { name: '添加待办' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '添加想法' })).toBeInTheDocument()
  })

  it('v7.6 已完成的待办自动沉底，未完成保持原序', async () => {
    await renderApp()
    // 先加「甲」，再加「乙」，再勾掉「甲」→ 顺序应变 乙、甲
    fireEvent.click(screen.getByRole('button', { name: '添加待办' }))
    let input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '甲' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('甲')

    fireEvent.click(screen.getByRole('button', { name: '添加待办' }))
    input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '乙' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await screen.findByText('乙')

    fireEvent.click(screen.getByRole('button', { name: '标记完成：甲' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '标记未完成：甲' })).toBeInTheDocument())

    const rows = screen.getAllByLabelText(/^编辑待办：/)
    expect(rows.map((el) => el.getAttribute('aria-label'))).toEqual(['编辑待办：乙', '编辑待办：甲'])
  })

  it('v7.5/v8.0/v8.1/v8.3 右上角菜单：项齐全、顺序正确（含习惯/同步设置/分享与手册）、夜间模式开关生效', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent)
    expect(items).toEqual(['导出备份', '导入备份', '一键导出 MD', '纪念日设置', '习惯设置', '同步设置', '分享与手册', '关于'])
    expect(screen.getByRole('switch')).toBeInTheDocument() // 夜间模式行（最下面，分隔线之后）
    expect(screen.getByText('夜间模式')).toBeInTheDocument()

    // 默认浅色；点开关 → 深色（html data-theme + localStorage 持久化）
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByRole('switch'))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('daycell-theme')).toBe('dark')
  })

  it('v7.5 纪念日设置：从菜单进入、新增每周纪念日、列表显示', async () => {
    const store = await renderApp()
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '纪念日设置' }))

    // 设置页出现（覆盖层），从空列表开始
    expect(screen.getByRole('dialog', { name: '纪念日设置' })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: '添加想法' }))
    fireEvent.change(screen.getByLabelText('新想法'), { target: { value: '一个念头' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' }).at(-1)!)
    await screen.findByText('一个念头')
    await waitFor(() => expect(screen.queryByLabelText('新想法')).not.toBeInTheDocument())
  })
})
