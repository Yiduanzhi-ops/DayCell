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

  it('月格三行：只有花费（无待办）也显示金额；想法以点提示在右下角（v7.1）', async () => {
    const store = await renderApp()
    // 只记一笔花费 + 一条想法——复现旧版被 todoTotal gate 住的场景
    fireEvent.click(screen.getByRole('button', { name: '记一笔花费' }))
    fireEvent.change(screen.getByLabelText('金额（元）'), { target: { value: '129' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(store.getState().detail?.summary.costCents).toBe(12900))
    fireEvent.click(screen.getByRole('button', { name: '添加想法' }))
    fireEvent.change(screen.getByLabelText('新想法'), { target: { value: '一个念头' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存' }).at(-1)!)
    await waitFor(() => expect(store.getState().detail?.notes).toHaveLength(1))

    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42))
    const cell = screen.getByLabelText(/2026年9月29日/)
    // 行2：花费独立显示（修复前：无待办的日子花费不可见）
    expect(cell.textContent).toContain('¥129')
    // 行3 右下角：想法点（i 元素，aria-hidden，条数 1 不带数字）
    const nind = cell.querySelector('[class*="nind"]')
    expect(nind).not.toBeNull()
    expect(nind!.querySelector('i')).not.toBeNull()
    expect(nind!.textContent).toBe('')
    // 无待办 → 不渲染进度 chip
    expect(cell.querySelector('[class*="prog"]')).toBeNull()
  })
})
