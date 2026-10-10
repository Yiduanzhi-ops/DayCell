/**
 * 首次使用引导测试（v8.22）：
 *  1. 首屏内容：标题 / 副标题（产品定位句）/ 6 个亮点 / 「添加到主屏幕」提示条 / 跳过
 *  2. 「下一步」切屏、进度点跳屏、最后一屏变「开始使用」
 *  3. 「跳过」与「开始使用」都关闭引导并写入本地标记（之后不再自动弹出）
 * 注：首启自动弹出检测在 main.tsx，组件测试里手动 openOnboarding 触发。
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore, readOnboardingSeen } from '@/app/store'
import { App } from './App'

afterEach(cleanup)

const TODAY = '2026-09-29' as DateKey

async function renderApp() {
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

describe('首次使用引导（v8.22）', () => {
  it('首屏：标题 / 定位副标题 / 6 亮点 / 添加到主屏幕提示 / 跳过', async () => {
    const store = await renderApp()
    store.getState().openOnboarding()
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument())

    expect(screen.getByRole('heading', { name: '欢迎使用 DayCell' })).toBeInTheDocument()
    expect(screen.getByText('以「一天」为格子的个人管理工具：待办、想法、习惯、目标，每日一页')).toBeInTheDocument()
    for (const label of ['待办·习惯·想法', '目标·阶段·进度', '周 / 月双视图', '纪念日提醒', '多端同步', '本地备份']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('添加到主屏幕，获取 APP 使用体验')).toBeInTheDocument()
    expect(screen.getByText('跳过')).toBeInTheDocument()
  })

  it('下一步切屏：今日视图 → …；进度点可跳屏', async () => {
    const store = await renderApp()
    store.getState().openOnboarding()
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument())

    fireEvent.click(screen.getByText('下一步'))
    expect(screen.getByRole('heading', { name: '今日视图' })).toBeInTheDocument()
    expect(screen.getByText('待办完成自动沉底')).toBeInTheDocument()

    // 进度点直接跳最后一屏（数据安全），主按钮变「开始使用」
    fireEvent.click(screen.getByLabelText('第 6 屏'))
    expect(screen.getByRole('heading', { name: '数据在你手里' })).toBeInTheDocument()
    expect(screen.getByText('开始使用')).toBeInTheDocument()
  })

  it('跳过：关闭引导并写入本地标记（之后不再自动弹出）', async () => {
    const store = await renderApp()
    store.getState().openOnboarding()
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument())

    fireEvent.click(screen.getByText('跳过'))
    await waitFor(() => expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument())
    expect(readOnboardingSeen()).toBe(true)
  })

  it('最后一屏点「开始使用」：关闭并写入标记', async () => {
    const store = await renderApp()
    store.getState().openOnboarding()
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument())

    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByText('下一步'))
    expect(screen.getByRole('heading', { name: '数据在你手里' })).toBeInTheDocument()

    fireEvent.click(screen.getByText('开始使用'))
    await waitFor(() => expect(screen.queryByTestId('onboarding')).not.toBeInTheDocument())
    expect(readOnboardingSeen()).toBe(true)
  })

  it('首屏副标题完整一行语义：标题下为定位句（回归：用户最后锁定的文案）', async () => {
    const store = await renderApp()
    store.getState().openOnboarding()
    await waitFor(() => expect(screen.getByTestId('onboarding')).toBeInTheDocument())
    // 副标题不出现被废弃的旧文案
    expect(screen.queryByText(/一格一格记下/)).not.toBeInTheDocument()
  })
})
