/**
 * 纯校验函数（CORE-API §2.1）。
 *
 * 约定：**返回 ParseResult，不抛异常**——这些函数每次按键都可能被调用，
 * 失败是预期路径而非异常路径。
 *
 * `message` 是可以直接展示给用户的中文文案，UI 不得自行拼接错误提示。
 */

import type { DateKey, HabitFreq } from './types'
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
  | 'BAD_VALUE'

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
  goalTitle: 50,
  goalNote: 5000,
  stageTitle: 50,
  stageNote: 1000,
  subtaskTitle: 50,
  habitName: 30,
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
// 目标与阶段（v7.9）
// ---------------------------------------------------------------------------

export const parseGoalTitle = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '目标名称', max: LIMITS.goalTitle })

export const parseStageTitle = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '阶段名称', max: LIMITS.stageTitle })

export const parseSubtaskTitle = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '子任务', max: LIMITS.subtaskTitle })

/** 目标阐述/阶段备注**可以为空**——空串是合法值 */
export function parseGoalNote(raw: string): ParseResult<string> {
  const t = raw.replace(/\r\n?/g, '\n').trim()
  if (t.length > LIMITS.goalNote) {
    return err('TOO_LONG', `目标阐述最多 ${LIMITS.goalNote} 字，当前 ${t.length} 字`)
  }
  return ok(t)
}

export function parseStageNote(raw: string): ParseResult<string> {
  const t = raw.replace(/\r\n?/g, '\n').trim()
  if (t.length > LIMITS.stageNote) {
    return err('TOO_LONG', `备注最多 ${LIMITS.stageNote} 字，当前 ${t.length} 字`)
  }
  return ok(t)
}

/** 进度百分比：0–100 的整数。空串 → undefined（阶段可不填百分比） */
export function parsePct(raw: string | undefined | null): ParseResult<number | undefined> {
  if (raw === undefined || raw === null) return ok(undefined)
  const t = normalizeNumericInput(raw).trim()
  if (!t) return ok(undefined)
  const n = Number(t)
  if (!Number.isFinite(n)) return err('NOT_A_NUMBER', '进度必须是数字')
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    return err('BAD_VALUE', '进度必须是 0–100 的整数')
  }
  return ok(n)
}

// ---------------------------------------------------------------------------
// 习惯（v8.0）
// ---------------------------------------------------------------------------

export const parseHabitName = (raw: string): ParseResult<string> =>
  parseText(raw, { field: '习惯名称', max: LIMITS.habitName })

/**
 * 习惯频率校验：`{ kind:'daily' }` 或 `{ kind:'weekly', weekdays:[0-6] }`。
 * weekly 必须选 1–7 天、每项是 0–6 的整数、去重（0 = 周日，与 dowOf 一致）。
 */
export function parseHabitFreq(raw: unknown): ParseResult<HabitFreq> {
  if (!raw || typeof raw !== 'object') return err('BAD_VALUE', '习惯频率不正确')
  const f = raw as { kind?: unknown; weekdays?: unknown }
  if (f.kind === 'daily') return ok({ kind: 'daily' })
  if (f.kind === 'weekly') {
    if (!Array.isArray(f.weekdays) || f.weekdays.length < 1 || f.weekdays.length > 7) {
      return err('BAD_VALUE', '每周至少选一天')
    }
    const days = f.weekdays.map((d) => Number(d))
    if (!days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) {
      return err('BAD_VALUE', '星期几必须是 0–6')
    }
    return ok({ kind: 'weekly', weekdays: [...new Set(days)].sort() })
  }
  return err('BAD_VALUE', '习惯频率不正确')
}

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
