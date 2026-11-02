import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchSyncStatus, detectDeviceName } from './cloudbase'

describe('cloudbase.fetchSyncStatus 设备列表解析', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('按后端驼峰字段解析（deviceId/deviceName/lastSeenAt），不读下划线字段', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          lastSyncAt: '2026-11-02T07:00:00Z',
          recordCount: 1,
          devices: [
            { deviceId: 'dev-a', deviceName: 'macOS · Chrome', lastSeenAt: '2026-11-02T07:00:00Z' },
            { deviceId: 'dev-b', deviceName: null, lastSeenAt: null },
          ],
        }),
      })),
    )
    const r = await fetchSyncStatus('tok')
    expect(r.ok).toBe(true)
    expect(r.status?.devices).toEqual([
      { deviceId: 'dev-a', deviceName: 'macOS · Chrome', lastSeenAt: '2026-11-02T07:00:00Z' },
      { deviceId: 'dev-b', deviceName: null, lastSeenAt: null },
    ])
  })
})

describe('cloudbase.detectDeviceName', () => {
  it('macOS Chrome → macOS · Chrome', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      configurable: true,
    })
    expect(detectDeviceName()).toBe('macOS · Chrome')
  })

  it('无法识别时返回空串', () => {
    Object.defineProperty(navigator, 'userAgent', {
      value: 'unknown-agent',
      configurable: true,
    })
    expect(detectDeviceName()).toBe('')
  })
})
