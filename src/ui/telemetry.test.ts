/**
 * v8.58/v8.59 埋点测试：首访时间戳的写入与幂等。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ensureFirstVisitMarks } from './telemetry'

describe('ensureFirstVisitMarks（收费资格埋点）', () => {
  beforeEach(() => localStorage.clear())

  it('首访：写入 daycell-first-visit', () => {
    ensureFirstVisitMarks(() => 1_700_000_000_000)
    expect(localStorage.getItem('daycell-first-visit')).toBe('1700000000000')
  })

  it('已存在：时间戳不被覆盖', () => {
    localStorage.setItem('daycell-first-visit', '1000')
    ensureFirstVisitMarks(() => 9_000)
    expect(localStorage.getItem('daycell-first-visit')).toBe('1000')
  })
})
