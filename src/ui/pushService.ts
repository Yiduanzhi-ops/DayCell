/**
 * DayCell Web Push 前端服务（v9.3）。
 *
 * 职责：
 *  1. 能力检测：Service Worker / PushManager / 安全上下文
 *  2. 订阅授权：Notification.requestPermission（需用户手势触发）→ pushManager.subscribe
 *  3. 云端上报：/push/subscribe（带 token，早晚偏好一体 upsert）；全关时走 /push/unsubscribe
 *
 * 平台边界（真实约束，写进 UI 提示）：
 *  - iOS 16.4+ Safari：仅当页面被"添加到主屏幕"（成为 PWA）后从主屏启动，
 *    pushManager 才可用；普通 Safari 标签页不支持 Web Push。
 *  - Android Chrome：标准支持，但必须已添加/安装为 PWA 才稳定（Chrome 对未安装
 *    的站点隐藏通知权限）。
 *  - 桌面 Chrome/Edge/Firefox：HTTPS + Service Worker 即可（Chrome 亦要求已安装或
 *    频繁使用，edge 情况会弹权限）。
 *  - 所有平台：HTTP（非 localhost）下 PushManager 不存在。
 */

import {
  deletePushSubscription,
  getAccessToken,
  savePushSubscription,
  type PushPrefs,
  type PushSubscriptionBody,
  VAPID_PUBLIC_KEY,
} from './cloudbase'

export type PushSupportState = 'supported' | 'unsupported' | 'no-sw'

/** 早/晚可选档位（与云端 cron 07-9 点/18-22 点 半小时粒度对齐） */
export const MORNING_SLOTS = ['07:30', '08:00', '08:30', '09:00', '09:30'] as const
export const EVENING_SLOTS = ['19:00', '19:30', '20:00', '20:30', '21:00', '21:30', '22:00'] as const

/** VAPID 公钥 → Uint8Array（pushManager.subscribe 的 applicationServerKey 要求格式） */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/** 能力检测（纯同步，可在渲染层调用） */
export function getPushSupport(): PushSupportState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  return 'supported'
}

/** 等 SW ready（注册由 main.tsx 完成） */
export async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

/** 读取现有浏览器端订阅（未授权/无 → null） */
export async function getExistingSubscription(): Promise<PushSubscriptionBody | null> {
  const reg = await getRegistration()
  if (!reg) return null
  try {
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return null
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
    return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
  } catch {
    return null
  }
}

/**
 * 确保存在浏览器端订阅：
 *  - 已授权（'granted'）且已有订阅 → 直接复用（不重复弹权限）
 *  - 已授权但无订阅 → subscribe（vapid 公钥）
 *  - 未授权 → requestPermission（用户手势内调用）；用户拒绝 → 返回错误
 *  - 不支持 → 返回错误
 */
export async function getOrCreateSubscription(): Promise<
  { ok: true; subscription: PushSubscriptionBody } | { ok: false; error: string }
> {
  const support = getPushSupport()
  if (support !== 'supported') {
    return { ok: false, error: '当前浏览器不支持网页推送（需 HTTPS + Service Worker）' }
  }
  try {
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      return { ok: false, error: '通知权限被拒绝，请在浏览器设置中允许后重试' }
    }
    const reg = await getRegistration()
    if (!reg) {
      return { ok: false, error: 'Service Worker 未就绪，请刷新页面后重试' }
    }
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, error: '订阅数据不完整，请重试' }
    }
    return {
      ok: true,
      subscription: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export interface SyncResult {
  ok: boolean
  error?: string
  /** 用户拒绝了通知权限（UI 可据此给出平台引导文案） */
  permissionDenied?: boolean
  /** 未登录（UI 提示先登录云同步） */
  loginRequired?: boolean
}

/**
 * 把当前偏好同步到云端（设置页每次改动调用一次）：
 *  - 任一通知开启：确保浏览器订阅（首次会弹权限）→ /push/subscribe 一体 upsert
 *  - 全部关闭：若有订阅 → /push/unsubscribe 删除云端记录（浏览器端订阅保留，便于日后重开）
 */
export async function syncPushPrefs(prefs: PushPrefs): Promise<SyncResult> {
  const token = await getAccessToken()
  if (!token) {
    return { ok: false, loginRequired: true, error: '请先登录云同步（设置 → 同步设置）' }
  }

  const anyEnabled = prefs.morning.enabled || prefs.evening.enabled

  if (!anyEnabled) {
    // 全关：删云端记录即可（浏览器端订阅保留，重开时 getSubscription 复用）
    const existing = await getExistingSubscription()
    if (existing) {
      const res = await deletePushSubscription(token, existing.endpoint)
      if (!res.ok) return { ok: false, error: res.error ?? '退订失败' }
    }
    return { ok: true }
  }

  const subRes = await getOrCreateSubscription()
  if (!subRes.ok) {
    return {
      ok: false,
      error: subRes.error,
      permissionDenied: subRes.error.includes('权限被拒绝') || subRes.error.includes('拒绝'),
    }
  }
  const res = await savePushSubscription(token, subRes.subscription, prefs)
  if (!res.ok) return { ok: false, error: res.error ?? '保存失败' }
  return { ok: true }
}
