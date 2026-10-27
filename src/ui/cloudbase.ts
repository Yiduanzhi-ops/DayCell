/**
 * v9 云端连接：CloudBase 初始化单例 + 后端 HTTP 地址。
 *
 * 架构（ADR：体验版不支持加安全域名，前端不直连数据库/认证）：
 *   - 云函数 HTTP 访问服务不受安全域名限制 → 前端一律 fetch 这个地址
 *   - 认证流程先在 dev 面板用 Web SDK 直连验证；若 CORS 被拦，
 *     再平移为云函数代理（daycell-api 加 /auth 路由，骨架已就位）
 */
import cloudbase from '@cloudbase/js-sdk'

export const API_BASE =
  'https://coding-daycell-d3g1vgq8g521cb2a6.service.tcloudbase.com/daycell-api'

/** CloudBase 环境 ID（来自 cloudbaserc.json / 控制台） */
export const CLOUD_ENV = 'coding-daycell-d3g1vgq8g521cb2a6'

let app: ReturnType<typeof cloudbase.init> | null = null

/** 获取 CloudBase 应用单例（Web SDK，仅 dev 面板使用） */
export function getCloudApp(): ReturnType<typeof cloudbase.init> {
  if (!app) {
    app = cloudbase.init({ env: CLOUD_ENV })
  }
  return app
}

/** 健康检查：确认前端 → 云函数全链路可用 */
export async function checkBackend(): Promise<{ ok: boolean; info?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' })
    const body = (await res.json()) as { ok?: boolean; service?: string; version?: string }
    if (!res.ok || !body.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    return { ok: true, info: `${body.service}@${body.version ?? '?'}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
