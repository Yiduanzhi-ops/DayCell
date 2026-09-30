/**
 * 农历模块测试。
 *
 * 分两类：
 *  1. **打真实 lunar-typescript** 的用例——断言值全部来自事先实测（见文件内注释），
 *     因为库的行为没有可靠文档，靠猜会写出"看起来对"的假断言。
 *  2. **注入假 loader** 的用例——覆盖 PRD E4 加载失败与降级，不依赖真实库。
 */
import { describe, it, expect, vi } from 'vitest'
import type { DateKey } from './types'
import type { LunarInfo } from './lunar'
import {
  loadLunar,
  pickFestival,
  resolveSolarAnniversary,
  supportedRangeCheck,
  FESTIVAL_KEYWORDS,
  LUNAR_YEAR_MIN,
  LUNAR_YEAR_MAX,
  __resetLunarCache,
  type LunarModule,
} from './lunar'
import { cellLabel, lunarFullText } from './label'
import { LunarUnavailableError } from './errors'

const k = (s: string): DateKey => s as DateKey

// ---------------------------------------------------------------------------
// 白名单（PRD D15）
// ---------------------------------------------------------------------------
describe('pickFestival', () => {
  it('命中白名单的保留原名（含「节」后缀）', () => {
    expect(pickFestival(['教师节'])).toBe('教师节')
    expect(pickFestival(['国庆节'])).toBe('国庆节')
    expect(pickFestival(['中秋节'])).toBe('中秋节')
    expect(pickFestival(['春节'])).toBe('春节')
    // 库返回「元旦节」而不是「元旦」，全等匹配会静默失效——这条就是在守它
    expect(pickFestival(['元旦节'])).toBe('元旦节')
  })

  it('噪音一律过滤掉', () => {
    // 这三个都是 getOtherFestivals() 的真实返回值（2026-09-10 / 09-11 实测）
    expect(pickFestival(['地藏节'])).toBeUndefined()
    expect(pickFestival(['天灸日'])).toBeUndefined()
    expect(pickFestival(['世界住房日'])).toBeUndefined()
  })

  it('多个候选时取第一个命中的，跳过前面的噪音', () => {
    expect(pickFestival(['地藏节', '中秋节'])).toBe('中秋节')
  })

  it('空数组返回 undefined', () => {
    expect(pickFestival([])).toBeUndefined()
  })

  it('白名单与 PRD D15 一致', () => {
    expect([...FESTIVAL_KEYWORDS]).toEqual([
      '春节', '元宵', '清明', '端午', '中秋', '重阳', '除夕',
      '国庆', '元旦', '劳动节', '儿童节', '教师节', '妇女节', '植树节',
    ])
  })
})

// ---------------------------------------------------------------------------
// 公历纪念日（纯函数，不需要农历库）
// ---------------------------------------------------------------------------
describe('resolveSolarAnniversary', () => {
  it('普通日期只换年份', () => {
    expect(resolveSolarAnniversary('2026-09-30', 2027)).toEqual({
      key: k('2027-09-30'), usedFallbackMonth: false, usedFallbackDay: false,
    })
    expect(resolveSolarAnniversary('2026-01-01', 2030).key).toBe('2030-01-01')
  })

  it('2/29 在闰年保持 2/29', () => {
    expect(resolveSolarAnniversary('2024-02-29', 2028)).toEqual({
      key: k('2028-02-29'), usedFallbackMonth: false, usedFallbackDay: false,
    })
  })

  it('2/29 在平年记 2/28 并打标（不能悄悄变成 3/1）', () => {
    const r = resolveSolarAnniversary('2024-02-29', 2027)
    expect(r.key).toBe('2027-02-28')
    expect(r.usedFallbackDay).toBe(true)
    expect(r.usedFallbackMonth).toBe(false)
  })

  it('格式错误 / 非法月日 → key 为 null', () => {
    expect(resolveSolarAnniversary('2026-9-30', 2027).key).toBeNull()
    expect(resolveSolarAnniversary('不是日期', 2027).key).toBeNull()
    expect(resolveSolarAnniversary('2026-13-01', 2027).key).toBeNull()
    expect(resolveSolarAnniversary('2026-00-10', 2027).key).toBeNull()
    expect(resolveSolarAnniversary('2026-01-32', 2027).key).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 打真实库：日期 → 农历
// ---------------------------------------------------------------------------
describe('lunarOf（真实 lunar-typescript）', () => {
  it('普通日子只有农历日', async () => {
    const api = await loadLunar()
    // 实测：2026-09-29 = 八月十九，无节气无节日
    expect(api.lunarOf(k('2026-09-29'))).toEqual({
      lunarDay: '十九', lunarMonth: '八', isLeapMonth: false,
      festival: undefined, solarTerm: undefined,
    })
  })

  it('农历节日', async () => {
    const api = await loadLunar()
    // 实测：2026-09-25 农历节 = ['中秋节']
    expect(api.lunarOf(k('2026-09-25'))!.festival).toBe('中秋节')
    // 实测：2026-02-17 农历节 = ['春节']，同时是正月初一
    const spring = api.lunarOf(k('2026-02-17'))!
    expect(spring.festival).toBe('春节')
    expect(spring.lunarDay).toBe('初一')
  })

  it('公历节日（名字带「节」后缀，靠 includes 命中）', async () => {
    const api = await loadLunar()
    expect(api.lunarOf(k('2026-10-01'))!.festival).toBe('国庆节')
    expect(api.lunarOf(k('2026-09-10'))!.festival).toBe('教师节')
  })

  it('节气；非节气日为 undefined 而不是空串', async () => {
    const api = await loadLunar()
    // 实测：2026-09-07 白露、2026-04-05 清明
    expect(api.lunarOf(k('2026-09-07'))!.solarTerm).toBe('白露')
    expect(api.lunarOf(k('2026-04-05'))!.solarTerm).toBe('清明')
    expect(api.lunarOf(k('2026-09-29'))!.solarTerm).toBeUndefined()
  })

  it('清明只以节气形式出现（库不把它当节日），标签仍能显示', async () => {
    const api = await loadLunar()
    const info = api.lunarOf(k('2026-04-05'))!
    expect(info.festival).toBeUndefined()
    expect(cellLabel(info, [])).toEqual({ text: '清明', kind: 'solarTerm', emphasis: true })
  })

  it('初一给出 lunarDay="初一"，供标签层换成月份名', async () => {
    const api = await loadLunar()
    // 实测：2026-09-11 = 八月初一，且 getOtherFestivals 返回噪音「天灸日」
    const info = api.lunarOf(k('2026-09-11'))!
    expect(info.lunarDay).toBe('初一')
    expect(info.lunarMonth).toBe('八')
    expect(info.festival).toBeUndefined() // 噪音被挡住，因为我们根本不读 getOtherFestivals
    expect(cellLabel(info, [])).toEqual({ text: '八月', kind: 'lunarMonth', emphasis: true })
  })

  it('闰月能被识别', async () => {
    const api = await loadLunar()
    // 实测：2025-07-25 = 闰六月初一
    const info = api.lunarOf(k('2025-07-25'))!
    expect(info.isLeapMonth).toBe(true)
    expect(info.lunarDay).toBe('初一')
    expect(cellLabel(info, [])).toEqual({ text: '闰六月', kind: 'lunarMonth', emphasis: true })
  })

  it('超出支持范围返回 null（PRD E14）——库本身不抛错，必须自己挡', async () => {
    const api = await loadLunar()
    // 实测：1899 与 2101 库都照常返回值，所以范围判断只能由我们做
    expect(api.lunarOf(k('1899-12-31'))).toBeNull()
    expect(api.lunarOf(k('2101-01-01'))).toBeNull()
    // 边界内可用
    expect(api.lunarOf(k('1900-01-01'))).not.toBeNull()
    expect(api.lunarOf(k('2100-12-31'))).not.toBeNull()
  })

  it('supportedRange 与常量一致', async () => {
    const api = await loadLunar()
    expect(api.supportedRange()).toEqual(supportedRangeCheck())
    expect(api.supportedRange().from).toBe(`${LUNAR_YEAR_MIN}-01-01`)
    expect(api.supportedRange().to).toBe(`${LUNAR_YEAR_MAX}-12-31`)
  })
})

// ---------------------------------------------------------------------------
// 打真实库：农历纪念日换算
// ---------------------------------------------------------------------------
describe('lunarAnniversary（真实 lunar-typescript）', () => {
  it('常规换算', async () => {
    const api = await loadLunar()
    // 实测：农历 2027 年八月十五 = 公历 2027-09-15
    expect(api.lunarAnniversary('2026-08-15', 2027)).toEqual({
      key: k('2027-09-15'), usedFallbackMonth: false, usedFallbackDay: false,
    })
  })

  it('闰月在该年存在时按闰月算', async () => {
    const api = await loadLunar()
    // 实测：2025 有闰六月，闰六月初一 = 2025-07-25
    expect(api.lunarAnniversary('2025-06-01', 2025, true)).toEqual({
      key: k('2025-07-25'), usedFallbackMonth: false, usedFallbackDay: false,
    })
  })

  it('该年无此闰月 → 回退到正月号并打标（PRD E13）', async () => {
    const api = await loadLunar()
    // 实测：2026 年没有任何闰月；六月初一 = 2026-07-14
    const r = api.lunarAnniversary('2025-06-01', 2026, true)
    expect(r.key).toBe('2026-07-14')
    expect(r.usedFallbackMonth).toBe(true)
    expect(r.usedFallbackDay).toBe(false)
  })

  it('该月只有 29 天时，三十 → 廿九并打标（PRD E25，PRD 原先漏掉的场景）', async () => {
    const api = await loadLunar()
    // 实测：2026 八月只有 29 天，fromYmd(2026,8,30) 抛错；八月廿九 = 2026-10-09
    const r = api.lunarAnniversary('2026-08-30', 2026)
    expect(r.key).toBe('2026-10-09')
    expect(r.usedFallbackDay).toBe(true)
    expect(r.usedFallbackMonth).toBe(false)
  })

  it('闰月 + 三十 双重缺失时两个标记都为真', async () => {
    const api = await loadLunar()
    // 2026 既无闰月，八月也只有 29 天 → 四个候选全部试到最后一个
    const r = api.lunarAnniversary('2026-08-30', 2026, true)
    expect(r.key).toBe('2026-10-09')
    expect(r.usedFallbackMonth).toBe(true)
    expect(r.usedFallbackDay).toBe(true)
  })

  it('三十确实存在的月份不回退', async () => {
    const api = await loadLunar()
    // 实测：2025 有闰六月；找一个有三十的月——2025 六月
    const r = api.lunarAnniversary('2025-06-30', 2025)
    expect(r.usedFallbackDay).toBe(false)
    expect(r.key).not.toBeNull()
  })

  it('目标年超范围 → key 为 null', async () => {
    const api = await loadLunar()
    expect(api.lunarAnniversary('2026-08-15', 2101).key).toBeNull()
    expect(api.lunarAnniversary('2026-08-15', 1899).key).toBeNull()
  })

  it('输入格式错误或月日非法 → key 为 null', async () => {
    const api = await loadLunar()
    expect(api.lunarAnniversary('2026-8-15', 2027).key).toBeNull()
    expect(api.lunarAnniversary('2026-13-01', 2027).key).toBeNull()
    expect(api.lunarAnniversary('2026-00-15', 2027).key).toBeNull()
    expect(api.lunarAnniversary('2026-08-31', 2027).key).toBeNull() // 农历没有 31 日
  })
})

// ---------------------------------------------------------------------------
// 注入假 loader：加载失败与降级（PRD E4）
// ---------------------------------------------------------------------------
describe('loadLunar 失败路径', () => {
  it('一直失败 → 重试一次后抛 LunarUnavailableError（PRD E4）', async () => {
    const loader = vi.fn(async (): Promise<LunarModule> => {
      throw new Error('chunk 加载失败')
    })
    const sleep = vi.fn(async () => {})

    await expect(loadLunar({ loader, sleep })).rejects.toBeInstanceOf(LunarUnavailableError)
    expect(loader).toHaveBeenCalledTimes(2) // 默认 retries=1 → 共 2 次
    expect(sleep).toHaveBeenCalledTimes(1)
    // 原始错误挂在 cause 上，便于 diagnose 上报
    await loadLunar({ loader, sleep }).catch((e: LunarUnavailableError) => {
      expect(e.code).toBe('LUNAR_UNAVAILABLE')
      expect((e.cause as Error).message).toBe('chunk 加载失败')
    })
  })

  it('retries=0 时只尝试一次，也不 sleep', async () => {
    const loader = vi.fn(async (): Promise<LunarModule> => {
      throw new Error('boom')
    })
    const sleep = vi.fn(async () => {})
    await expect(loadLunar({ loader, retries: 0, sleep })).rejects.toBeInstanceOf(LunarUnavailableError)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('第一次失败第二次成功 → 正常返回（网络抖动可恢复）', async () => {
    let calls = 0
    const loader = vi.fn(async (): Promise<LunarModule> => {
      if (++calls === 1) throw new Error('临时失败')
      return (await import('lunar-typescript')) as unknown as LunarModule
    })
    const api = await loadLunar({ loader, retryDelayMs: 0 })
    expect(loader).toHaveBeenCalledTimes(2)
    expect(api.lunarOf(k('2026-09-25'))!.festival).toBe('中秋节')
  })

  it('retryDelayMs=0 时不 sleep（测试不用真等）', async () => {
    const sleep = vi.fn(async () => {})
    const loader = vi.fn(async (): Promise<LunarModule> => {
      throw new Error('boom')
    })
    await expect(loadLunar({ loader, retryDelayMs: 0, sleep })).rejects.toThrow()
    expect(sleep).not.toHaveBeenCalled()
  })

  it('自定义 loader 不走模块缓存，测试之间不互相污染', async () => {
    const real = await loadLunar()
    const stub = await loadLunar({ loader: async () => fakeModule(), retryDelayMs: 0 })
    // stub 的行为与真实库不同 → 说明确实没被缓存串掉
    expect(stub.lunarOf(k('2026-09-29'))!.lunarDay).toBe('假数据')
    expect(real.lunarOf(k('2026-09-29'))!.lunarDay).toBe('十九')
  })

  it('库内部抛错时 lunarOf 降级为 null，不冒泡到 UI', async () => {
    const api = await loadLunar({
      retryDelayMs: 0,
      loader: async () => fakeModule({ throwOnSolar: true }),
    })
    expect(api.lunarOf(k('2026-09-29'))).toBeNull()
  })

  it('默认 loader 走真实动态 import（生产路径）', async () => {
    __resetLunarCache()
    const api = await loadLunar()
    expect(api.lunarOf(k('2026-09-29'))!.lunarDay).toBe('十九')
    // 第二次拿的是同一个缓存实例
    expect(await loadLunar()).toBe(api)
  })
})

/** 造一个最小可用的假 LunarModule */
function fakeModule(opts: { throwOnSolar?: boolean } = {}): LunarModule {
  const solar = {
    getYear: () => 2026,
    getMonth: () => 9,
    getDay: () => 29,
    getFestivals: () => [],
    getLunar: () => lunar,
  }
  const lunar = {
    getMonth: () => 8,
    getDayInChinese: () => '假数据',
    getMonthInChinese: () => '八',
    getJieQi: () => '',
    getFestivals: () => [],
    getSolar: () => solar,
  }
  return {
    Solar: {
      fromYmd: () => {
        if (opts.throwOnSolar) throw new Error('库内部错误')
        return solar
      },
    },
    Lunar: { fromYmd: () => lunar },
  }
}

// ---------------------------------------------------------------------------
// 标签层（纯函数）
// ---------------------------------------------------------------------------
describe('cellLabel 优先级（PRD D14）', () => {
  const info = (over: Partial<LunarInfo> = {}): LunarInfo => ({
    lunarDay: '十九', lunarMonth: '八', isLeapMonth: false, ...over,
  })

  it('纪念日压过一切', () => {
    const l = cellLabel(info({ festival: '中秋节', solarTerm: '秋分' }), ['妈妈生日'])
    expect(l).toEqual({ text: '妈妈生日', kind: 'anniversary', emphasis: true })
  })

  it('多个纪念日只显示第一个，并用 extra 报余量', () => {
    expect(cellLabel(info(), ['A', 'B', 'C'])).toEqual({
      text: 'A', kind: 'anniversary', emphasis: true, extra: 2,
    })
  })

  it('只有两个纪念日时 extra=1', () => {
    expect(cellLabel(info(), ['A', 'B']).extra).toBe(1)
  })

  it('单个纪念日不带 extra（避免渲染 +0）', () => {
    expect(cellLabel(info(), ['A'])).not.toHaveProperty('extra')
  })

  it('节日 > 节气', () => {
    expect(cellLabel(info({ festival: '中秋节', solarTerm: '秋分' }), []))
      .toEqual({ text: '中秋节', kind: 'festival', emphasis: true })
  })

  it('节气 > 农历日', () => {
    expect(cellLabel(info({ solarTerm: '白露' }), []))
      .toEqual({ text: '白露', kind: 'solarTerm', emphasis: true })
  })

  it('初一显示月份名而不是「初一」', () => {
    expect(cellLabel(info({ lunarDay: '初一' }), []))
      .toEqual({ text: '八月', kind: 'lunarMonth', emphasis: true })
  })

  it('闰月初一带「闰」字（lunarMonth 原样来自库，已含前缀，不得重复加）', () => {
    expect(cellLabel(info({ lunarDay: '初一', lunarMonth: '闰六', isLeapMonth: true }), []).text).toBe('闰六月')
  })

  it('普通农历日不强调', () => {
    expect(cellLabel(info(), [])).toEqual({ text: '十九', kind: 'lunarDay', emphasis: false })
  })

  it('农历不可用时标签留空（PRD E4：公历照常显示，不显示错误文案）', () => {
    expect(cellLabel(null, [])).toEqual({ text: '', kind: 'none', emphasis: false })
  })

  it('农历不可用但纪念日仍显示（纪念日不依赖农历库）', () => {
    expect(cellLabel(null, ['体检'])).toEqual({ text: '体检', kind: 'anniversary', emphasis: true })
  })

  it('anniversaries 省略时按空数组处理', () => {
    expect(cellLabel(info()).kind).toBe('lunarDay')
  })
})

describe('lunarFullText（日详情页）', () => {
  const info = (over: Partial<LunarInfo> = {}): LunarInfo => ({
    lunarDay: '十五', lunarMonth: '八', isLeapMonth: false, ...over,
  })

  it('节日 + 农历日', () => {
    expect(lunarFullText(info({ festival: '中秋节' }))).toBe('中秋节 · 八月十五')
  })

  it('节气 + 节日 + 农历日全拼上，不做取舍', () => {
    expect(lunarFullText(info({ festival: '中秋节', solarTerm: '秋分' }))).toBe('中秋节 · 秋分 · 八月十五')
  })

  it('只有农历日', () => {
    expect(lunarFullText(info())).toBe('八月十五')
  })

  it('闰月带「闰」字，且不重复', () => {
    expect(lunarFullText(info({ lunarMonth: '闰六', lunarDay: '初一', isLeapMonth: true }))).toBe('闰六月初一')
  })

  it('农历不可用返回空串，调用方据此整行不渲染', () => {
    expect(lunarFullText(null)).toBe('')
  })
})
