/**
 * ui/ShareView 测试（v8.3 分享与手册页）：
 *  - 从菜单进入、返回关闭
 *  - 品牌 + 网址 + 复制链接按钮（写入剪贴板）
 *  - 分平台「添加到主屏幕」指引齐全
 *  - 三步上手 + 多设备同步提示
 */

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

afterEach(cleanup)

const TODAY = '2026-10-08' as DateKey

async function renderApp() {
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

async function openShare() {
  await renderApp()
  fireEvent.click(screen.getByRole('button', { name: '菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '分享与手册' }))
}

describe('ShareView（分享与手册）', () => {
  it('从菜单进入分享页，返回后关闭', async () => {
    await openShare()
    // 顶栏品牌与页内应用名都叫 DayCell，故用 getAllByText 断言存在
    expect(screen.getAllByText('DayCell').length).toBeGreaterThan(0)
    expect(screen.getByText('添加到主屏幕（推荐）')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '← 返回' }))
    expect(screen.queryByText('三步上手')).not.toBeInTheDocument()
  })

  it('展示网址与复制链接按钮，点击后写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    try {
      await openShare()
      expect(screen.getByText('https://yiduanzhi-ops.github.io/DayCell/')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '复制链接' }))
      expect(writeText).toHaveBeenCalledWith('https://yiduanzhi-ops.github.io/DayCell/')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('分平台添加到主屏幕指引齐全（iPhone/安卓/电脑）', async () => {
    await openShare()
    expect(screen.getByText('iPhone / iPad')).toBeInTheDocument()
    expect(screen.getByText('安卓')).toBeInTheDocument()
    expect(screen.getByText('电脑')).toBeInTheDocument()
  })

  it('包含三步上手与多设备同步提示', async () => {
    await openShare()
    expect(screen.getByText('三步上手')).toBeInTheDocument()
    expect(screen.getByText('多设备同步')).toBeInTheDocument()
  })
})
