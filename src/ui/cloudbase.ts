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

/** 取当前登录用户的 accessToken（网关鉴权用：Authorization: Bearer） */
export async function getAccessToken(): Promise<string | null> {
  try {
    const r = (await getCloudApp().auth().getAccessToken?.()) as {
      accessToken?: string
      error?: { message?: string }
    }
    return r?.accessToken ?? null
  } catch {
    return null
  }
}

/** 是否已登录（auth 登录态持久在 localStorage，刷新后可恢复；同步判断，启动用） */
export function isCloudLoggedIn(): boolean {
  try {
    return getCloudApp().auth().getLoginState?.() != null
  } catch {
    return false
  }
}

/** 健康检查：确认前端 → 云函数全链路可用（网关鉴权后需带 token） */
export async function checkBackend(): Promise<{ ok: boolean; info?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/health`, { method: 'GET' })
    const body = (await res.json()) as { ok?: boolean; service?: string; version?: string }
    // 401 = 网关已拦截未登录请求 → 后端可达、只是需要登录
    if (res.status === 401) {
      return { ok: true, info: '后端可达（需登录验证）' }
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    return { ok: true, info: `${body.service}@${body.version ?? '?'}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 带登录 token 调 /me：实测网关注入的用户身份字段（开发面板用） */
export async function fetchMe(token: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as { ok?: boolean }
    if (!res.ok || !body.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    return { ok: true, data: body }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** v9 云同步：上传整包快照到云端（云函数 /sync/upload，网关鉴权后强制写入 user_id=x-userid） */
export async function uploadSnapshot(
  token: string,
  snapshot: unknown,
  version: string,
): Promise<{ ok: boolean; id?: number | null; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/sync/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snapshot, version }),
    })
    const body = (await res.json()) as { ok?: boolean; id?: number | null; error?: string }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true, id: body.id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** v9 云同步：从云端拉取整包快照（云函数 /sync/download，只返回当前登录用户自己的快照） */
export async function downloadSnapshot(
  token: string,
): Promise<{ ok: boolean; snapshot?: unknown; version?: string; savedAt?: string; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/sync/download`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as {
      ok?: boolean
      snapshot?: unknown
      version?: string
      savedAt?: string
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true, snapshot: body.snapshot, version: body.version, savedAt: body.savedAt }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
