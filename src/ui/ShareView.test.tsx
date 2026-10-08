/**
 * ui/ShareView 测试（v8.3 分享与手册页；v8.6 更名「使用手册」）：
 *  - 从菜单进入、返回关闭
 *  - 品牌 + 网址 + 复制链接按钮（写入剪贴板）
 *  - 分平台「添加到主屏幕」指引齐全
 *  - 三步上手 + 多设备同步提示
 *  - v8.6：GitHub 仓库 / 问题反馈入口 + 一键生成分享图按钮
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
  fireEvent.click(screen.getByRole('menuitem', { name: '使用手册' }))
}

describe('ShareView（使用手册）', () => {
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

  it('v8.6：GitHub 仓库链接、问题反馈入口、生成分享图按钮、数据安全提示', async () => {
    await openShare()
    expect(screen.getByRole('button', { name: /GitHub 仓库/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /问题反馈/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一键生成分享图' })).toBeInTheDocument()
    expect(screen.getByText(/数据安全：你的数据只存在自己的浏览器里/)).toBeInTheDocument()
  })

  it('v8.6：生成分享图在无 canvas 环境优雅降级（不崩溃）', async () => {
    const getContext = vi.fn(() => null)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContext as never)
    try {
      await openShare()
      fireEvent.click(screen.getByRole('button', { name: '一键生成分享图' }))
      // 降级 toast 出现、页面不崩
      expect(await screen.findByText('当前环境不支持生成分享图')).toBeInTheDocument()
    } finally {
      vi.restoreAllMocks()
    }
  })
})
