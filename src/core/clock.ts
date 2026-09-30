/**
 * 时钟（ADR-0006 铁律 3 的唯一豁免点）。
 *
 * core 层禁止隐式读取当前时间——需要"现在"的地方一律接收注入的 `now()`，
 * 这样涉及时间的逻辑在测试里都可复现。
 *
 * 但生产代码总得有一个真实的时钟来源，于是把它收敛到**这一个文件、这一行**。
 * ESLint 只对 `core/clock.ts` 放开 `Date.now()`，其余 core 文件一律禁止。
 */

export type Clock = () => number

/** 生产默认时钟 */
export const systemClock: Clock = () => Date.now()

/**
 * 测试用的可控时钟。
 *
 * 让 updatedAt 成为可断言的确定值，也让"7 天未备份提醒"这类时间逻辑可测。
 */
export interface FakeClock extends Clock {
  advance(ms: number): number
  set(ms: number): number
}

export function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let t = start
  const fn = (() => t) as FakeClock
  fn.advance = (ms: number) => (t += ms)
  fn.set = (ms: number) => (t = ms)
  return fn
}
