/**
 * 纯校验函数（CORE-API §2.1）。
 *
 * 约定：**返回 ParseResult，不抛异常**——这些函数每次按键都可能被调用，
 * 失败是预期路径而非异常路径。
 *
 * `message` 是可以直接展示给用户的中文文案，UI 不得自行拼接错误提示。
 */

import type { DateKey } from './types'
import { isValidKey } from './date'

export type ValidateCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'NOT_A_NUMBER'
  | 'NOT_POSITIVE'
  | 'TOO_LARGE'
  | 'BAD_DATE'
  | 'BAD_BACKUP'
  | 'VERSION_TOO_NEW'

export interface ParseOk<T> {
  ok: true
  value: T
}
export interface ParseErr {
  ok: false
  code: ValidateCode
  message: string
}
export type ParseResult<T> = ParseOk<T> | ParseErr

export const ok = <T>(value: T): ParseOk<T> => ({ ok: true, value })
export const err = (code: ValidateCode, message: string): ParseErr => ({ ok: false, code, message })

/** 长度上限（PRD E8） */
export const LIMITS = {
  todoText: 500,
  noteText: 5000,
  expenseNote: 200,
  anniversaryTitle: 50,
  categoryName: 12,
  /** 99,999,999 元 = 9,999,999,900 分（PRD E7） */
  maxAmountCents: 9_999_999_900,
} as const

// ---------------------------------------------------------------------------
// 金额（ADR-0003）
// ---------------------------------------------------------------------------

/** 标准十进制：可选符号 + 整数 + 可选小数 */
const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/

/**
 * 把全角数字/标点归一成半角，并去掉千分位逗号。
 *
 * 中文输入法很容易打出「４５」或用「。」当小数点，
 * 直接判 NOT_A_NUMBER 对用户是无谓的挫折。
 */
export function normalizeNumericInput(raw: string): string {
  return raw
    .replace(/[\uFF10-\uFF19]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // ０-９
    .replace(/[\uFF0E\u3002]/g, '.') // ． 。 → .
    .replace(/[\uFF0C\u002C]/g, '') // ， , → 去掉（千分位）
}

/**
 * 元 → **整数分**。
 *
 * ⚠️ 不能用 `Math.round(Number(s) * 100)`：
 *    `1.005 * 100 === 100.49999999999999` → 会得到 100 而非 101。
 * 所以对标准十进制走**字符串运算**，逐位精确。
 */
export function parseAmount(raw: string): ParseResult<number> {
  const t = normalizeNumericInput(raw).trim()
  if (!t) return err('EMPTY', '请填写金额')

  const m = DECIMAL_RE.exec(t)
  let cents: number

  if (m) {
    const [, sign, intPart, frac = ''] = m
    if (sign === '-') return err('NOT_POSITIVE', '金额必须大于 0')

    const intVal = Number(intPart)
    if (!Number.isSafeInteger(intVal)) return err('TOO_LARGE', '金额过大')

    // 小数前两位直接构成分；第三位及以后决定舍入（round half up）
    const twoDigits = (frac + '00').slice(0, 2)
    cents = intVal * 100 + Number(twoDigits)
    const third = frac.charCodeAt(2)
    if (third >= 0x35 /* '5' */ && third <= 0x39 /* '9' */) cents += 1
  } else {
    // 科学计数法（'1e3'）等形态：PRD US-03 允许
    const n = Number(t)
    if (!Number.isFinite(n)) return err('NOT_A_NUMBER', '金额必须是数字')
    if (n < 0) return err('NOT_POSITIVE', '金额必须大于 0')
    cents = Math.round(n * 100)
  }

  if (!(cents > 0)) return err('NOT_POSITIVE', '金额必须大于 0')
  if (!Number.isSafeInteger(cents) || cents > LIMITS.maxAmountCents) {
    return err('TOO_LARGE', '金额过大（上限 99,999,999 元）')
  }
  return ok(cents)
}

/**
 * 从一句话里提取金额与备注（`45 午饭` → {cents:4500, note:'午饭'}）。
 *
 * 与 parseAmount 共用同一套换算，**不得另写一份**（ADR-0003）。
 * 取第一个能解析成金额的数字串；找不到则整体交给 parseAmount 报错。
 *
 * ⚠️ **v6.1 起本函数没有任何调用方**：它唯一的消费者是原型顶部的常驻快捷录入框，
 *    该行已整行移除（PRD D18 / SPEC §3.3）。留着是因为删除已测代码需要产品负责人点头，
 *    去留见 PRD §11 **Q7**（建议删——留着会诱导第二条花费录入路径重新长回来，那正是 Q2 的病灶）。
 *    在 Q7 有结论前**不要删、也不要给它接新调用方**。
 */
export function parseQuickExpense(raw: string): ParseResult<{ cents: number; note: string }> {
  const t = normalizeNumericInput(raw).trim()
  if (!t) return err('EMPTY', '请填写内容，例如「45 午饭」')

  const m = /(\d+(?:\.\d+)?)/.exec(t)
  // 没有任何数字串 → 一定是错的，不必再走 parseAmount
  if (!m) return err('NOT_A_NUMBER', '没找到金额，例如「45 午饭」')

  const amount = parseAmount(m[1]!)
  if (!amount.ok) return amount

  const note = (t.slice(0, m.index) + t.slice(m.index + m[1]!.length))
    .replace(/^[\s:：,，、-]+|[\s:：,，、-]+$/g, '')
    .trim()
  return ok({ cents: amount.value, note })
}

// ---------------------------------------------------------------------------
// 文本
// ---------------------------------------------------------------------------

interface TextOpts {
  /** 用于错误文案，如「待办」「想法」 */
  field: string
  max: number
  /** 是否保留内部换行（想法=true，待办=false） */
  multiline?: boolean
}

function parseText(raw: string, o: TextOpts): ParseResult<string> {
  let t = raw.replace(/\r\n?/g, '\n').trim()
  if (!o.multiline) t = t.replace(/\s*\n\s*/g, ' ') // 单行：换行压成空格
  if (!t) return err('EMPTY', `请填写${o.field}`)
  if (t.length > o.max) {
    return err('TOO_LONG', `${o.field}最多 ${o.max} 字，当前 ${t.length} 字`)
  }
  return ok(t)
}

export const parseTodoText = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '待办', max: LIMITS.todoText })

export const parseNoteText = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '想法', max: LIMITS.noteText, multiline: true })

/** 花费备注**可以为空**——空串是合法值，不是错误 */
export function parseExpenseNote(raw: string): ParseResult<string> {
  const t = raw.replace(/\r\n?/g, '\n').replace(/\s*\n\s*/g, ' ').trim()
  if (t.length > LIMITS.expenseNote) {
    return err('TOO_LONG', `备注最多 ${LIMITS.expenseNote} 字，当前 ${t.length} 字`)
  }
  return ok(t)
}

export const parseAnniversaryTitle = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '纪念日名称', max: LIMITS.anniversaryTitle })

export const parseCategoryName = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '分类名称', max: LIMITS.categoryName })

// ---------------------------------------------------------------------------
// 日期
// ---------------------------------------------------------------------------

export function parseDateKey(raw: string): ParseResult<DateKey> {
  const t = raw.trim()
  if (!t) return err('BAD_DATE', '请选择日期')
  if (!isValidKey(t)) return err('BAD_DATE', '日期格式不正确')
  return ok(t)
}

/** 供输入框实时计数使用（PRD E8：阻止超出，不静默截断） */
export function textLength(raw: string): number {
  return raw.replace(/\r\n?/g, '\n').trim().length
}
