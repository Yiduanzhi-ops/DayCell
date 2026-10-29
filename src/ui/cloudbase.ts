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
  // v9.7：会话真实键是 credentials_<envId>（含 access_token）；user_info 只是用户资料缓存，
  // 登出/会话失效时可能残留——以 credentials 为准，与 ensureSession 恢复逻辑一致。
  try {
    const raw = localStorage.getItem(`credentials_${CLOUD_ENV}`)
    if (!raw) return false
    try {
      const o = JSON.parse(raw) as { access_token?: unknown }
      return typeof o.access_token === 'string' && o.access_token.length > 0
    } catch {
      return false
    }
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

/** 会话恢复（v9.7 默认登录改造）：启动时恢复已有登录态。
 *  规则：
 *   1. 无登录态 → 返回 'none'（本地模式；不再自动匿名登录，由 App 弹登录引导）
 *   2. 有登录态但 accessToken 已失效（残留 user_info，如 refresh 过期）→ 清理残留会话，返回 'none'
 *   3. 有效登录态（email / 历史匿名）→ 原样保留，返回对应类型
 *  'none' = 本地体验模式：数据只存本机，云同步/AI/通知点击时引导登录。 */
export async function ensureSession(): Promise<CloudLoginType> {
  const cur = await getCloudLoginType()
  if (cur === 'none') return 'none'
  const token = await getAccessToken()
  if (token) return cur
  // 残留会话 token 已失效：清理残留，回到本地模式
  try {
    await getCloudApp().auth().signOut?.()
  } catch {
    // 忽略清理异常
  }
  return 'none'
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

/** 设备标识：云同步设备登记用（免费档限 1 台设备）。
 *  持久化在 localStorage，多标签页/重装后共享；清缓存/无痕会换新（等价新设备）。 */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem('daycell_device_id')
    if (!id) {
      id =
        (globalThis.crypto?.randomUUID?.() ??
          `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
      localStorage.setItem('daycell_device_id', id)
    }
    return id
  } catch {
    return `dev-${Date.now()}`
  }
}

/** v9 云同步：上传整包快照到云端（云函数 /sync/upload，网关鉴权后强制写入 user_id=x-userid） */
export async function uploadSnapshot(
  token: string,
  snapshot: unknown,
  version: string,
): Promise<{ ok: boolean; id?: number | null; error?: string; deviceLimit?: number }> {
  try {
    const res = await fetch(`${API_BASE}/sync/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snapshot, version, deviceId: getDeviceId() }),
    })
    const body = (await res.json()) as {
      ok?: boolean
      id?: number | null
      error?: string
      limit?: number
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}`, deviceLimit: body.limit }
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

/** v9.6 云同步状态：最近备份时间 + 备份记录数 + 已登记设备（账号页「数据不会丢」可见性）。
 *  免费档 deviceLimit=1；第二台设备上传会被后端 403 device_limit。 */
export interface CloudSyncStatus {
  lastSyncAt: string | null
  recordCount: number
  devices: Array<{ deviceId: string; lastSeenAt: string | null }>
  deviceLimit: number
}

export async function fetchSyncStatus(
  token: string,
): Promise<{ ok: boolean; status?: CloudSyncStatus; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/sync/status`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as {
      ok?: boolean
      lastSyncAt?: string | null
      recordCount?: number
      devices?: Array<{ device_id?: string; last_seen_at?: string | null }>
      deviceLimit?: number
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return {
      ok: true,
      status: {
        lastSyncAt: body.lastSyncAt ?? null,
        recordCount: body.recordCount ?? 0,
        devices: (body.devices ?? []).map((d) => ({
          deviceId: d.device_id ?? '',
          lastSeenAt: d.last_seen_at ?? null,
        })),
        deviceLimit: body.deviceLimit ?? 1,
      },
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** v9.7 AI 配额查询：读当前身份模式（非会员试用总额 / 会员每日）与剩余次数，不消耗次数。
 *  配额数字只在后端。 */
export async function aiQuota(token: string): Promise<{
  ok: boolean
  member?: boolean
  mode?: 'trial_total' | 'daily'
  limit?: number
  used?: number
  remaining?: number
  error?: string
}> {
  try {
    const res = await fetch(`${API_BASE}/ai/quota`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as {
      ok?: boolean
      member?: boolean
      mode?: 'trial_total' | 'daily'
      limit?: number
      used?: number
      remaining?: number
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return {
      ok: true,
      member: body.member,
      mode: body.mode,
      limit: body.limit,
      used: body.used,
      remaining: body.remaining,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** v9.7 AI 智能导入：一段话 → 结构化结果（云函数 /ai/import，DeepSeek 后端直连）。
 *  配额数字只由后端返回（非会员试用总额 / 会员每日），前端不写死。
 *  返回 { structured, quota, usage }；429 = ai_quota_exceeded（mode: trial_total | daily） */
export async function aiImport(
  token: string,
  text: string,
  today: string,
  audio?: { data: string; format?: string },
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
  mode?: 'trial_total' | 'daily'
}> {
  try {
    const res = await fetch(`${API_BASE}/ai/import`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        today,
        // v9.7 语音：audio = WAV base64（由 voiceInput 录音产生），后端 ASR 转文本后走同一分类流程
        audio: audio ? audio.data : undefined,
        format: audio ? (audio.format ?? 'wav') : undefined,
      }),
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
      mode?: 'trial_total' | 'daily'
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}`, mode: body.mode }
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
      mode: body.mode,
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

// ---- v9.7 第 3 步：会员状态与兑换码 ----

/** 会员状态查询（云函数 /member）：member + 到期时间 + 云同步设备上限 */
export async function fetchMember(token: string): Promise<{
  ok: boolean
  member?: boolean
  memberExpiresAt?: string | null
  deviceLimit?: number
  error?: string
}> {
  try {
    const res = await fetch(`${API_BASE}/member`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = (await res.json()) as {
      ok?: boolean
      member?: boolean
      memberExpiresAt?: string | null
      deviceLimit?: number
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return {
      ok: true,
      member: body.member,
      memberExpiresAt: body.memberExpiresAt ?? null,
      deviceLimit: body.deviceLimit,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 兑换码核销（云函数 /redeem）：成功返回新的会员到期时间 */
export async function redeemCode(
  token: string,
  code: string,
): Promise<{ ok: boolean; expiresAt?: string; days?: number; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/redeem`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    })
    const body = (await res.json()) as {
      ok?: boolean
      expiresAt?: string
      days?: number
      error?: string
    }
    if (!res.ok || !body.ok) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` }
    }
    return { ok: true, expiresAt: body.expiresAt, days: body.days }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
