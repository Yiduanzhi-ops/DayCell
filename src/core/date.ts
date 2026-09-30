/**
 * 纯日期运算。零依赖。
 *
 * ⚠️ 这是全项目**唯一**允许直接接触 `Date` 的两个模块之一（另一个是 core/id.ts）。
 * 其他模块一律用 DateKey 字符串，见 ADR-0008。
 *
 * 核心陷阱（ADR-0008）：
 *   new Date('2026-09-29')  → 按 ISO 解析为 **UTC 零点**，在 UTC-5 时区会变成前一天
 *   new Date(2026, 8, 29)   → 本地时区零点，正确
 * 本模块内部只用后者。
 */

import type { DateKey, MonthKey } from './types'

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_RE = /^(\d{4})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/** 周起始日。1 = 周一（PRD D1，默认），0 = 周日 */
export type WeekStartsOn = 0 | 1

const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

/**
 * 由年月日构造 DateKey。m 是 1–12（不是 Date 的 0–11）。
 * 溢出自动进位：toKey(2026, 13, 1) === '2027-01-01'。
 */
export function toKey(y: number, m: number, d: number): DateKey {
  const dt = new Date(y, m - 1, d) // 本地时区构造 ✅
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` as DateKey
}

/**
 * 拆解 DateKey。**返回数字而不返回 Date**——
 * 这样调用方拿不到 Date 对象，就没机会把时区陷阱带回来（ADR-0008）。
 */
export function fromKey(k: DateKey): { y: number; m: number; d: number } {
  return { y: Number(k.slice(0, 4)), m: Number(k.slice(5, 7)), d: Number(k.slice(8, 10)) }
}

/** 当前日期。`now` 参数是 ADR-0006 铁律 3 的注入点，测试必须传。 */
export function today(now: Date = new Date()): DateKey {
  return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/** 严格校验：格式对 + 是真实存在的日期（拒绝 2026-02-30） */
export function isValidKey(s: string): s is DateKey {
  const m = KEY_RE.exec(s)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  const dt = new Date(y, mo - 1, d)
  // 溢出进位后年月日会对不上，借此识别 2/30、4/31 这类假日期
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

export function isValidMonth(s: string): s is MonthKey {
  const m = MONTH_RE.exec(s)
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(k: DateKey): MonthKey {
  return k.slice(0, 7) as MonthKey
}

export function addDays(k: DateKey, n: number): DateKey {
  const { y, m, d } = fromKey(k)
  const dt = new Date(y, m - 1, d + n) // 溢出自动进位，本地时区
  return toKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/**
 * 加 n 个月，**日期夹取**而非溢出：
 *   addMonths('2026-01-31', 1) === '2026-02-28'
 *   addMonths('2028-01-31', 1) === '2028-02-29'   （闰年）
 */
export function addMonths(k: DateKey, n: number): DateKey {
  const { y, m, d } = fromKey(k)
  const first = new Date(y, m - 1 + n, 1)
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return toKey(first.getFullYear(), first.getMonth() + 1, Math.min(d, lastDay))
}

/**
 * b - a，单位天，可为负。
 *
 * 用 Date.UTC 构造再相减：纯日历算术，**不受 DST 影响**。
 * 若用本地时区构造，跨夏令时的两个日期会差出 23/25 小时，取整后偶发偏差一天。
 */
export function daysBetween(a: DateKey, b: DateKey): number {
  const utc = (k: DateKey): number => {
    const { y, m, d } = fromKey(k)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY)
}

/** 字典序比较。'YYYY-MM-DD' 定宽零填充，字典序 === 时间序 */
export function compareKey(a: DateKey, b: DateKey): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 0=周日 … 6=周六（与 Date.getDay() 一致） */
export function dowOf(k: DateKey): 0 | 1 | 2 | 3 | 4 | 5 | 6 {
  const { y, m, d } = fromKey(k)
  return new Date(y, m - 1, d).getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6
}

export function startOfWeek(k: DateKey, weekStartsOn: WeekStartsOn = 1): DateKey {
  const diff = (dowOf(k) - weekStartsOn + 7) % 7
  return diff === 0 ? k : addDays(k, -diff)
}

/** 恒返回 7 个 */
export function weekKeys(k: DateKey, weekStartsOn: WeekStartsOn = 1): DateKey[] {
  const s = startOfWeek(k, weekStartsOn)
  return Array.from({ length: 7 }, (_, i) => addDays(s, i))
}

/** 仅本月的实际天数（28–31 个） */
export function monthKeys(k: DateKey): DateKey[] {
  const { y, m } = fromKey(k)
  const count = new Date(y, m, 0).getDate()
  return Array.from({ length: count }, (_, i) => toKey(y, m, i + 1))
}

/**
 * 月视图网格，**恒返回 42 个**（6 行 × 7 列）。
 *
 * 不做"按需 5 或 6 行"——那会让网格高度在月份间跳动（PRD D2）。
 */
export function monthGrid(k: DateKey, weekStartsOn: WeekStartsOn = 1): DateKey[] {
  const { y, m } = fromKey(k)
  const first = toKey(y, m, 1)
  const origin = startOfWeek(first, weekStartsOn)
  return Array.from({ length: 42 }, (_, i) => addDays(origin, i))
}

export function isSameMonth(a: DateKey, b: DateKey): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

export function isSameDay(a: DateKey, b: DateKey): boolean {
  return a === b
}

/** 该月天数 */
export function daysInMonth(k: DateKey): number {
  const { y, m } = fromKey(k)
  return new Date(y, m, 0).getDate()
}

/** 是否闰年 */
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

/** 闭区间内所有日期，含两端。from > to 时返回空数组 */
export function rangeKeys(from: DateKey, to: DateKey): DateKey[] {
  const n = daysBetween(from, to)
  if (n < 0) return []
  return Array.from({ length: n + 1 }, (_, i) => addDays(from, i))
}
