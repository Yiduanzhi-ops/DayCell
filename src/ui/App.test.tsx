/**
 * UI 冒烟测试（守"上线的东西能跑"）：
 *  1. 应用挂载 → 默认「今天」视图显示今天（v6 落地页 / v7 并入今天语义）+ 空白日自动展开待办表单（D18）
 *  2. 表单里敲字回车 → 待办出现在列表里（v6.1 单一录入入口全链路）
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
  it('默认落地今天的日视图，空白日自动展开待办表单', async () => {
    await renderApp()
    expect(document.body.textContent).toContain('2026 年 9 月 29 日')
    expect(screen.getByText('今天', { selector: 'span' })).toBeInTheDocument() // 日头的「今天」徽标（v7 后 tab 同名，用 selector 限定）
    expect(screen.getByLabelText('新待办')).toBeInTheDocument() // D18 自动展开
    expect(screen.getByRole('tab', { name: '今天' })).toBeInTheDocument() // v7：切换器首标签
  })

  it('敲字回车 → 待办出现在列表（单一录入入口全链路）', async () => {
    await renderApp()
    const input = screen.getByLabelText('新待办')
    fireEvent.change(input, { target: { value: '买牛奶' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText('买牛奶')).toBeInTheDocument()
    // US-06：保存后表单保留并清空，可连续录入
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
    expect(screen.getByLabelText('新待办')).toBeInTheDocument()
  })

  it('点已存待办的文字 → 就地编辑，回车保存（v7 / US-13）', async () => {
    await renderApp()
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
})
