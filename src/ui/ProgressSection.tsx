/**
 * 今日「目标推进」区块（v8.107）。
 *
 * 用户在目标详情里点「＋ 目标推进」把某个子任务挑进今天，它就会以
 * 「目标名 + 阶段」分组出现在这里；**待办列表里不再重复出现**（DayDetail.todos 已过滤）。
 *
 * 口径（用户已拍板，不要擅自改）：
 *  - 行首是「打卡 / 已打卡」文字胶囊：打卡 ≠ 子任务完成，只是「今天在它上面动过」
 *    （写进 subtasks.workDates，由 store 的 toggleTodo 完成，这里只发一个动作）。
 *  - 行尾 6 格 = **最近 6 天，最右一格是今天**（v8.109 起）：打卡后这一格立刻变蓝，
 *    不再出现「点了打卡但右侧没有一格亮」的错觉；左边 5 格是历史。
 *  - 今天的打卡键必须露在行内，不藏在别处（用户明确否掉过藏起来的版本）。
 *  - 点组头 / 组内空白 / 行间 → 跳到「目标」tab 并打开这个目标的详情页；
 *    点文字、天数、点阵不响应。
 *  - 空态整块可点 → 目标列表页（不是某个目标详情），因为今天还没挑东西。
 *  - 组头右侧**没有** 2/3 计数（用户明确要求去掉）。
 */
import type { JSX } from 'react'
import type { DateKey } from '@core'
import { useApp } from '@/app/context'
import styles from './detail.module.css'

export function ProgressSection({ date }: { date?: DateKey }): JSX.Element {
  // 与 TodoSection 同一套缓存/兜底规则：侧页用 date 渲染静态完整版，中间页读 store.detail
  const selected = useApp((s) => s.selected)
  const k = date ?? selected
  const cached = useApp((s) => {
    const e = s.dayCache.get(k)
    return e && e.ver >= s.dataVer ? e.detail : undefined
  })
  const detail = useApp((s) => (date || s.detailDate !== k ? undefined : s.detail))
  const toggleTodo = useApp((s) => s.toggleTodo)
  const setView = useApp((s) => s.setView)
  const openGoal = useApp((s) => s.openGoal)

  const groups = (cached ?? detail)?.progress ?? []

  /** 进目标 tab（setView 会清 goalDetail 并 refresh）→ 再异步打开这个目标 */
  const goGoal = (id: string): void => {
    setView('goals')
    void openGoal(id)
  }

  return (
    <div className={styles.sect} data-testid="progress-section">
      <div className={styles.sectH}>
        <h3>目标推进</h3>
        <span className={styles.line} />
      </div>
      {groups.length === 0 ? (
        <button type="button" className={styles.reviewEmpty} onClick={() => setView('goals')}>
          {date ? '这天' : '今天'}还没挑要推进的子任务
          <br />
          <span className={styles.pcEmptyGo}>点这里去目标里挑 ›</span>
        </button>
      ) : (
        groups.map((g) => (
          <div
            key={g.goalId}
            className={styles.pgroup}
            onClick={() => goGoal(g.goalId)}
            title={`打开目标：${g.goalTitle}`}
          >
            <div className={styles.pgroupH}>
              <span className={styles.pgoal}>{g.goalTitle}</span>
              {g.stageTitle && <span className={styles.pstage}>{g.stageTitle}</span>}
            </div>
            {g.items.map((it) => (
              <div key={it.todoId} className={styles.prow}>
                <button
                  type="button"
                  className={it.done ? `${styles.pchk} ${styles.pchkOn}` : styles.pchk}
                  aria-pressed={it.done}
                  aria-label={it.done ? `撤销今天的打卡：${it.text}` : `今天打卡：${it.text}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void toggleTodo(it.todoId)
                  }}
                >
                  {it.done ? '已打卡' : '打卡'}
                </button>
                <span className={styles.ptext} onClick={(e) => e.stopPropagation()}>
                  {it.text}
                </span>
                {it.days > 0 && (
                  <span className={styles.pdays} onClick={(e) => e.stopPropagation()}>
                    {it.days} 天
                  </span>
                )}
                <span
                  className={styles.pdots}
                  aria-hidden="true"
                  title="最近 6 天（最右一格为今天）"
                  onClick={(e) => e.stopPropagation()}
                >
                  {it.recent.map((on, i) => (
                    <span key={i} className={on ? `${styles.pdot} ${styles.pdotOn}` : styles.pdot} />
                  ))}
                </span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
