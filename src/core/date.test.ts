import { describe, it, expect } from 'vitest'
import type { DateKey } from './types'
import {
  toKey,
  fromKey,
  today,
  isValidKey,
  isValidMonth,
  monthOf,
  addDays,
  addMonths,
  daysBetween,
  compareKey,
  dowOf,
  startOfWeek,
  weekKeys,
  monthKeys,
  monthGrid,
  isSameMonth,
  isSameDay,
  daysInMonth,
  isLeapYear,
  rangeKeys,
} from './date'

/** 测试里把字面量提升为 DateKey；生产代码只能经 toKey / isValidKey */
const k = (s: string): DateKey => s as DateKey

describe('toKey / fromKey', () => {
  it('往返一致', () => {
    const key = toKey(2026, 9, 29)
    expect(key).toBe('2026-09-29')
    expect(fromKey(key)).toEqual({ y: 2026, m: 9, d: 29 })
  })

  it('月日补零', () => {
    expect(toKey(2026, 1, 5)).toBe('2026-01-05')
  })

  it('溢出自动进位', () => {
    expect(toKey(2026, 13, 1)).toBe('2027-01-01')
    expect(toKey(2026, 9, 31)).toBe('2026-10-01')
    expect(toKey(2026, 9, 0)).toBe('2026-08-31')
  })

  it('不返回 Date 对象，避免调用方把时区陷阱带回来（ADR-0008）', () => {
    const r: unknown = fromKey(k('2026-09-29'))
    expect(r).not.toBeInstanceOf(Date)
    expect(typeof r).toBe('object')
  })
})

describe('isValidKey', () => {
  it('接受合法日期', () => {
    for (const s of ['2026-09-29', '2026-01-01', '2028-02-29', '1999-12-31']) {
      expect(isValidKey(s), s).toBe(true)
    }
  })

  it('拒绝不存在的日期', () => {
    // 溢出进位后年月日对不上，借此识别假日期
    for (const s of ['2026-02-30', '2026-04-31', '2026-06-31', '2027-02-29']) {
      expect(isValidKey(s), s).toBe(false)
    }
  })

  it('拒绝格式错误', () => {
    for (const s of ['', '2026-9-29', '2026/09/29', '26-09-29', '2026-09', '2026-09-29T00:00', 'abc', '2026-13-01', '2026-00-10']) {
      expect(isValidKey(s), s).toBe(false)
    }
  })
})

describe('today（注入时钟，ADR-0006 铁律 3）', () => {
  it('按注入的 Date 取本地日期', () => {
    expect(today(new Date(2026, 8, 29, 23, 59, 59))).toBe('2026-09-29')
    expect(today(new Date(2026, 8, 29, 0, 0, 0))).toBe('2026-09-29')
  })

  it('午夜边界不偏移', () => {
    // 若实现误用 new Date(isoString) 解析，UTC-x 时区下这里会差一天
    expect(today(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01')
  })
})

describe('addDays', () => {
  it('同月内', () => {
    expect(addDays(k('2026-09-29'), 1)).toBe('2026-09-30')
    expect(addDays(k('2026-09-29'), -1)).toBe('2026-09-28')
    expect(addDays(k('2026-09-29'), 0)).toBe('2026-09-29')
  })

  it('跨月', () => {
    expect(addDays(k('2026-09-30'), 1)).toBe('2026-10-01')
    expect(addDays(k('2026-10-01'), -1)).toBe('2026-09-30')
  })

  it('跨年（PRD E12）', () => {
    expect(addDays(k('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(k('2027-01-01'), -1)).toBe('2026-12-31')
  })

  it('跨闰日', () => {
    expect(addDays(k('2028-02-28'), 1)).toBe('2028-02-29')
    expect(addDays(k('2028-02-29'), 1)).toBe('2028-03-01')
    expect(addDays(k('2026-02-28'), 1)).toBe('2026-03-01') // 平年无 2/29
  })

  it('大跨度', () => {
    expect(addDays(k('2026-09-29'), 365)).toBe('2027-09-29')
    expect(addDays(k('2026-09-29'), -365)).toBe('2025-09-29')
  })
})

describe('addMonths（夹取而非溢出）', () => {
  it('1/31 + 1月 → 2/28', () => {
    expect(addMonths(k('2026-01-31'), 1)).toBe('2026-02-28')
  })

  it('闰年 1/31 + 1月 → 2/29', () => {
    expect(addMonths(k('2028-01-31'), 1)).toBe('2028-02-29')
  })

  it('3/31 - 1月 → 2/28', () => {
    expect(addMonths(k('2026-03-31'), -1)).toBe('2026-02-28')
  })

  it('不夹取时正常前进', () => {
    expect(addMonths(k('2026-09-15'), 1)).toBe('2026-10-15')
    expect(addMonths(k('2026-09-15'), -1)).toBe('2026-08-15')
    expect(addMonths(k('2026-09-15'), 0)).toBe('2026-09-15')
  })

  it('跨年', () => {
    expect(addMonths(k('2026-12-15'), 1)).toBe('2027-01-15')
    expect(addMonths(k('2027-01-15'), -1)).toBe('2026-12-15')
    expect(addMonths(k('2026-09-29'), 12)).toBe('2027-09-29')
  })

  it('5/31 + 3月 → 8/31（中间月份短不影响结果）', () => {
    expect(addMonths(k('2026-05-31'), 3)).toBe('2026-08-31')
  })
})

describe('daysBetween', () => {
  it('同日为 0', () => {
    expect(daysBetween(k('2026-09-29'), k('2026-09-29'))).toBe(0)
  })

  it('正向为正、反向为负', () => {
    expect(daysBetween(k('2026-09-28'), k('2026-09-29'))).toBe(1)
    expect(daysBetween(k('2026-09-29'), k('2026-09-28'))).toBe(-1)
  })

  it('跨月跨年', () => {
    expect(daysBetween(k('2026-09-29'), k('2026-10-01'))).toBe(2)
    expect(daysBetween(k('2026-12-31'), k('2027-01-01'))).toBe(1)
    expect(daysBetween(k('2026-01-01'), k('2026-12-31'))).toBe(364)
  })

  it('跨夏令时仍是整天数（用 Date.UTC 做纯日历算术）', () => {
    // 2026-03-08 是美国夏令时开始日；在 America/New_York 下这天只有 23 小时
    expect(daysBetween(k('2026-03-07'), k('2026-03-10'))).toBe(3)
    expect(daysBetween(k('2026-11-01'), k('2026-11-02'))).toBe(1) // 美国夏令时结束
    expect(daysBetween(k('2026-03-08'), k('2026-09-29'))).toBe(205)
  })
})

describe('compareKey（字典序 === 时间序）', () => {
  it('三种结果', () => {
    expect(compareKey(k('2026-09-28'), k('2026-09-29'))).toBe(-1)
    expect(compareKey(k('2026-09-29'), k('2026-09-29'))).toBe(0)
    expect(compareKey(k('2026-09-30'), k('2026-09-29'))).toBe(1)
  })

  it('与 daysBetween 的符号一致', () => {
    const a = k('2025-12-31')
    const b = k('2026-01-01')
    // daysBetween(a,b) = b-a，与 compareKey(a,b) 天然反号，故与 compareKey(b,a) 同号
    expect(Math.sign(daysBetween(a, b))).toBe(compareKey(b, a))
    expect(Math.sign(daysBetween(b, a))).toBe(compareKey(a, b))
  })
})

describe('dowOf / startOfWeek / weekKeys', () => {
  it('2026-09-29 是周二', () => {
    expect(dowOf(k('2026-09-29'))).toBe(2)
  })

  it('周一为一周之始（PRD D1）', () => {
    expect(startOfWeek(k('2026-09-29'))).toBe('2026-09-28') // 周二 → 前一个周一
    expect(dowOf(startOfWeek(k('2026-09-29')))).toBe(1)
  })

  it('本身就是周一时不动', () => {
    expect(startOfWeek(k('2026-09-28'))).toBe('2026-09-28')
  })

  it('周日归属于上一周（周一起始）', () => {
    expect(startOfWeek(k('2026-10-04'))).toBe('2026-09-28')
  })

  it('可切成周日起始', () => {
    expect(startOfWeek(k('2026-09-29'), 0)).toBe('2026-09-27')
  })

  it('weekKeys 恒 7 个且从周一开始', () => {
    const w = weekKeys(k('2026-09-29'))
    expect(w).toHaveLength(7)
    expect(w[0]).toBe('2026-09-28')
    expect(w[6]).toBe('2026-10-04')
    expect(w.every((x) => isValidKey(x))).toBe(true)
  })

  it('跨月的周', () => {
    const w = weekKeys(k('2026-09-30'))
    expect(w).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
  })
})

describe('monthKeys / monthGrid', () => {
  it('monthKeys 返回实际天数', () => {
    expect(monthKeys(k('2026-09-01'))).toHaveLength(30)
    expect(monthKeys(k('2026-02-01'))).toHaveLength(28)
    expect(monthKeys(k('2028-02-01'))).toHaveLength(29) // 闰年
    expect(monthKeys(k('2026-12-01'))).toHaveLength(31)
    expect(monthKeys(k('2026-09-01'))[0]).toBe('2026-09-01')
    expect(monthKeys(k('2026-09-01'))[29]).toBe('2026-09-30')
  })

  it('monthGrid 恒 42 个（PRD D2：6 行月份完整显示，不裁成 5 行）', () => {
    for (const m of ['2026-08-01', '2026-09-01', '2026-02-01', '2028-02-01', '2026-12-01']) {
      expect(monthGrid(k(m)), m).toHaveLength(42)
    }
  })

  it('monthGrid 首格是周一、末格是周日', () => {
    const g = monthGrid(k('2026-09-15'))
    expect(dowOf(g[0]!)).toBe(1)
    expect(dowOf(g[41]!)).toBe(0)
  })

  it('2026-09 的网格覆盖 08-31 ~ 10-11', () => {
    // 2026-09-01 是周二 → 网格从周一 08-31 开始
    const g = monthGrid(k('2026-09-15'))
    expect(g[0]).toBe('2026-08-31')
    expect(g[41]).toBe('2026-10-11')
    expect(g.filter((x) => isSameMonth(x, k('2026-09-15')))).toHaveLength(30)
  })

  it('网格无重复、无空洞、连续', () => {
    const g = monthGrid(k('2026-09-15'))
    expect(new Set(g).size).toBe(42)
    for (let i = 1; i < g.length; i++) {
      expect(daysBetween(g[i - 1]!, g[i]!), `${g[i - 1]} → ${g[i]}`).toBe(1)
    }
  })

  it('daysInMonth / isLeapYear', () => {
    expect(daysInMonth(k('2026-02-01'))).toBe(28)
    expect(daysInMonth(k('2028-02-01'))).toBe(29)
    expect(isLeapYear(2028)).toBe(true)
    expect(isLeapYear(2026)).toBe(false)
    expect(isLeapYear(2000)).toBe(true) // 400 年规则
    expect(isLeapYear(1900)).toBe(false) // 100 年规则
  })
})

describe('其他', () => {
  it('monthOf', () => {
    expect(monthOf(k('2026-09-29'))).toBe('2026-09')
  })

  it('isValidMonth', () => {
    expect(isValidMonth('2026-09')).toBe(true)
    expect(isValidMonth('2026-13')).toBe(false)
    expect(isValidMonth('2026-9')).toBe(false)
    expect(isValidMonth('2026-09-29')).toBe(false)
  })

  it('isSameMonth / isSameDay', () => {
    expect(isSameMonth(k('2026-09-01'), k('2026-09-30'))).toBe(true)
    expect(isSameMonth(k('2026-09-30'), k('2026-10-01'))).toBe(false)
    expect(isSameDay(k('2026-09-29'), k('2026-09-29'))).toBe(true)
    expect(isSameDay(k('2026-09-29'), k('2026-09-30'))).toBe(false)
  })

  it('rangeKeys 闭区间', () => {
    expect(rangeKeys(k('2026-09-28'), k('2026-10-01'))).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01',
    ])
    expect(rangeKeys(k('2026-09-29'), k('2026-09-29'))).toEqual(['2026-09-29'])
  })

  it('rangeKeys 反向返回空数组而非抛错', () => {
    expect(rangeKeys(k('2026-10-01'), k('2026-09-28'))).toEqual([])
  })
})
