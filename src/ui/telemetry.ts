/**
 * 埋点（v8.58）：收费资格的「历史证据」。
 *
 * - `daycell-first-visit`：首次访问时间戳，写入后不再覆盖——将来收费时据此判定「老用户」。
 * - `daycell-trial-start`：试用开始时间戳，写入后不再覆盖——30 天试用倒计时的起点。
 *
 * 两个 key 同一次写入取同一时间戳（试用从首访开始）。
 * 本地优先产品特性：清缓存即重置（等于重新开始，产品无损失），属预期而非缺陷。
 */
const FIRST_VISIT_KEY = 'daycell-first-visit'
const TRIAL_START_KEY = 'daycell-trial-start'

export function ensureFirstVisitMarks(now: () => number = Date.now): void {
  if (typeof localStorage === 'undefined') return
  if (localStorage.getItem(FIRST_VISIT_KEY) && localStorage.getItem(TRIAL_START_KEY)) return
  const ts = String(now())
  if (!localStorage.getItem(FIRST_VISIT_KEY)) localStorage.setItem(FIRST_VISIT_KEY, ts)
  if (!localStorage.getItem(TRIAL_START_KEY)) localStorage.setItem(TRIAL_START_KEY, ts)
}
