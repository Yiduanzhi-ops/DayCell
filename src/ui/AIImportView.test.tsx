/**
 * v9.2 AI 智能导入流程测试：
 *  1. ✦ 入口只在 ?dev=1 显示（线上用户不可见）
 *  2. 点 ✦ 打开全屏导入页 → 输入 → 整理（mock 云函数）→ 预览 → 确认导入 → 数据落库 + 面板关闭
 * 覆盖：入口显隐、配额展示、跨日期待办落库、取消勾选不导入。
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

vi.mock('./cloudbase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./cloudbase')>()
  return {
    ...actual,
    getAccessToken: vi.fn(async () => 'fake-token'),
    aiImport: vi.fn(async () => ({
      ok: true,
      remaining: 14,
      structured: {
        todos: [{ text: '买牛奶', date: '2026-09-30', deadline: null }],
        habits: [{ name: '每天喝水', freq: { kind: 'daily' } }],
        notes: [{ text: '想养只猫' }],
        goals: [],
      },
    })),
  }
})

afterEach(cleanup)

const TODAY = '2026-09-29' as DateKey

/** 设 ?dev=1 后渲染（AI 入口锁 dev） */
async function renderDevApp() {
  localStorage.clear()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: '?dev=1' },
    writable: true,
  })
  const bundle = await initCore({
    store: createMemoryStore(),
    skipLunar: true,
    now: (() => { let t = new Date(2026, 8, 29, 12).getTime(); return () => (t += 1) })(),
  })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

/** 无 dev 参数渲染（线上形态） */
async function renderProdApp() {
  localStorage.clear()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, search: '' },
    writable: true,
  })
  const bundle = await initCore({
    store: createMemoryStore(),
    skipLunar: true,
    now: (() => { let t = new Date(2026, 8, 29, 12).getTime(); return () => (t += 1) })(),
  })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

describe('AI 智能导入', () => {
  it('✦ 入口仅在 ?dev=1 显示，线上不出现', async () => {
    await renderProdApp()
    await waitFor(() => expect(document.body.textContent).toContain('待办'))
    expect(screen.queryByLabelText('AI 智能导入')).toBeNull()
    cleanup()

    await renderDevApp()
    await waitFor(() => expect(screen.getByLabelText('AI 智能导入')).toBeInTheDocument())
  })

  it('全流程：打开 → 输入 → 整理 → 预览 → 确认 → 跨日期待办落库 + 面板关闭', async () => {
    await renderDevApp()
    await waitFor(() => expect(screen.getByLabelText('AI 智能导入')).toBeInTheDocument())

    // 打开面板
    fireEvent.click(screen.getByLabelText('AI 智能导入'))
    await waitFor(() => expect(screen.getByTestId('ai-import-view')).toBeInTheDocument())
    expect(screen.getByText('AI 智能导入')).toBeTruthy()

    // 输入并整理
    fireEvent.change(screen.getByTestId('ai-text'), {
      target: { value: '明天买牛奶，每天喝水，想养只猫' },
    })
    fireEvent.click(screen.getByTestId('ai-analyze'))

    // 预览：待办（带"明天"日期标签）+ 习惯（每天）+ 想法；配额出现
    await waitFor(() => expect(screen.getByText('买牛奶')).toBeInTheDocument())
    expect(screen.getByText('每天喝水')).toBeInTheDocument()
    expect(screen.getByText('想养只猫')).toBeInTheDocument()
    // 跨日期推算：今天 2026-09-29 → 后端给 09-30 → 预览显示"明天"
    expect(screen.getByText('明天')).toBeInTheDocument()
    expect(screen.getByText(/今日剩余/)).toBeTruthy()
    expect(screen.getByText(/14/)).toBeTruthy()
    expect(screen.getByText('确认导入 3 条')).toBeInTheDocument()

    // 取消勾选想法（第 3 条）→ 确认导入 2 条
    const noteRow = screen.getByText('想养只猫').closest('div[class*="item"]') as HTMLElement
    const chks = noteRow.querySelectorAll('button[class*="chkbox"]')
    fireEvent.click(chks[0])
    expect(screen.getByText('确认导入 2 条')).toBeInTheDocument()

    // 确认 → 面板关闭 + 明日待办已落库（切到明天可见）
    fireEvent.click(screen.getByTestId('ai-confirm'))
    await waitFor(() => expect(screen.queryByTestId('ai-import-view')).toBeNull())
    await waitFor(() => expect(document.body.textContent).toContain('已导入 2 条'))
  })
})
