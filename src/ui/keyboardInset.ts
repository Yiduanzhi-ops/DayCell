/**
 * v8.61 全弹窗键盘适配。
 *
 * 根因：iOS 键盘是覆盖式（弹出不改变布局视口），`position: fixed` 贴底的弹窗
 * 会被键盘直接盖住（安卓各 WebView 行为不一）。修复：监听 `visualViewport`，
 * 把「键盘占用的高度」写成 CSS 变量 `--kb-inset`；所有弹窗 overlay 统一
 * `padding-bottom: var(--kb-inset, 0px)`，键盘弹出时弹窗整体顶到键盘上方。
 * 安卓 Chrome 键盘弹出会收缩布局视口（此时 inset 自然 ≈ 0），双端统一生效。
 *
 * 不支持 visualViewport 的旧浏览器返回 no-op（保持现状，不破坏）。
 */
export function watchKeyboardInset(): () => void {
  if (typeof window === 'undefined') return () => {}
  const vv = window.visualViewport
  if (!vv) return () => {}
  const update = (): void => {
    const inset = Math.max(0, window.innerHeight - (vv.offsetTop + vv.height))
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`)
  }
  vv.addEventListener('resize', update)
  vv.addEventListener('scroll', update)
  update()
  return () => {
    vv.removeEventListener('resize', update)
    vv.removeEventListener('scroll', update)
  }
}
