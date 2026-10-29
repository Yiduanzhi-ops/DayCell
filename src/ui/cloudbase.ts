/**
 * v9 云端连接：CloudBase 初始化单例 + 后端 HTTP 地址。
 *
 * 架构（ADR：体验版不支持加安全域名，前端不直连数据库/认证）：
 *   - 云函数 HTTP 访问服务不受安全域名限制 → 前端一律 fetch 这个地址
 *   - 认证流程先在 dev 面板用 Web SDK 直连验证；若 CORS 被拦，
 *     再平移为云函数代理（daycell-api 加 /auth 路由，骨架已就位）
 */
import cloudbase from '@cloudbase/js-sdk'

export const API_BASE = import.meta.env.DEV
  ? '/daycell-api'
  : 'https://coding-daycell-d3g1vgq8g521cb2a6.service.tcloudbase.com/daycell-api'

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

/** 是否已有云会话（邮箱或匿名都算；同步判断，启动用）。
 *  CloudBase 登录态持久在 localStorage（key=`user_info_${envId}`），同步可用。 */
export function isCloudLoggedIn(): boolean {
  try {
    return localStorage.getItem(`user_info_${CLOUD_ENV}`) != null
  } catch {
    return false
  }
}

export type CloudLoginType = 'email' | 'anonymous' | 'none'

/** 当前登录类型（异步）：email=邮箱/账号登录；anonymous=匿名会话；none=纯本地未登录。
 *  getLoginState() 是异步的且返回 LoginState 实例，须 await；邮箱用户 user_info 有 email 字段，
 *  匿名用户无邮箱 → 用 email 字段区分。 */
export async function getCloudLoginType(): Promise<CloudLoginType> {
  try {
    const auth = getCloudApp().auth()
    const st = (await auth.getLoginState?.()) ?? null
    if (!st) return 'none'
    const info = (st as { user?: { getLocalUserInfo?: () => unknown } }).user?.getLocalUserInfo?.() as
      | { email?: string }
      | undefined
    if (info?.email) return 'email'
    return 'anonymous'
  } catch {
    return 'none'
  }
}

/** A2 匿名模式：启动时确保有会话。
 *  规则：
 *   1. 无登录态 → 自动匿名登录（失败静默回退纯本地）
 *   2. 有登录态但 accessToken 已失效（残留 user_info，如 refresh 过期）→ 先清理残留会话，再匿名登录
 *   3. 有效登录态（email/anonymous）→ 原样保留
 *  匿名会话同样有 accessToken，AI 导入/云同步/通知后端按匿名 uid 独立配额与存储。 */
export async function ensureSession(): Promise<CloudLoginType> {
  const cur = await getCloudLoginType()
  if (cur === 'none') {
    return anonymousLogin()
  }
  const token = await getAccessToken()
  if (token) return cur
  // 残留会话 token 已失效：清理后重建（匿名）
  try {
    await getCloudApp().auth().signOut?.()
  } catch {
    // 忽略清理异常
  }
  return anonymousLogin()
}

/** 自动匿名登录：SDK 失败返回 { data, error } 不抛异常，必须检查 error */
async function anonymousLogin(): Promise<CloudLoginType> {
  try {
    const auth = getCloudApp().auth()
    const r = (await auth.signInAnonymously?.()) as
      | { error?: { message?: string; category?: string } }
      | undefined
    if (r?.error) {
      console.warn('[DayCell] 匿名登录失败:', r.error.category ?? '', r.error.message ?? '')
      return 'none'
    }
    return getCloudLoginType()
  } catch (e) {
    console.warn('[DayCell] 匿名登录异常:', e instanceof Error ? e.message : String(e))
    return 'none'
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

/** v9.2 AI 智能导入：一段话 → 结构化结果（云函数 /ai/import，DeepSeek 后端直连）
 *  返回 { structured, quota, usage }；429 = 今日次数用完 */export async function aiImport(
  token: string,
  text: string,
  today: string,
): Promise<{
  ok: boolean
  structured?: {
    todos: Array<{ text: string; date: string; deadline?: string | null }>
    habits: Array<{ name: string; freq: { kind: 'daily' } | { kind: 'weekly'; weekdays: number[] } }>
    notes: Array<{ text: string }>
    goals: Array<{ title: string; note: string }>
  }
  remaining?: number
  error?: string
}> {
  try {
    const res = await fetch(`${API_BASE}/ai/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, today }),
    })
    const body = (await res.json()) as {
      ok?: boolean
      structured?: {
        todos?: Array<{ text: string; date: string; deadline?: string | null }>
        habits?: Array<{ name: string; freq: { kind: 'daily' } | { kind: 'weekly'; weekdays: number[] } }>
        notes?: Array<{ text: string }>
        goals?: Array<{ title: string; note: string }>
      }
      quota?: { remaining?: number }
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return {
      ok: true,
      structured: {
        todos: body.structured?.todos ?? [],
        habits: body.structured?.habits ?? [],
        notes: body.structured?.notes ?? [],
        goals: body.structured?.goals ?? [],
      },
      remaining: body.quota?.remaining,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ============ v9.3 Web Push 订阅 ============
/** 早/晚通知偏好（与云端 push_subscriptions 字段一一对应） */
export interface PushPrefs {
  morning: { enabled: boolean; time: string | null }
  evening: { enabled: boolean; time: string | null }
}

/** 订阅体：endpoint + 公钥 + 私钥（PushSubscription.toJSON 结构） */
export interface PushSubscriptionBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/** 推送地址（VAPID 公钥，前端公开常量；private key 只存在云函数环境变量） */
export const VAPID_PUBLIC_KEY =
  'BJf_hZkINBNPruCuUaMF-2HIB8mAefqjbFpIkAe_vfYc0l8TE4gixt-Rix06-DEPFnYdOxHTxYeAy8a14E9BP6I'

/**
 * 保存推送订阅与早/晚通知偏好（云函数 /push/subscribe，一体 upsert）。
 * 每次保存带完整 PushSubscription + 两组开关/时间；未授权时 subscription 传 null，
 * 用 enabled=false 表达全关（v1 不主动删除 endpoint，保留以便日后重开）。
 */
export async function savePushSubscription(
  token: string,
  subscription: PushSubscriptionBody | null,
  prefs: PushPrefs,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/push/subscribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint: subscription?.endpoint ?? '',
        keys: subscription?.keys ?? { p256dh: '', auth: '' },
        morning: {
          enabled: prefs.morning.enabled,
          time: prefs.morning.time,
        },
        evening: {
          enabled: prefs.evening.enabled,
          time: prefs.evening.time,
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai',
      }),
    })
    const body = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 退订：从云端删除该 endpoint 的订阅（云函数 /push/unsubscribe） */
export async function deletePushSubscription(
  token: string,
  endpoint: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/push/unsubscribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ endpoint }),
    })
    const body = (await res.json()) as { ok?: boolean; error?: string }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
