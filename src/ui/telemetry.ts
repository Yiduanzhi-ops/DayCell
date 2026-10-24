/**
 * 埋点（v8.58 / v8.59 简化）：收费资格的「历史证据」。
 *
 * - `daycell-first-visit`：首次访问时间戳，写入后不再覆盖——将来收费时据此判定「老用户」。
 *
 * 判定逻辑（用户拍板）：
 *   老用户 = first-visit < 收费日 → 永久免费；
 *   新用户 = first-visit ≥ 收费日 → 试用 30 天（试用起点 = 首访）→ 到期收费。
 * 因此试用起点恒等于 first-visit，无需独立字段。
 * 本地优先产品特性：清缓存即重置（等于重新开始，产品无损失），属预期而非缺陷。
 */
const FIRST_VISIT_KEY = 'daycell-first-visit'

export function ensureFirstVisitMarks(now: () => number = Date.now): void {
  if (typeof localStorage === 'undefined') return
  if (!localStorage.getItem(FIRST_VISIT_KEY)) {
    localStorage.setItem(FIRST_VISIT_KEY, String(now()))
  }
}
