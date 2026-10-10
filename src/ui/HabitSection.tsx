/**
 * 今日习惯区块（v8.0）：与待办/想法并列的独立区块。
 *
 * 用户拍板口径：
 *  - 只显示"今天该做的"习惯（每天全部 / 每周命中星期几），暂停的不出现
 *  - 纯勾选打卡，不记量、不进待办、不产生"昨天的欠账"
 *  - 区块头右侧「管理」→ 菜单式习惯设置页（HabitsView）
 */
import type { JSX } from 'react'
import type { DateKey } from '@core'
import { useApp } from '@/app/context'
import styles from './HabitSection.module.css'

const DOW_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const

export function freqLabel(freq: { kind: 'daily' } | { kind: 'weekly'; weekdays: number[] }): string {
  if (freq.kind === 'daily') return '每天'
  return `每周·${freq.weekdays.map((d) => DOW_SHORT[d]).join('')}`
}

/** 今日习惯区块（v8.0）：与待办/想法并列的独立区块。
 *  v8.21：加 date prop——两侧页（滑动预览相邻日）从缓存 detail.habits 渲染静态完整版
 *  （与中间页同口径：今天该做的 + 打卡态），只读展示；中间页（date 缺省）保持交互打卡/管理。
 *
 * 用户拍板口径：
 *  - 只显示"今天该做的"习惯（每天全部 / 每周命中星期几），暂停的不出现
 *  - 纯勾选打卡，不记量、不进待办、不产生"昨天的欠账"
 *  - 区块头右侧「管理」→ 菜单式习惯设置页（HabitsView）
 */
export function HabitSection({ date }: { date?: DateKey } = {}): JSX.Element {
  const habitDay = useApp((s) => s.habitDay)
  const toggleHabit = useApp((s) => s.toggleHabit)
  const openHabits = useApp((s) => s.openHabits)

  // 侧页：从当日缓存 detail.habits 读（v8.20 起聚合带习惯），与中间页 habitDay 同口径（buildHabitItems）
  const sideHabits = useApp((s) => {
    if (!date) return undefined
    const e = s.dayCache.get(date)
    return e && e.ver >= s.dataVer ? e.detail?.habits : undefined
  })

  const items = sideHabits ?? habitDay?.items ?? []
  const done = sideHabits ? sideHabits.filter((h) => h.done).length : (habitDay?.doneCount ?? 0)
  const total = sideHabits ? sideHabits.length : (habitDay?.dueCount ?? 0)

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>今日习惯</h3>
        <span className={styles.count}>{done}/{total}</span>
        <span className={styles.line} />
        <button className={styles.manage} onClick={openHabits} aria-label="管理习惯">
          管理
        </button>
      </div>
      {items.length > 0 ? (
        <div className={styles.box}>
          {items.map((h) => (
            <div key={h.id} className={h.done ? `${styles.row} ${styles.on}` : styles.row}>
              <button
                className={h.done ? `${styles.check} ${styles.checkOn}` : styles.check}
                aria-label={`${h.done ? '取消打卡' : '打卡'}：${h.name}`}
                onClick={() => void toggleHabit(sideHabits ? date! : habitDay!.date, h.id)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </button>
              <span className={styles.name}>{h.name}</span>
              <span className={styles.freq}>{freqLabel(h.freq)}</span>
            </div>
          ))}
        </div>
      ) : (
        <button className={styles.empty} onClick={openHabits}>
          还没有习惯，点这里去添加
        </button>
      )}
    </div>
  )
}
