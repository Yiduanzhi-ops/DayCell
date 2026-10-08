/**
 * core/sync/merge —— 同步合并（v8.1 坚果云同步）。
 *
 * ⚠️ 与 backup 的"导入合并"（mergeBackup）**语义不同**，不要混用：
 *  - 导入备份：本地优先——本地已有 id 保留本地（用户拿备份补漏，不覆盖现场）
 *  - 同步：last-write-wins——同 id 取 updatedAt 较新者；任何一端较新的改动
 *    都会在另一端生效，两端最终收敛到一致（PRD §6.3 记录级 LWW 的直接应用）
 *
 * 墓碑参与比较（软删除模型，ADR-0001）：
 *  - 同 id：取 updatedAt 较新者，可能是墓碑（= 删除同步过去）
 *  - 远端独有且是墓碑：本地从没见过这条 → 墓碑无意义，跳过
 *  - 本地独有（含本地墓碑）：保留现状
 *
 * 纯函数，无 IO；写库由 engine 用单事务 + keepTimestamps 完成。
 */

import type { RecordTable, SettingRecord } from '../types'

/** 按 id 合并两个记录集：同 id 取 updatedAt 较新者 */
export function mergeByUpdated<T extends { id: string; updatedAt: number; deleted: boolean }>(
  local: T[],
  remote: T[],
): T[] {
  const localIds = new Set(local.map((r) => r.id))
  const byId = new Map<string, T>()
  for (const r of local) byId.set(r.id, r)
  for (const r of remote) {
    const cur = byId.get(r.id)
    if (!cur || r.updatedAt > cur.updatedAt) byId.set(r.id, r)
  }
  // 远端独有且是墓碑 → 本地从未有过这条记录，删除无对象，跳过
  return [...byId.values()].filter((r) => !(r.deleted && !localIds.has(r.id)))
}

/** settings 按 key 合并：同 key 取 updatedAt 较新者（SettingRecord 主键是 key） */
export function mergeSettings(local: SettingRecord[], remote: SettingRecord[]): SettingRecord[] {
  const byKey = new Map<string, SettingRecord>()
  for (const s of local) byKey.set(s.key, s)
  for (const s of remote) {
    const cur = byKey.get(s.key)
    if (!cur || s.updatedAt > cur.updatedAt) byKey.set(s.key, s)
  }
  return [...byKey.values()]
}

/** 整表合并（含墓碑；结果可直接 putMany keepTimestamps 写回） */
export function mergeTables(local: RecordTable, remote: RecordTable): RecordTable {
  return {
    todos: mergeByUpdated(local.todos, remote.todos),
    notes: mergeByUpdated(local.notes, remote.notes),
    expenses: mergeByUpdated(local.expenses, remote.expenses),
    anniversaries: mergeByUpdated(local.anniversaries, remote.anniversaries),
    categories: mergeByUpdated(local.categories, remote.categories),
    goals: mergeByUpdated(local.goals, remote.goals),
    stages: mergeByUpdated(local.stages, remote.stages),
    subtasks: mergeByUpdated(local.subtasks, remote.subtasks),
    habits: mergeByUpdated(local.habits, remote.habits),
    checkins: mergeByUpdated(local.checkins, remote.checkins),
    settings: mergeSettings(local.settings, remote.settings),
  }
}
