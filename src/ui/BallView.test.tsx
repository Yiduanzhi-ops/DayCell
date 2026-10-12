/**
 * ui/BallView 测试（桌面壳悬浮球）：
 *  - 渲染 logo 图
 *  - 点击调用 onExpand 回调（invoke 由 Tauri 环境提供，这里只测回调接线）
 */

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { BallView } from './BallView'

// BallView 只在 Tauri 环境出现，非 Tauri 环境 import 时 VITE_TAURI 未定义，
// 组件本身不读它；invoke 调用在点击路径里，测试用 onExpand 接管即可。
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

afterEach(cleanup)

describe('BallView', () => {
  it('渲染 logo 图', () => {
    render(<BallView />)
    const img = screen.getByRole('button', { name: '展开 DayCell' }).querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('alt')).toBe('DayCell')
  })

  it('按下（pointerdown）触发 onExpand 回调', () => {
    const onExpand = vi.fn()
    render(<BallView onExpand={onExpand} />)
    fireEvent.pointerDown(screen.getByRole('button', { name: '展开 DayCell' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })
})
