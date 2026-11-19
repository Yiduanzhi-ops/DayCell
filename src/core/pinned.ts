/**
 * v8.108 常驻推进（每日补建）——纯计算，不碰存储。
 *
 * 口径（用户拍板）：
 *  - 目标详情里点「＋ 目标推进」= **常驻**：此后每天自动出现在今日视图，
 *    直到子任务完成（自动解除）、目标/子任务删除，或用户手动移出。
 *  - 实现走「幂等补建」：每天首次打开当天视图时，为 pinned 子任务补一条当天的
 *    子任务待办行（`todos.subtaskId`）。数据模型不变 → 打卡（workDates）、
 *    周视图、月视图、报告统计全部沿用现有关联逻辑。
 *  - **不回填历史**：只在被打开的那一天补建，过去的日子不补。
 *  - 幂等键 = `subtaskId`（同一子任务同一天最多一条），已有则该条不重复建。
 */

import type { GoalRecord, SubtaskRecord, TodoRecord } from './types'

/** 需要补建的一条当天待办（字段取自子任务与目标的最新快照） */
export interface PinnedTodoDraft {
  subtaskId: string
  /** 子任务标题快照；之后改名不影响已建的那条 */
  text: string
  /** 目标标题快照（待办行标注「· 目标名」用） */
  goalTitle: string
}

/**
 * 算出 `existing`（某一日的待办）里缺哪些 pinned 子任务的行。
 * 顺序按子任务 createdAt 升序，与目标详情页看到的顺序一致。
 */
export function planPinnedTodos(
  subtasks: readonly SubtaskRecord[],
  goals: readonly GoalRecord[],
  existing: readonly TodoRecord[],
): PinnedTodoDraft[] {
  const goalMap = new Map(goals.filter((g) => !g.deleted).map((g) => [g.id, g]))
  // 已有行（含墓碑不算）→ 当天已就位的 subtaskId
  const have = new Set(
    existing
      .filter((t) => !t.deleted && t.subtaskId)
      .map((t) => t.subtaskId as string),
  )

  return [...subtasks]
    .filter((s) => !s.deleted && s.pinned === true && !s.done)
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((s) => {
      // 目标没了（理论上删目标会连带墓碑子任务）→ 不补建幽灵行
      const goal = goalMap.get(s.goalId)
      if (!goal || have.has(s.id)) return []
      return [{ subtaskId: s.id, text: s.title, goalTitle: goal.title }]
    })
}
