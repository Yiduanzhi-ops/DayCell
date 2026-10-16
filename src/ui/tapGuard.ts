/**
 * v8.51 iOS 点击兜底（tapGuard）。
 *
 * 背景：日/周/月视图滑动轨道容器内的按钮，在 iOS 上偶发"第一次点击有高亮但功能不触发、
 * 再点一次才生效"——原生 click 合成在触摸序列后不可靠（v8.48 动画 / v8.49 preventDefault /
 * v8.50 transform 改写均已排除，说明是 WebKit 合成层行为，不可从手势层根除）。
 *
 * 方案：**不依赖 iOS 合成 click**。
 *  - 手势层 touchend 判定为 tap（位移 <6px）时调用 `arm(x, y)`：记下命中按钮；
 *  - 120ms 内若原生 click 派发（正常情况），全局 capture 监听放行这一发、不再手动；
 *  - 120ms 内若原生 click 没来（被 iOS 吞掉），手动 `dispatchEvent(click)` 兜底触发；
 *  - 同一触摸窗口（300ms）内第二发 click（原生慢到/重复合成）被 capture 监听阻止，
 *    保证一次触摸**恰好触发一次**（无双触发、无丢失）。
 *
 * 全局 capture 监听由 App 挂载时 `init()` 注册一次（惰性 + document 守卫，兼容 jsdom）。
 * 轨道外的元素（TabBar、菜单等）不受影响——没有 arm 就没有窗口。
 */

type TapWindow = {
  /** 命中（或最近可点击祖先）的按钮元素 */
  el: HTMLElement
  /** 触摸结束时间戳 */
  ts: number
  /** 本窗口已放行的 click 数（≥1 后后续 click 阻止） */
  count: number
  /** 120ms 兜底定时器句柄 */
  timer: number
}

let win: TapWindow | null = null

/** 手动兜底 click 的标记（capture 监听据此放行，不再受窗口计数限制） */
const MANUAL = '__tapGuardManual'

/** App 挂载时注册全局 capture click 监听。幂等。 */
export function init(): void {
  if (typeof document === 'undefined') return
  if ((document as unknown as Record<string, unknown>).__tapGuard) return
  ;(document as unknown as Record<string, unknown>).__tapGuard = true
  document.addEventListener('click', onCapture, true)
}

function inWindow(target: EventTarget | null): boolean {
  if (!win || !target) return false
  const t = target as HTMLElement | null
  if (!t || typeof t.closest !== 'function') return false
  // 目标可能是按钮内部的文本/图标节点：win.el 是按钮（arm 时 closest 得到），
  // 用 el.contains(t) 覆盖；按钮可能是目标本身（el === t）。
  return win.el === t || win.el.contains(t)
}

function onCapture(e: MouseEvent): void {
  // 我们自己的手动兜底 click：无条件放行（它只发生一次，且已把窗口 count 置 1）
  if ((e as unknown as Record<string, unknown>)[MANUAL]) return
  if (!win) return
  // 窗口超时自然失效
  if (Date.now() - win.ts > 300) {
    win = null
    return
  }
  if (!inWindow(e.target)) return
  if (win.count >= 1) {
    // 同一触摸窗口的第二发 click（原生慢到 / 重复合成）→ 阻止，防双触发
    e.preventDefault()
    e.stopPropagation()
    return
  }
  win.count++
}

/**
 * 手势层 tap 判定后调用：记录命中按钮，120ms 内原生 click 未到则手动触发一次。
 * @param x touchstart 的 clientX（viewport 像素）
 * @param y touchstart 的 clientY（viewport 像素）
 */
export function arm(x: number, y: number): void {
  if (typeof document === 'undefined') return
  // 上一窗口残留清理（正常情况已被原生 click 消费或超时）
  if (win) {
    clearTimeout(win.timer)
    win = null
  }
  const hit =
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
  const btn = hit?.closest?.('button, [role="button"], a[href]') as HTMLElement | null
  if (!btn) return // 没点在按钮上：不设窗口，原生 click 照常
  win = { el: btn, ts: Date.now(), count: 0, timer: 0 }
  win.timer = window.setTimeout(() => {
    if (!win || win.el !== btn) return
    if (win.count >= 1) {
      // 原生 click 已放行（正常路径）→ 无需兜底，窗口关闭
      win = null
      return
    }
    // 原生 click 被 iOS 吞掉 → 手动触发一次；先占位 count=1，
    // 后续慢到的原生 click 会被 capture 阻止（防双触发）
    win.count = 1
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    ;(ev as unknown as Record<string, unknown>)[MANUAL] = true
    win.el.dispatchEvent(ev)
    // 窗口保留到 300ms 自然过期（onCapture 清理）
  }, 120)
}
