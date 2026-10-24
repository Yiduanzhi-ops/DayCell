/**
 * v8.58 埋点测试：首访/试用时间戳的写入与幂等。
 */
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { ensureFirstVisitMarks } from './telemetry'

describe('ensureFirstVisitMarks（v8.58 收费资格埋点）', () => {
  beforeEach(() => localStorage.clear())

  it('首访：写入 first-visit 与 trial-start，且为同一时间戳', () => {
    ensureFirstVisitMarks(() => 1_700_000_000_000)
    expect(localStorage.getItem('daycell-first-visit')).toBe('1700000000000')
    expect(localStorage.getItem('daycell-trial-start')).toBe('1700000000000')
  })

  it('已存在：两个 key 都不被覆盖', () => {
    localStorage.setItem('daycell-first-visit', '1000')
    localStorage.setItem('daycell-trial-start', '2000')
    ensureFirstVisitMarks(() => 9_000)
    expect(localStorage.getItem('daycell-first-visit')).toBe('1000')
    expect(localStorage.getItem('daycell-trial-start')).toBe('2000')
  })

  it('只缺其一：补写缺失的 key，已存在的保留（老版本升级兼容）', () => {
    localStorage.setItem('daycell-first-visit', '1000')
    ensureFirstVisitMarks(() => 9_000)
    expect(localStorage.getItem('daycell-first-visit')).toBe('1000')
    expect(localStorage.getItem('daycell-trial-start')).toBe('9000')
  })
})
