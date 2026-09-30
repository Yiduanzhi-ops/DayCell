import { describe, it, expect } from 'vitest'
import {
  parseAmount,
  parseQuickExpense,
  parseTodoText,
  parseNoteText,
  parseExpenseNote,
  parseAnniversaryTitle,
  parseCategoryName,
  parseDateKey,
  normalizeNumericInput,
  textLength,
  LIMITS,
} from './validate'

/** 断言成功并取出值 */
function val<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok) throw new Error(`期望成功，实际失败: ${JSON.stringify(r)}`)
  return r.value as T
}
/** 断言失败并取出 code */
function code(r: { ok: boolean; code?: string }): string {
  if (r.ok) throw new Error(`期望失败，实际成功: ${JSON.stringify(r)}`)
  return r.code as string
}

describe('parseAmount — PRD US-03 的 6 种输入', () => {
  it('空 → EMPTY', () => {
    expect(code(parseAmount(''))).toBe('EMPTY')
    expect(code(parseAmount('   '))).toBe('EMPTY')
  })

  it('0 → NOT_POSITIVE', () => {
    expect(code(parseAmount('0'))).toBe('NOT_POSITIVE')
    expect(code(parseAmount('0.00'))).toBe('NOT_POSITIVE')
    expect(code(parseAmount('0.004'))).toBe('NOT_POSITIVE') // 舍入后为 0 分
  })

  it('-5 → NOT_POSITIVE', () => {
    expect(code(parseAmount('-5'))).toBe('NOT_POSITIVE')
    expect(code(parseAmount('-0.5'))).toBe('NOT_POSITIVE')
  })

  it('abc → NOT_A_NUMBER', () => {
    expect(code(parseAmount('abc'))).toBe('NOT_A_NUMBER')
    expect(code(parseAmount('45abc'))).toBe('NOT_A_NUMBER') // 专用金额框比 parseFloat 严格
    expect(code(parseAmount('NaN'))).toBe('NOT_A_NUMBER')
  })

  it('1e3 → 1000 元 = 100000 分（PRD 允许可接受）', () => {
    expect(val(parseAmount('1e3'))).toBe(100000)
  })

  it('28.555 → 2856 分（四舍五入到分，不是截断）', () => {
    expect(val(parseAmount('28.555'))).toBe(2856)
  })
})

describe('parseAmount — 浮点陷阱（ADR-0003 的核心）', () => {
  // 朴素写法 Math.round(Number(s)*100) 在这些用例上会算错
  const traps: Array<[string, number]> = [
    ['1.005', 101], // Number('1.005')*100 === 100.49999999999999 → 朴素写法得 100 ❌
    ['0.005', 1],
    ['2.675', 268],
    ['8.005', 801],
    ['4.115', 412],
  ]
  it.each(traps)('%s → %i 分', (input, expected) => {
    expect(val(parseAmount(input))).toBe(expected)
  })

  it('朴素写法确实会算错（守护这条测试的意义）', () => {
    expect(Math.round(Number('1.005') * 100)).toBe(100) // 错误结果
    expect(val(parseAmount('1.005'))).toBe(101) // 本模块的正确结果
  })

  it('常规金额', () => {
    expect(val(parseAmount('45'))).toBe(4500)
    expect(val(parseAmount('45.5'))).toBe(4550)
    expect(val(parseAmount('45.50'))).toBe(4550)
    expect(val(parseAmount('0.01'))).toBe(1)
    expect(val(parseAmount('268'))).toBe(26800)
    expect(val(parseAmount('2366.20'))).toBe(236620)
  })

  it('进位到整元', () => {
    expect(val(parseAmount('99.999'))).toBe(10000)
    expect(val(parseAmount('1.999'))).toBe(200)
    expect(val(parseAmount('0.999'))).toBe(100)
  })

  it('超过两位小数按第三位舍入', () => {
    expect(val(parseAmount('1.2345'))).toBe(123) // 第三位 4 → 舍
    expect(val(parseAmount('1.2355'))).toBe(124) // 第三位 5 → 入
    expect(val(parseAmount('1.2351'))).toBe(124)
  })
})

describe('parseAmount — 输入宽容度', () => {
  it('首尾空白', () => {
    expect(val(parseAmount('  45  '))).toBe(4500)
  })

  it('千分位逗号（银行流水常见）', () => {
    expect(val(parseAmount('1,280.00'))).toBe(128000)
    expect(val(parseAmount('1,280'))).toBe(128000)
  })

  it('全角数字与全角句号（中文输入法产物）', () => {
    expect(val(parseAmount('４５'))).toBe(4500)
    expect(val(parseAmount('４５。５'))).toBe(4550)
    expect(val(parseAmount('45。5'))).toBe(4550)
    expect(val(parseAmount('1，280'))).toBe(128000)
  })

  it('前导 +', () => {
    expect(val(parseAmount('+45'))).toBe(4500)
  })

  it('前导零', () => {
    expect(val(parseAmount('007'))).toBe(700)
    expect(val(parseAmount('0.5'))).toBe(50)
  })
})

describe('parseAmount — 上限（PRD E7）', () => {
  it('恰好在上限内', () => {
    expect(val(parseAmount('99999999'))).toBe(LIMITS.maxAmountCents)
  })

  it('超出上限 → TOO_LARGE', () => {
    expect(code(parseAmount('100000000'))).toBe('TOO_LARGE')
    expect(code(parseAmount('999999999999'))).toBe('TOO_LARGE')
  })

  it('超长整数不会溢出成安全整数之外', () => {
    expect(code(parseAmount('9'.repeat(30)))).toBe('TOO_LARGE')
  })
})

describe('normalizeNumericInput', () => {
  it('全角 → 半角', () => {
    expect(normalizeNumericInput('０１２３４５６７８９')).toBe('0123456789')
  })
  it('全角句点与中文句号 → 小数点', () => {
    expect(normalizeNumericInput('４５．５')).toBe('45.5')
    expect(normalizeNumericInput('45。5')).toBe('45.5')
  })
  it('去掉逗号', () => {
    expect(normalizeNumericInput('1,280')).toBe('1280')
  })
})

describe('parseQuickExpense — 顶部快速框的一句话解析', () => {
  it('「45 午饭」→ 4500 分 + 午饭', () => {
    expect(val(parseQuickExpense('45 午饭'))).toEqual({ cents: 4500, note: '午饭' })
  })

  it('数字在后也认', () => {
    expect(val(parseQuickExpense('午饭 45'))).toEqual({ cents: 4500, note: '午饭' })
    expect(val(parseQuickExpense('午饭45'))).toEqual({ cents: 4500, note: '午饭' })
  })

  it('只有金额、没有备注', () => {
    expect(val(parseQuickExpense('45'))).toEqual({ cents: 4500, note: '' })
    expect(val(parseQuickExpense('45.5'))).toEqual({ cents: 4550, note: '' })
  })

  it('分隔符会被清掉', () => {
    expect(val(parseQuickExpense('45，午饭')).note).toBe('午饭')
    expect(val(parseQuickExpense('45:午饭')).note).toBe('午饭')
    expect(val(parseQuickExpense('45 - 午饭')).note).toBe('午饭')
  })

  it('空 → EMPTY', () => {
    expect(code(parseQuickExpense(''))).toBe('EMPTY')
    expect(code(parseQuickExpense('   '))).toBe('EMPTY')
  })

  it('没有数字 → NOT_A_NUMBER', () => {
    expect(code(parseQuickExpense('午饭'))).toBe('NOT_A_NUMBER')
  })

  it('取第一个数字串（「买了2个包子共15元」取 2）', () => {
    // 这是已知取舍：一句话解析必然有歧义，所以分区表单提供三字段精确路径
    expect(val(parseQuickExpense('买了2个包子共15元')).cents).toBe(200)
  })

  it('与 parseAmount 共用换算，不会出现两套结果', () => {
    const quick = val(parseQuickExpense('1.005 测试'))
    expect(quick.cents).toBe(val(parseAmount('1.005')))
  })
})

describe('文本校验', () => {
  it('待办：空与纯空白 → EMPTY', () => {
    expect(code(parseTodoText(''))).toBe('EMPTY')
    expect(code(parseTodoText('   \n  '))).toBe('EMPTY')
  })

  it('待办：多行压成单行', () => {
    expect(val(parseTodoText('买牛奶\n买鸡蛋'))).toBe('买牛奶 买鸡蛋')
    expect(val(parseTodoText('  买牛奶  '))).toBe('买牛奶')
  })

  it('待办：CRLF 归一', () => {
    expect(val(parseTodoText('a\r\nb'))).toBe('a b')
  })

  it(`待办：超过 ${LIMITS.todoText} 字 → TOO_LONG，且文案含实际字数（PRD E8 不静默截断）`, () => {
    const at = 'a'.repeat(LIMITS.todoText)
    expect(val(parseTodoText(at))).toHaveLength(LIMITS.todoText)

    const over = 'a'.repeat(LIMITS.todoText + 1)
    const r = parseTodoText(over)
    expect(code(r)).toBe('TOO_LONG')
    expect((r as { message: string }).message).toContain(String(LIMITS.todoText + 1))
  })

  it('想法：保留内部换行（PRD D6）', () => {
    expect(val(parseNoteText('第一行\n第二行'))).toBe('第一行\n第二行')
    expect(val(parseNoteText('  第一行\n第二行  '))).toBe('第一行\n第二行')
  })

  it(`想法：上限 ${LIMITS.noteText} 字`, () => {
    expect(val(parseNoteText('a'.repeat(LIMITS.noteText)))).toHaveLength(LIMITS.noteText)
    expect(code(parseNoteText('a'.repeat(LIMITS.noteText + 1)))).toBe('TOO_LONG')
  })

  it('花费备注：空串是合法值，不是错误', () => {
    expect(val(parseExpenseNote(''))).toBe('')
    expect(val(parseExpenseNote('   '))).toBe('')
    expect(val(parseExpenseNote('  中秋家宴  '))).toBe('中秋家宴')
    expect(val(parseExpenseNote('a\nb'))).toBe('a b')
    expect(code(parseExpenseNote('a'.repeat(LIMITS.expenseNote + 1)))).toBe('TOO_LONG')
  })

  it('纪念日标题与分类名', () => {
    expect(val(parseAnniversaryTitle('  妈妈生日  '))).toBe('妈妈生日')
    expect(code(parseAnniversaryTitle(''))).toBe('EMPTY')
    expect(code(parseAnniversaryTitle('a'.repeat(LIMITS.anniversaryTitle + 1)))).toBe('TOO_LONG')

    expect(val(parseCategoryName('餐饮'))).toBe('餐饮')
    expect(code(parseCategoryName('a'.repeat(LIMITS.categoryName + 1)))).toBe('TOO_LONG')
  })

  it('错误文案都是可直接展示的中文（UI 不得自行拼接）', () => {
    for (const r of [parseAmount(''), parseAmount('abc'), parseTodoText(''), parseDateKey('x')]) {
      expect(r.ok).toBe(false)
      const m = (r as { message: string }).message
      expect(m.length).toBeGreaterThan(2)
      expect(/[a-zA-Z_]{4,}/.test(m), m).toBe(false) // 不含代码味的标识符
    }
  })

  it('textLength 用于输入框实时计数', () => {
    expect(textLength('  abc  ')).toBe(3)
    expect(textLength('a\r\nb')).toBe(3) // CRLF 归一后算 1 个换行
  })
})

describe('parseDateKey', () => {
  it('接受合法日期', () => {
    expect(val(parseDateKey('2026-09-29'))).toBe('2026-09-29')
    expect(val(parseDateKey('  2026-09-29  '))).toBe('2026-09-29')
  })

  it('拒绝非法与假日期', () => {
    expect(code(parseDateKey(''))).toBe('BAD_DATE')
    expect(code(parseDateKey('2026-02-30'))).toBe('BAD_DATE')
    expect(code(parseDateKey('2026-9-29'))).toBe('BAD_DATE')
    expect(code(parseDateKey('not-a-date'))).toBe('BAD_DATE')
  })
})
