/**
 * 金额格式化测试。
 *
 * 除了逐档取值，还有一条**不变量**：`formatMoney` 必须能精确往返。
 * 这条比任何单点断言都值钱——它守的是"中间不出现浮点元"这件事本身，
 * 而不是我记住的那几个例子。
 */
import { describe, it, expect } from 'vitest'
import { formatMoney, formatMoneyCsv, formatMoneyShort } from './money'

describe('formatMoney — 精确两位小数', () => {
  it('基本档位', () => {
    expect(formatMoney(0)).toBe('0.00')
    expect(formatMoney(1)).toBe('0.01')
    expect(formatMoney(5)).toBe('0.05')
    expect(formatMoney(100)).toBe('1.00')
    expect(formatMoney(2850)).toBe('28.50')
    expect(formatMoney(50000)).toBe('500.00')
  })

  it('个位分要补零，不能变成 "28.5"', () => {
    expect(formatMoney(2805)).toBe('28.05')
    expect(formatMoney(109)).toBe('1.09')
  })

  it('上限 99,999,999 元（LIMITS.maxAmountCents）不丢精度', () => {
    expect(formatMoney(9_999_999_900)).toBe('99999999.00')
  })

  it('负数（v1 的差额场景）符号在前，不出现 "-0.00"', () => {
    expect(formatMoney(-1)).toBe('-0.01')
    expect(formatMoney(-2850)).toBe('-28.50')
    expect(formatMoney(0)).toBe('0.00')
  })

  it('非有限值降级为 0，不输出 "NaN" 到界面上', () => {
    expect(formatMoney(Number.NaN)).toBe('0.00')
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe('0.00')
  })

  it('小数分被截断（调用方给错单位时不炸，但也不四舍五入出鬼数字）', () => {
    expect(formatMoney(2850.7)).toBe('28.50')
  })

  it('★ 不变量：0…200000 分全部能精确往返', () => {
    for (let c = 0; c <= 200_000; c++) {
      const back = Math.round(Number(formatMoney(c)) * 100)
      if (back !== c) throw new Error(`往返失败：${c} → "${formatMoney(c)}" → ${back}`)
    }
  })

  it('★ 不变量：边界与大额同样往返', () => {
    const edges = [
      0, 1, 99, 100, 101, 999, 1000, 9_999_999, 10_000_000, 99_999_999,
      100_000_000, 999_999_999, 1_000_000_000, 9_999_999_900,
    ]
    for (const c of edges) {
      expect(Math.round(Number(formatMoney(c)) * 100)).toBe(c)
    }
  })
})

describe('formatMoneyCsv — 导出格式', () => {
  it('与 formatMoney 同值，且不带符号与千分位', () => {
    expect(formatMoneyCsv(2850)).toBe('28.50')
    expect(formatMoneyCsv(9_999_999_900)).toBe('99999999.00')
    expect(formatMoneyCsv(123456)).toBe('1234.56')
    expect(formatMoneyCsv(123456)).not.toContain(',')
    expect(formatMoneyCsv(123456)).not.toContain('¥')
  })
})

describe('formatMoneyShort — 月格紧凑格式（PRD §3.4）', () => {
  it('< 100 元：一位小数，尾零去掉', () => {
    expect(formatMoneyShort(2850)).toBe('28.5')
    expect(formatMoneyShort(2800)).toBe('28')
    expect(formatMoneyShort(50)).toBe('0.5')
    expect(formatMoneyShort(999)).toBe('10') // 9.99 元 → 一位小数 round half up
  })

  it('一位小数进位到 10 时并进元，不出现 "28.10"', () => {
    expect(formatMoneyShort(9999)).toBe('100') // 99.99 元
    expect(formatMoneyShort(2950)).toBe('29.5')
  })

  it('≥ 100 元：取整元', () => {
    expect(formatMoneyShort(10000)).toBe('100')
    expect(formatMoneyShort(12345)).toBe('123') // 123.45 → 123
    expect(formatMoneyShort(12350)).toBe('124') // 123.50 → 124（round half up）
    expect(formatMoneyShort(50000)).toBe('500')
    expect(formatMoneyShort(999999)).toBe('10000') // 9999.99 元
  })

  it('≥ 1 万元：x.x万，整万时不带 .0', () => {
    expect(formatMoneyShort(1_000_000)).toBe('1万')
    expect(formatMoneyShort(1_230_000)).toBe('1.2万')
    expect(formatMoneyShort(12_345_678)).toBe('12.3万')
    expect(formatMoneyShort(99_950_000)).toBe('100万') // 999.5 元×100 = 999.5 → 进位
  })

  it('≥ 100 万元：整万（否则 "1234.5万" 在格子里放不下）', () => {
    expect(formatMoneyShort(100_000_000)).toBe('100万')
    expect(formatMoneyShort(1_234_567_890)).toBe('1235万')
    expect(formatMoneyShort(9_999_999_900)).toBe('10000万')
  })

  it('0 返回 "0" 而不是空串——**要不要显示是视图的决定**', () => {
    expect(formatMoneyShort(0)).toBe('0')
  })

  it('负数保留符号', () => {
    expect(formatMoneyShort(-2850)).toBe('-28.5')
    expect(formatMoneyShort(-1_000_000)).toBe('-1万')
  })

  it('★ 不变量：紧凑格式与精确值的相对误差 ≤ 5%（月格是概览，但不能离谱）', () => {
    /** 把紧凑格式还原回「分」，好和真值比 */
    const expand = (s: string): number => {
      const n = Number(s.replace('万', ''))
      return s.endsWith('万') ? n * 1_000_000 : n * 100
    }
    for (const c of [2850, 9999, 50000, 999999, 5_000_000, 12_345_678, 9_999_999_900]) {
      const s = formatMoneyShort(c)
      const rel = Math.abs(expand(s) - c) / c
      if (rel > 0.05) throw new Error(`${c} → "${s}" 相对误差 ${(rel * 100).toFixed(2)}% 超过 5%`)
    }
  })
})
