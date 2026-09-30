/**
 * 农历 / 节气 / 节日（ADR-0004）。
 *
 * **这个文件是全项目唯一允许 import 'lunar-typescript' 的地方**（ESLint 强制）。
 * 库约 80 KB，必须走函数内的动态 import，让它落到独立 chunk，
 * 不进首屏 bundle——首屏预算 ≤ 80 KB gzip 全靠这条。
 *
 * 三条实测得来的库行为，写代码前请再看一眼：
 *  1. 闰月用**负数月份**表示：`Lunar.fromYmd(2025, -6, 1)` = 闰六月初一
 *  2. 超范围年份（1899、2101）**不抛错**，照样返回值 → 范围必须自己判（PRD E14）
 *  3. 两种情况会抛错：该年无此闰月（PRD E13）、该月无三十日（PRD E25）→ 都要回退
 */

import type { DateKey } from './types'
import { fromKey, isLeapYear, toKey } from './date'
import { LunarUnavailableError } from './errors'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 某一天的农历信息。字段全部是**已经过滤/加工过**的，UI 直接用 */
export interface LunarInfo {
  /** '十九'、'初一'、'廿九' */
  lunarDay: string
  /**
   * 农历月中文名，不含「月」字，**闰月已自带「闰」前缀**：普通月是 '八'，闰六月是 '闰六'。
   * 这是 lunar-typescript `getMonthInChinese()` 的原样输出——
   * 展示层直接拼 `${lunarMonth}月` 即可，**不要再自己加「闰」**，否则会变成「闰闰六月」。
   */
  lunarMonth: string
  /** 该农历月是否是闰月。仅供逻辑判断（纪念日换算），展示请用 lunarMonth */
  isLeapMonth: boolean
  /** 白名单过滤后的节日名；无则 undefined（PRD D15） */
  festival?: string
  /** 节气名；无则 undefined */
  solarTerm?: string
}

/** 纪念日换算结果。三个字段分别对应 PRD E14 / E13 / E25 */
export interface AnniversaryResolution {
  /** null = 超出支持范围，UI 标签位留空 */
  key: DateKey | null
  /** 该年没有这个闰月，已按正月号计（PRD E13） */
  usedFallbackMonth: boolean
  /** 该月没有这一天（三十 → 廿九）或公历 2/29 → 2/28（PRD E25） */
  usedFallbackDay: boolean
}

export interface LunarApi {
  /** 取某天的农历信息；超出支持范围或库抛错时返回 null（PRD E4/E14） */
  lunarOf(k: DateKey): LunarInfo | null
  /**
   * 农历纪念日 → 目标年的公历日期。
   * @param lunarDate 'YYYY-MM-DD'，**只有 MM-DD 有意义**，年份被忽略
   * @param year      要换算到哪一年
   */
  lunarAnniversary(lunarDate: string, year: number, isLeapMonth?: boolean): AnniversaryResolution
  /** lunar-typescript 声明的可用范围 */
  supportedRange(): { from: DateKey; to: DateKey }
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** lunar-typescript 的有效年份范围。库本身不校验，必须我们自己挡（PRD E14） */
export const LUNAR_YEAR_MIN = 1900
export const LUNAR_YEAR_MAX = 2100

/**
 * 支持范围。
 *
 * 做成独立纯函数而不是只挂在 LunarApi 上，是为了**不加载 80 KB 的库也能判断**：
 * UI 在渲染超出范围的月份时可以直接留空标签位，不必等农历加载完。
 */
export function supportedRangeCheck(): { from: DateKey; to: DateKey } {
  return { from: toKey(LUNAR_YEAR_MIN, 1, 1), to: toKey(LUNAR_YEAR_MAX, 12, 31) }
}

/** 年份是否在农历库支持范围内 */
export const inLunarRange = (year: number): boolean =>
  year >= LUNAR_YEAR_MIN && year <= LUNAR_YEAR_MAX

/**
 * 节日白名单（PRD D15）。
 *
 * 用**关键词 includes** 而不是全等，因为库返回的名字带后缀且不稳定：
 * 公历节日是「国庆节」「元旦节」「教师节」，农历节日是「中秋节」「春节」。
 * 全等匹配会因为「元旦」vs「元旦节」这类差异静默失效。
 *
 * 不加白名单的话 `getOtherFestivals()` 会塞进「地藏节」「天灸日」「世界住房日」，
 * 把日历格子占满噪音——实测 2026-09-10 返回「地藏节」、09-11 返回「天灸日」。
 */
export const FESTIVAL_KEYWORDS = [
  '春节', '元宵', '清明', '端午', '中秋', '重阳', '除夕',
  '国庆', '元旦', '劳动节', '儿童节', '教师节', '妇女节', '植树节',
] as const

/** 库的最小结构类型：只声明我们用到的方法，避免把整个库的类型拖进来 */
interface SolarLike {
  getYear(): number
  getMonth(): number
  getDay(): number
  getFestivals(): string[]
  getLunar(): LunarLike
}
interface LunarLike {
  /** 闰月返回负数 */
  getMonth(): number
  getDayInChinese(): string
  getMonthInChinese(): string
  getJieQi(): string
  getFestivals(): string[]
  getSolar(): SolarLike
}
export interface LunarModule {
  Solar: { fromYmd(y: number, m: number, d: number): SolarLike }
  Lunar: { fromYmd(y: number, m: number, d: number): LunarLike }
}

// ---------------------------------------------------------------------------
// 纯函数（不依赖库，可单独测）
// ---------------------------------------------------------------------------

/** 白名单过滤：取第一个命中的节日名，全不命中返回 undefined */
export function pickFestival(names: readonly string[]): string | undefined {
  for (const n of names) {
    if (FESTIVAL_KEYWORDS.some((kw) => n.includes(kw))) return n
  }
  return undefined
}

/**
 * 公历纪念日 → 目标年的公历日期。
 *
 * 这是纯日期运算，**不需要农历库**，所以单独导出而不是挂在 LunarApi 上：
 * 农历加载失败时（PRD E4）公历纪念日仍然要能显示。
 *
 * 唯一的坑是 2/29：平年不能回退到 3/1（那是"迟一天"），按惯例记 2/28。
 */
export function resolveSolarAnniversary(isoDate: string, year: number): AnniversaryResolution {
  const none: AnniversaryResolution = { key: null, usedFallbackMonth: false, usedFallbackDay: false }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return none

  const m = Number(isoDate.slice(5, 7))
  const d = Number(isoDate.slice(8, 10))
  if (m < 1 || m > 12 || d < 1 || d > 31) return none

  if (m === 2 && d === 29 && !isLeapYear(year)) {
    return { key: toKey(year, 2, 28), usedFallbackMonth: false, usedFallbackDay: true }
  }
  return { key: toKey(year, m, d), usedFallbackMonth: false, usedFallbackDay: false }
}

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------

export interface LoadLunarOptions {
  /** 注入动态 import，用于测试模拟加载失败（PRD E4）。不传则用真实的 lunar-typescript */
  loader?: () => Promise<LunarModule>
  /** 额外重试次数，默认 1（即总共尝试 2 次） */
  retries?: number
  /** 重试间隔毫秒，默认 400。设 0 可让测试瞬间跑完 */
  retryDelayMs?: number
  /** 注入 sleep，测试里不用真等 */
  sleep?: (ms: number) => Promise<void>
}

const defaultLoader = async (): Promise<LunarModule> =>
  (await import('lunar-typescript')) as unknown as LunarModule

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function buildApi(mod: LunarModule): LunarApi {
  const inRange = inLunarRange

  return {
    supportedRange: supportedRangeCheck,

    lunarOf(k) {
      const { y, m, d } = fromKey(k)
      // 库对超范围年份不抛错而是给出不可信结果，所以先自己挡（PRD E14）
      if (!inRange(y)) return null
      try {
        const solar = mod.Solar.fromYmd(y, m, d)
        const lun = solar.getLunar()
        const monthNum = lun.getMonth()
        return {
          lunarDay: lun.getDayInChinese(),
          lunarMonth: lun.getMonthInChinese(),
          isLeapMonth: monthNum < 0,
          festival: pickFestival([...solar.getFestivals(), ...lun.getFestivals()]),
          // 非节气日返回空串，统一成 undefined 方便 UI 判空
          solarTerm: lun.getJieQi() || undefined,
        }
      } catch {
        // 库内部数据缺失等意外 → 降级成"只有公历"，绝不白屏（PRD E4）
        return null
      }
    },

    lunarAnniversary(lunarDate, year, isLeapMonth = false) {
      const none: AnniversaryResolution = { key: null, usedFallbackMonth: false, usedFallbackDay: false }
      if (!inRange(year)) return none
      if (!/^\d{4}-\d{2}-\d{2}$/.test(lunarDate)) return none

      const m = Number(lunarDate.slice(5, 7))
      const d = Number(lunarDate.slice(8, 10))
      if (m < 1 || m > 12 || d < 1 || d > 30) return none

      /**
       * 候选按"优先保月份、再保日期"排序，第一个能被库接受的就是答案。
       *
       * 闰月 + 三十 是最坏情况，四个候选：
       *   (闰m, 30) → (闰m, 29) → (m, 30) → (m, 29)
       * 前两个覆盖 PRD E25，后两个覆盖 PRD E13。
       */
      const months = isLeapMonth ? [-m, m] : [m]
      const days = d === 30 ? [30, 29] : [d]
      for (const month of months) {
        for (const day of days) {
          try {
            const s = mod.Lunar.fromYmd(year, month, day).getSolar()
            return {
              key: toKey(s.getYear(), s.getMonth(), s.getDay()),
              // isLeapMonth 为真但最终落在了正月号上 → 说明今年没这个闰月
              usedFallbackMonth: isLeapMonth && month > 0,
              usedFallbackDay: day !== d,
            }
          } catch {
            // 该候选不存在（无此闰月 / 该月只有 29 天），试下一个
          }
        }
      }
      return none
    },
  }
}

let cached: Promise<LunarApi> | null = null

/**
 * 懒加载农历库，失败重试一次，仍失败抛 `LunarUnavailableError`。
 *
 * UI 必须 catch 它并降级成"只显示公历"（PRD E4）——**不能白屏**，
 * 因为日历本身的价值不依赖农历。
 *
 * 传了自定义 `loader` 时不走缓存，否则测试之间会互相污染。
 */
export function loadLunar(opts: LoadLunarOptions = {}): Promise<LunarApi> {
  if (opts.loader) return doLoad(opts)
  return (cached ??= doLoad(opts))
}

/** 仅供测试：清掉模块级缓存 */
export function __resetLunarCache(): void {
  cached = null
}

async function doLoad(opts: LoadLunarOptions): Promise<LunarApi> {
  const loader = opts.loader ?? defaultLoader
  const attempts = 1 + (opts.retries ?? 1)
  const delayMs = opts.retryDelayMs ?? 400
  const sleep = opts.sleep ?? defaultSleep

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return buildApi(await loader())
    } catch (e) {
      lastErr = e
      if (i < attempts - 1 && delayMs > 0) await sleep(delayMs)
    }
  }
  throw new LunarUnavailableError(undefined, lastErr)
}
