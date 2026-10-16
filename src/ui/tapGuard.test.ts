/**
 * ui/tapGuard 测试（v8.51 iOS 点击兜底）：
 *  - 正常路径：arm 后原生 click 放行一发，同窗口第二发被阻止（防双触发）
 *  - 兜底路径：arm 后 120ms 内无原生 click → 手动 click 触发一次；
 *    之后慢到的原生 click 被阻止（仍单触发）
 *  - 非按钮：arm 不设窗口，click 照常放行
 *  - 窗口过期：300ms 后 click 不再受窗口约束
 *  - init 幂等：只注册一次 capture 监听
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { init, arm } from './tapGuard'

/** 构造一个按钮并挂 click handler，dispatch 一个可取消的冒泡 click */
function setupBtn(): { btn: HTMLButtonElement; handler: ReturnType<typeof vi.fn> } {
  const btn = document.createElement('button')
  btn.setAttribute('aria-label', '测试按钮')
  document.body.appendChild(btn)
  const handler = vi.fn()
  btn.addEventListener('click', handler)
  return { btn, handler }
}

/** dispatch 一个与 tapGuard 手动兜底无关的"原生 click"（普通事件，bubbles+cancelable） */
function nativeClick(btn: Element): void {
  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** elementFromPoint 需要 mock：jsdom 无布局、该 API 未定义——直接补齐 */
function mockHit(btn: HTMLElement | null): void {
  ;(document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint =
    () => btn
}

beforeEach(() => {
  document.body.innerHTML = ''
  vi.useFakeTimers()
  init()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (document as unknown as { elementFromPoint?: (x: number, y: number) => Element | null })
    .elementFromPoint
  document.body.innerHTML = ''
})

describe('tapGuard（v8.51 iOS 点击兜底）', () => {
  it('正常路径：arm 后原生 click 放行一发', () => {
    const { btn, handler } = setupBtn()
    mockHit(btn)
    arm(10, 10)
    nativeClick(btn)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('防双触发：同窗口（300ms 内）第二发 click 被阻止', () => {
    const { btn, handler } = setupBtn()
    mockHit(btn)
    arm(10, 10)
    nativeClick(btn)
    expect(handler).toHaveBeenCalledTimes(1)
    // 第二发（原生慢到 / 重复合成）→ 被 capture 阻止
    nativeClick(btn)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('兜底路径：arm 后 120ms 无原生 click → 手动触发一次', () => {
    const { btn, handler } = setupBtn()
    mockHit(btn)
    arm(10, 10)
    vi.advanceTimersByTime(120)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('兜底后慢到的原生 click 不再触发（仍单触发）', () => {
    const { btn, handler } = setupBtn()
    mockHit(btn)
    arm(10, 10)
    vi.advanceTimersByTime(120) // 手动 click 触发
    expect(handler).toHaveBeenCalledTimes(1)
    // 慢到的原生 click（同窗口 300ms 内）→ 阻止
    nativeClick(btn)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('兜底后：窗口内第二个真实 tap 的 click 不受影响（新窗口放行）', () => {
    const { btn, handler } = setupBtn()
    mockHit(btn)
    arm(10, 10)
    vi.advanceTimersByTime(120) // 第一次 tap 手动触发
    expect(handler).toHaveBeenCalledTimes(1)
    // 用户又 tap 一次 → arm 重置窗口 → 新原生 click 放行
    arm(20, 10)
    nativeClick(btn)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('非按钮：arm 不设窗口，click 照常放行', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    mockHit(div) // 命中非按钮
    const handler = vi.fn()
    div.addEventListener('click', handler)
    arm(10, 10)
    nativeClick(div)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('窗口过期：300ms 后 click 不再受窗口约束', () => {
    const { btn, handler } = setupBtn()
    mockHit(btn)
    arm(10, 10)
    vi.advanceTimersByTime(120) // 手动 click（触发一次，窗口 count=1）
    expect(handler).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(400) // 窗口过期（>300ms）
    nativeClick(btn) // 独立 click（非同一触摸）→ 放行
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('init 幂等：重复 init 只注册一次 capture 监听', () => {
    // 重置内部标记（beforeEach 已 init 过一次），让本次测试从"未注册"状态开始
    delete (document as unknown as Record<string, unknown>).__tapGuard
    const spy = vi.spyOn(document, 'addEventListener')
    init()
    init()
    const clickRegs = spy.mock.calls.filter((c) => c[0] === 'click' && c[2] === true)
    expect(clickRegs.length).toBe(1)
    spy.mockRestore()
  })
})
