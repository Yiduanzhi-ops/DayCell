/**
 * diagnose 层测试。
 *
 * 全部用**注入的假全局**跑，因此这个文件本身就是铁律 2 的证明：
 * 一个不碰 window/navigator/indexedDB 的模块，才能在纯 Node 环境里被这样测。
 *
 * 重点不是"能读出 true"，而是**探测不到时绝不抛错**——
 * 诊断失败让应用白屏，比诊断结果不准严重得多。
 */
import { describe, expect, it } from 'vitest'
import { diagnose, unknownDiagnosis, type DiagnoseDeps, type DiagnoseNavigator } from './diagnose'

/** 一台"什么都支持"的机器 */
function fullEnv(over: Partial<DiagnoseDeps> = {}): DiagnoseDeps {
  const nav: DiagnoseNavigator = {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 5,
    standalone: false,
    serviceWorker: { register: () => {} },
    storage: { estimate: async () => ({ usage: 1234, quota: 5_000_000 }) },
  }
  return {
    indexedDB: { open: () => {} },
    navigator: nav,
    matchMedia: (q: string) => ({ matches: q === '(display-mode: standalone)' }),
    isSecureContext: true,
    ...over,
  }
}

describe('基线', () => {
  it('不传任何依赖 → 全 false，且**不抛错**', async () => {
    expect(await diagnose()).toEqual(unknownDiagnosis())
    expect(await diagnose({})).toEqual(unknownDiagnosis())
  })

  it('unknownDiagnosis 每次返回新对象（UI 不该拿到共享的可变态）', () => {
    expect(unknownDiagnosis()).not.toBe(unknownDiagnosis())
  })

  it('什么都支持的机器 → 全 true + 拿到配额', async () => {
    expect(await diagnose(fullEnv())).toEqual({
      indexedDB: true,
      storageEstimate: true,
      serviceWorker: true,
      // fullEnv 的 matchMedia 桩对 '(display-mode: standalone)' 返回 matches:true，
      // 所以这台机器算"已装到主屏"——这正是 fullEnv 想表达的"全都支持"
      installed: true,
      secureContext: true,
      usage: { usage: 1234, quota: 5_000_000 },
      userAgentIOS: true,
    })
  })
})

describe('indexedDB 预检', () => {
  it('对象存在但没有 open（被策略阉割的壳）→ false', async () => {
    expect((await diagnose(fullEnv({ indexedDB: {} }))).indexedDB).toBe(false)
  })

  it('null / undefined → false', async () => {
    expect((await diagnose(fullEnv({ indexedDB: null }))).indexedDB).toBe(false)
  })

  it('open 不是函数 → false', async () => {
    expect((await diagnose(fullEnv({ indexedDB: { open: 42 } }))).indexedDB).toBe(false)
  })
})

describe('配额探测', () => {
  it('没有 estimate 方法 → storageEstimate false，usage 为 undefined', async () => {
    const d = await diagnose(fullEnv({ navigator: { userAgent: 'x' } }))
    expect(d.storageEstimate).toBe(false)
    expect(d.usage).toBeUndefined()
  })

  it('estimate 只返回 usage、缺 quota → 整个不给，避免 UI 拿半截数据算出离谱百分比', async () => {
    const nav: DiagnoseNavigator = { storage: { estimate: async () => ({ usage: 100 }) } }
    const d = await diagnose(fullEnv({ navigator: nav }))
    expect(d.storageEstimate).toBe(true)
    expect(d.usage).toBeUndefined()
  })

  it('★ estimate() reject（部分浏览器视配额为隐私）→ 不抛错，其余字段照常', async () => {
    const nav: DiagnoseNavigator = {
      storage: {
        estimate: async () => {
          throw new DOMException('NotAllowedError')
        },
      },
      serviceWorker: {},
    }
    const d = await diagnose(fullEnv({ navigator: nav }))
    expect(d.usage).toBeUndefined()
    expect(d.serviceWorker).toBe(true)
    expect(d.indexedDB).toBe(true)
  })

  it('estimate 返回非数字 → 不给 usage', async () => {
    const nav: DiagnoseNavigator = {
      storage: { estimate: async () => ({ usage: '很多', quota: null }) as unknown as { usage: number } },
    }
    expect((await diagnose(fullEnv({ navigator: nav }))).usage).toBeUndefined()
  })
})

describe('★ iOS 检测（PRD S1 / E3 的引导依赖它）', () => {
  const withUA = (userAgent: string, maxTouchPoints = 0) =>
    diagnose(fullEnv({ navigator: { userAgent, maxTouchPoints } }))

  it('iPhone UA', async () => {
    expect((await withUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).userAgentIOS).toBe(true)
  })

  it('老 iPad UA（iPadOS 12 及以前）', async () => {
    expect((await withUA('Mozilla/5.0 (iPad; CPU OS 12_4)')).userAgentIOS).toBe(true)
  })

  it('★ iPadOS 13+ 把自己报成 Macintosh，只能靠多点触控捞回来', async () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
    expect((await withUA(mac, 5)).userAgentIOS).toBe(true)
    // 真 Mac 没有多点触控 → 不能误判成 iPad
    expect((await withUA(mac, 0)).userAgentIOS).toBe(false)
  })

  it('Android / Windows / 空 UA → false', async () => {
    expect((await withUA('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).userAgentIOS).toBe(false)
    expect((await withUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).userAgentIOS).toBe(false)
    expect((await withUA('')).userAgentIOS).toBe(false)
  })

  it('navigator 整个缺失 → false，不抛错', async () => {
    expect((await diagnose(fullEnv({ navigator: null }))).userAgentIOS).toBe(false)
  })
})

describe('是否已装到主屏', () => {
  it('iOS 的 navigator.standalone=true → 已安装（此时不必查 matchMedia）', async () => {
    let queried = false
    const d = await diagnose(
      fullEnv({
        navigator: { standalone: true },
        matchMedia: () => {
          queried = true
          return { matches: false }
        },
      }),
    )
    expect(d.installed).toBe(true)
    expect(queried).toBe(false) // 短路：老 iOS 不支持 display-mode 查询，问它反而可能抛
  })

  it('标准 display-mode: standalone → 已安装', async () => {
    const d = await diagnose(fullEnv({ matchMedia: () => ({ matches: true }) }))
    expect(d.installed).toBe(true)
  })

  it('matchMedia 查询的是别的 media query → 不算已安装', async () => {
    const d = await diagnose(fullEnv({ matchMedia: (q) => ({ matches: q === '(min-width: 800px)' }) }))
    expect(d.installed).toBe(false)
  })

  it('matchMedia 缺失 / 返回 undefined → false', async () => {
    expect((await diagnose(fullEnv({ matchMedia: null }))).installed).toBe(false)
    expect(
      (await diagnose(fullEnv({ matchMedia: (() => undefined) as unknown as DiagnoseDeps['matchMedia'] })))
        .installed,
    ).toBe(false)
  })

  it('★ matchMedia 抛错（老浏览器）→ false，不能让诊断整体失败', async () => {
    const d = await diagnose(
      fullEnv({
        matchMedia: () => {
          throw new Error('不支持')
        },
      }),
    )
    expect(d.installed).toBe(false)
    expect(d.indexedDB).toBe(true) // 其余字段不受影响
  })
})

describe('secureContext', () => {
  it('只有严格 true 才算', async () => {
    expect((await diagnose(fullEnv({ isSecureContext: true }))).secureContext).toBe(true)
    expect((await diagnose(fullEnv({ isSecureContext: false }))).secureContext).toBe(false)
    expect((await diagnose(fullEnv({ isSecureContext: undefined }))).secureContext).toBe(false)
    // truthy 不等于 true：装配层若误传了字符串 'false' 也不能被当成安全上下文
    expect(
      (await diagnose(fullEnv({ isSecureContext: 'false' as unknown as boolean }))).secureContext,
    ).toBe(false)
  })
})

describe('serviceWorker', () => {
  it('存在即 true（不校验 register 是否可用，注册失败由 SW 层自己处理）', async () => {
    expect((await diagnose(fullEnv({ navigator: { serviceWorker: {} } }))).serviceWorker).toBe(true)
    expect((await diagnose(fullEnv({ navigator: {} }))).serviceWorker).toBe(false)
    expect((await diagnose(fullEnv({ navigator: { serviceWorker: null } }))).serviceWorker).toBe(false)
  })
})

describe('装配层的真实写法', () => {
  it('把类 globalThis 的对象直接传进来能正常工作', async () => {
    // src/app 里就是这么调的：从 globalThis 取好再注入，core 自己不碰全局
    const fakeGlobal = {
      indexedDB: { open: () => {} },
      navigator: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120',
        maxTouchPoints: 0,
        serviceWorker: {},
        storage: { estimate: async () => ({ usage: 0, quota: 0 }) },
      },
      matchMedia: () => ({ matches: false }),
      isSecureContext: true,
    }
    const d = await diagnose({
      indexedDB: fakeGlobal.indexedDB,
      navigator: fakeGlobal.navigator,
      matchMedia: fakeGlobal.matchMedia,
      isSecureContext: fakeGlobal.isSecureContext,
    })
    expect(d).toMatchObject({
      indexedDB: true,
      serviceWorker: true,
      secureContext: true,
      userAgentIOS: false,
      installed: false,
      usage: { usage: 0, quota: 0 },
    })
  })
})
