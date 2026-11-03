/**
 * ui/cloudbase 登录续期测试（v9.17）：
 *  - refreshIfDue：到期前不刷新、临近过期主动刷新、刷新失败分网络类/凭据失效
 *  - ensureSession：无会话→none；续期成功→保持；refresh_token 真失效→清理回本地
 *
 * mock @cloudbase/js-sdk：只关心 auth() 暴露的 getCredentials / refreshTokenForce /
 * getLoginState / signOut 的调用与返回值。
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))

vi.mock('@cloudbase/js-sdk', () => ({
  default: {
    init: () => ({ auth: authMock }),
  },
}))

// 需在 mock 之后动态加载模块（模块级单例 app 会缓存 auth() 引用）
import { ensureSession, refreshIfDue, isCloudLoggedIn } from './cloudbase'

function buildAuth(overrides: {
  credentials?: unknown
  refreshResult?: 'ok' | 'throw' | 'not-a-fn'
  loginState?: unknown
  afterCredentials?: unknown
}) {
  const auth: Record<string, unknown> = {
    getCredentials: vi.fn(async () => overrides.credentials ?? null),
    refreshTokenForce: vi.fn(async () => {}),
    getLoginState: vi.fn(async () => overrides.loginState ?? { user: { getLocalUserInfo: () => ({ email: 'a@b.c' }) } }),
    signOut: vi.fn(async () => {}),
  }
  if (overrides.refreshResult === 'throw') {
    auth.refreshTokenForce = vi.fn(async () => {
      throw new Error('network')
    })
  }
  if (overrides.afterCredentials !== undefined) {
    auth.getCredentials = vi
      .fn()
      .mockResolvedValueOnce(overrides.credentials ?? null)
      .mockResolvedValueOnce(overrides.afterCredentials)
  }
  return auth
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('refreshIfDue（v9.17 主动续期）', () => {
  it('凭据剩余有效期 > 1h：不调刷新，返回 true', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() + 3 * 60 * 60 * 1000),
      },
    })
    authMock.mockReturnValue(auth)

    await expect(refreshIfDue()).resolves.toBe(true)
    expect(auth.refreshTokenForce).not.toHaveBeenCalled()
  })

  it('临近过期（<1h）：主动刷新成功，返回 true', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
      },
    })
    authMock.mockReturnValue(auth)

    await expect(refreshIfDue()).resolves.toBe(true)
    expect(auth.refreshTokenForce).toHaveBeenCalledTimes(1)
  })

  it('已过期 + 刷新抛错但凭据还在（网络类失败）：保持会话，返回 true', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() - 5 * 60 * 1000),
      },
      refreshResult: 'throw',
      afterCredentials: { access_token: 'tok' },
    })
    authMock.mockReturnValue(auth)

    await expect(refreshIfDue()).resolves.toBe(true)
    expect(auth.refreshTokenForce).toHaveBeenCalledTimes(1)
  })

  it('已过期 + 刷新抛错且 SDK 已清凭据（refresh_token 失效）：返回 false', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() - 5 * 60 * 1000),
      },
      refreshResult: 'throw',
      afterCredentials: null,
    })
    authMock.mockReturnValue(auth)

    await expect(refreshIfDue()).resolves.toBe(false)
  })

  it('expires_at 为字符串也能解析', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
    })
    authMock.mockReturnValue(auth)

    await expect(refreshIfDue()).resolves.toBe(true)
    expect(auth.refreshTokenForce).toHaveBeenCalledTimes(1)
  })

  it('无本地凭据（access_token 缺失）：按 isCloudLoggedIn 同步判断', async () => {
    authMock.mockReturnValue(buildAuth({ credentials: null }))
    await expect(refreshIfDue()).resolves.toBe(false)
  })
})

describe('ensureSession（v9.17 容错恢复）', () => {
  it('无登录态：返回 none', async () => {
    const auth = buildAuth({ credentials: null, loginState: null })
    authMock.mockReturnValue(auth)

    await expect(ensureSession()).resolves.toBe('none')
  })

  it('有登录态且续期成功：返回 email，不登出', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
      },
      loginState: { user: { getLocalUserInfo: () => ({ email: 'a@b.c' }) } },
    })
    authMock.mockReturnValue(auth)

    await expect(ensureSession()).resolves.toBe('email')
    expect(auth.refreshTokenForce).toHaveBeenCalledTimes(1)
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('refresh_token 真失效（SDK 已清凭据）：清理会话回本地', async () => {
    const auth = buildAuth({
      credentials: {
        access_token: 'tok',
        refresh_token: 'rt',
        expires_at: new Date(Date.now() - 5 * 60 * 1000),
      },
      refreshResult: 'throw',
      afterCredentials: null,
      loginState: { user: { getLocalUserInfo: () => ({ email: 'a@b.c' }) } },
    })
    authMock.mockReturnValue(auth)

    await expect(ensureSession()).resolves.toBe('none')
    expect(auth.signOut).toHaveBeenCalledTimes(1)
  })

  it('isCloudLoggedIn 以 credentials access_token 为准（不受 user_info 残留影响）', () => {
    localStorage.setItem('user_info_coding-daycell-d3g1vgq8g521cb2a6', JSON.stringify({ email: 'a@b.c' }))
    expect(isCloudLoggedIn()).toBe(false)

    localStorage.setItem(
      'credentials_coding-daycell-d3g1vgq8g521cb2a6',
      JSON.stringify({ access_token: 'tok' }),
    )
    expect(isCloudLoggedIn()).toBe(true)
  })
})
