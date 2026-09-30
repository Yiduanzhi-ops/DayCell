/**
 * UI 冒烟测试（最基本的三条，守"上线的东西能跑"）：
 *  1. 应用挂载 → 默认日视图显示今天（v6 落地页）+ 空白日自动展开待办表单（D18）
 *  2. 表单里敲字回车 → 待办出现在列表里（v6.1 单一录入入口全链路）
 *  3. 切到月视图 → 42 格网格；切回日视图 → 日期不丢（D17）
 *
 * 更细的交互（滑动翻日、来源栈、快捷键）已在 src/app/store.test.ts 的状态机层覆盖，
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
    expect(screen.getByText('今天')).toBeInTheDocument() // 日头的「今天」徽标
    expect(screen.getByLabelText('新待办')).toBeInTheDocument() // D18 自动展开
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

  it('切月视图出 42 格；切回日视图选中日期不丢', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '月' }))
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(42))
    fireEvent.click(screen.getByRole('tab', { name: '日' }))
    await waitFor(() => expect(document.body.textContent).toContain('2026 年 9 月 29 日'))
  })
})
