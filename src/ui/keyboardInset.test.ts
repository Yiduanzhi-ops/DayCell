/**
 * v8.61 全弹窗键盘适配：visualViewport → --kb-inset。
 * jsdom 无 visualViewport（走 no-op 分支）；mock 分支验证键盘弹出/收起时变量正确写入。
 */
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest'
import { watchKeyboardInset } from './keyboardInset'

describe('watchKeyboardInset（v8.61 弹窗键盘适配）', () => {
  const origVV = window.visualViewport as VisualViewport | undefined
  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', { value: origVV, configurable: true })
    document.documentElement.style.removeProperty('--kb-inset')
  })

  it('无 visualViewport（旧浏览器 / jsdom）→ no-op 不抛错', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    expect(() => watchKeyboardInset()).not.toThrow()
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('')
  })

  it('键盘弹出 → --kb-inset = 布局视口高 - 可视区底；收起 → 0', () => {
    const listeners: Record<string, () => void> = {}
    const vv = {
      height: 800,
      offsetTop: 0,
      addEventListener: (t: string, cb: () => void): void => { listeners[t] = cb },
      removeEventListener: (): void => {},
    }
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true })

    const off = watchKeyboardInset()
    // 初始：无键盘 → 0
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('0px')

    // 键盘弹出：可视区高 450 → inset 350
    vv.height = 450
    listeners.resize!()
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('350px')

    // 键盘收起 → 0
    vv.height = 800
    listeners.resize!()
    expect(document.documentElement.style.getPropertyValue('--kb-inset')).toBe('0px')

    off()
  })
})
