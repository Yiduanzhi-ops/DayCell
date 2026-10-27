/**
 * v9 开发开关：URL 参数 ?dev=1 启用开发面板。
 *
 * 铁律：v9 后端功能一律走此开关锁死，默认用户不可见；
 * 本地自测 / 灰度验证时加 ?dev=1 即可。上线决定后移除或改为正式入口。
 */
export function isDevMode(): boolean {
  if (typeof window === 'undefined') return false
  const p = new URLSearchParams(window.location.search)
  const v = p.get('dev')
  return v === '1' || v === 'true' || v === 'on'
}
