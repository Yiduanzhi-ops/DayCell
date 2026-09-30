/**
 * 顶栏：品牌 / 前后翻页 / 标题 / 今天 / 视图切换器（日→周→月，常驻不折叠，D17）。
 * 标题内容按视图分叉（原型 renderTitle 的移植）：
 *  - 日：`2026 年 9 月` + `29 日 周二`
 *  - 周：月份或跨月区间 + `28–4 日`
 *  - 月：`2026 年 9 月` + `N 天有记录 · ¥x`（月汇总，US-11）
 * 「今天」按钮只在选中日 ≠ 今天时出现（US-09）。
 */
import type { JSX } from 'react'
import { dowOf, formatMoney, fromKey } from '@core'
import { useApp } from '@/app/context'
import { ChevronLeft, ChevronRight } from './icons'
import styles from './TopBar.module.css'

const DOW = ['日', '一', '二', '三', '四', '五', '六'] as const

export function TopBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const selected = useApp((s) => s.selected)
  const today = useApp((s) => s.today)
  const month = useApp((s) => s.month)
  const week = useApp((s) => s.week)
  const setView = useApp((s) => s.setView)
  const shift = useApp((s) => s.shift)
  const gotoToday = useApp((s) => s.gotoToday)

  const { y, m, d } = fromKey(selected)
  let title = `${y} 年 ${m} 月`
  let sub = ''
  if (view === 'day') {
    sub = `${d} 日 周${DOW[dowOf(selected)]}`
  } else if (view === 'week') {
    const a = week?.days[0] ? fromKey(week.days[0].date) : null
    const b = week?.days[6] ? fromKey(week.days[6].date) : null
    if (a && b) {
      title = a.m === b.m ? `${a.y} 年 ${a.m} 月` : `${a.m} 月 – ${b.m} 月`
      sub = `${a.d}–${b.d} 日`
    }
  } else if (month) {
    sub = `${month.summary.daysWithRecords} 天有记录 · ¥${formatMoney(month.summary.costCents)}`
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <i className={styles.mark} aria-hidden="true" />
        <span>DayCell</span>
      </div>
      <div className={styles.nav}>
        <button onClick={() => shift(-1)} aria-label="上一个" title="上一个">
          <ChevronLeft />
        </button>
        <button onClick={() => shift(1)} aria-label="下一个" title="下一个">
          <ChevronRight />
        </button>
      </div>
      <div className={styles.title}>
        {title}
        {sub && <small>{sub}</small>}
      </div>
      <div className={styles.spacer} />
      {selected !== today && (
        <button className={styles.todayBtn} onClick={gotoToday}>
          今天
        </button>
      )}
      <div className={styles.seg} role="tablist" aria-label="视图切换">
        {(
          [
            ['day', '日'],
            ['week', '周'],
            ['month', '月'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            className={view === v ? styles.on : undefined}
            onClick={() => setView(v)}
            title={`快捷键 ${v[0]}`}
          >
            {label}
          </button>
        ))}
      </div>
    </header>
  )
}
