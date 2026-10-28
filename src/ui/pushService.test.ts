/**
 * ui/pushService 测试（v9.3 Web Push 前端服务）：
 *  - urlBase64ToUint8Array：VAPID 公钥解码为 65 字节、0x04 前缀的标准 EC P-256 公钥
 *  - getPushSupport：无 PushManager → unsupported；齐备 → supported
 *  - syncPushPrefs 全关分支：无云端订阅时不发请求、直接 ok
 *  - syncPushPrefs 开启分支：请求权限 → subscribe → 上报 /push/subscribe（body 契约正确）
 *  - 权限拒绝：返回 permissionDenied
 *  - 未登录：返回 loginRequired
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 云端 API 走真实 fetch（断言 body/URL），仅登录态 mock：
// 测试环境没有 CloudBase auth 会话，getAccessToken 会拿不到 token。
vi.mock('@/ui/cloudbase', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./cloudbase')>()
  return {
    ...mod,
    getAccessToken: vi.fn().mockResolvedValue('test-token'),
  }
})

import { urlBase64ToUint8Array, getPushSupport, syncPushPrefs, getOrCreateSubscription } from './pushService'
import { getAccessToken, VAPID_PUBLIC_KEY } from './cloudbase'

/** 造一个符合 PushSubscription.toJSON 形状的订阅 */
function fakeSubscriptionJson(endpoint = 'https://push.example.com/ep1') {
  return {
    endpoint,
    keys: { p256dh: 'AAAABBBB', auth: 'CCCCDDDD' },
  }
}

/** mock 浏览器 push 基础环境：SW ready + pushManager + Notification + fetch */
function setupPushEnv(over: {
  permission?: NotificationPermission
  existing?: ReturnType<typeof fakeSubscriptionJson> | null
  fetchOk?: boolean
  fetchError?: string | null
} = {}) {
  const {
    permission = 'granted',
    existing = null,
    fetchOk = true,
    fetchError = null,
  } = over

  const subscribeMock = vi.fn().mockResolvedValue({
    toJSON: () => fakeSubscriptionJson(),
  })
  const getSubscriptionMock = vi.fn().mockResolvedValue(
    existing ? { toJSON: () => existing } : null,
  )
  const pushManager = {
    getSubscription: getSubscriptionMock,
    subscribe: subscribeMock,
  }
  const registration = { pushManager }

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration) },
  })
  ;(globalThis as Record<string, unknown>).PushManager = class PushManager {}

  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    value: {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    },
  })

  const fetchMock = vi.fn().mockImplementation(async (_fetchUrl: string, _fetchInit: RequestInit) => {
    if (fetchError) throw new Error(fetchError)
    return {
      ok: fetchOk,
      status: fetchOk ? 200 : 500,
      json: async () => (fetchOk ? { ok: true } : { ok: false, error: 'server_error' }),
    }
  })
  vi.stubGlobal('fetch', fetchMock)

  return {
    subscribeMock,
    getSubscriptionMock,
    registration,
    fetchMock,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  // 还原 navigator.serviceWorker / Notification（jsdom 默认态）
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
  delete (globalThis as Record<string, unknown>).PushManager
})

beforeEach(() => {
  // 默认登录态：getAccessToken → 'test-token'（每个用例可再覆写）
  vi.mocked(getAccessToken).mockResolvedValue('test-token')
})

describe('urlBase64ToUint8Array', () => {
  it('把 VAPID 公钥解码为 65 字节 EC 公钥（0x04 前缀）', () => {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(65)
    expect(key[0]).toBe(0x04)
  })

  it('对带 -_ 的 URL-safe base64 正常解码', () => {
    // 'AQ==' → 0x01；URL-safe 变体也 OK
    const key = urlBase64ToUint8Array('AQ')
    expect(key.length).toBe(1)
    expect(key[0]).toBe(1)
  })
})

describe('getPushSupport', () => {
  it('无 PushManager → unsupported', () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
    expect(getPushSupport()).toBe('unsupported')
  })

  it('SW + PushManager 齐备 → supported', () => {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
    ;(globalThis as Record<string, unknown>).PushManager = class PushManager {}
    expect(getPushSupport()).toBe('supported')
  })
})

describe('getOrCreateSubscription', () => {
  it('权限 granted + 已有订阅 → 直接复用（不重复 subscribe）', async () => {
    const env = setupPushEnv({ existing: fakeSubscriptionJson() })
    const res = await getOrCreateSubscription()
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.subscription.endpoint).toBe('https://push.example.com/ep1')
    }
    expect(env.subscribeMock).not.toHaveBeenCalled()
  })

  it('权限 granted + 无订阅 → subscribe 创建', async () => {
    const env = setupPushEnv()
    const res = await getOrCreateSubscription()
    expect(res.ok).toBe(true)
    expect(env.subscribeMock).toHaveBeenCalledTimes(1)
    const arg = env.subscribeMock.mock.calls[0][0]
    expect(arg.userVisibleOnly).toBe(true)
    expect(arg.applicationServerKey).toBeInstanceOf(Uint8Array)
    expect((arg.applicationServerKey as Uint8Array).length).toBe(65)
  })

  it('权限被拒绝 → 返回 permissionDenied 语义错误', async () => {
    setupPushEnv({ permission: 'denied' })
    const res = await getOrCreateSubscription()
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('权限被拒绝')
  })
})

describe('syncPushPrefs', () => {
  it('全关且无订阅 → 不发请求直接 ok', async () => {
    setupPushEnv({ existing: null })
    const res = await syncPushPrefs({
      morning: { enabled: false, time: null },
      evening: { enabled: false, time: null },
    })
    expect(res.ok).toBe(true)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('开启 → 上报 /push/subscribe，body 含 endpoint/keys/早晚偏好/timezone', async () => {
    const env = setupPushEnv()
    const res = await syncPushPrefs({
      morning: { enabled: true, time: '08:00' },
      evening: { enabled: false, time: null },
    })
    expect(res.ok).toBe(true)
    expect(env.fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = env.fetchMock.mock.calls[0]
    expect(String(url)).toContain('/push/subscribe')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-token')
    const body = JSON.parse(String((init as RequestInit).body)) as {
      endpoint: string
      keys: { p256dh: string; auth: string }
      morning: { enabled: boolean; time: string }
      evening: { enabled: boolean; time: string }
      timezone: string
    }
    expect(body.endpoint).toBe('https://push.example.com/ep1')
    expect(body.keys).toEqual({ p256dh: 'AAAABBBB', auth: 'CCCCDDDD' })
    expect(body.morning).toEqual({ enabled: true, time: '08:00' })
    expect(body.evening).toEqual({ enabled: false, time: null })
    expect(body.timezone).toBeTruthy()
  })

  it('全关但已有订阅 → 调 /push/unsubscribe', async () => {
    const env = setupPushEnv({ existing: fakeSubscriptionJson() })
    const res = await syncPushPrefs({
      morning: { enabled: false, time: null },
      evening: { enabled: false, time: null },
    })
    expect(res.ok).toBe(true)
    expect(env.fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = env.fetchMock.mock.calls[0]
    expect(String(url)).toContain('/push/unsubscribe')
    const body = JSON.parse(String((init as RequestInit).body)) as { endpoint: string }
    expect(body.endpoint).toBe('https://push.example.com/ep1')
  })

  it('未登录 → loginRequired，不发请求', async () => {
    vi.mocked(getAccessToken).mockResolvedValue(null)
    setupPushEnv()
    const res = await syncPushPrefs({
      morning: { enabled: true, time: '08:00' },
      evening: { enabled: false, time: null },
    })
    expect(res.ok).toBe(false)
    expect(res.loginRequired).toBe(true)
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('云端保存失败 → ok:false + error', async () => {
    setupPushEnv({ fetchOk: false })
    const res = await syncPushPrefs({
      morning: { enabled: true, time: '08:00' },
      evening: { enabled: false, time: null },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBeTruthy()
  })
})
