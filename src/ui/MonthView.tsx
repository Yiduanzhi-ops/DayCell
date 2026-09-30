/**
 * 月视图（M3 / US-11）：7 列 × 恒 6 行 = 42 格（D2：不做 5/6 行自适应，避免网格高度跳动）。
 * 格内只放**指示器**不放正文（待办进度 / 当日花费 / 想法点）；正文在周视图和日视图。
 * 周一起始（D1）；邻月补齐格淡化但可点。
 */
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { formatMoney, formatMoneyShort, fromKey, isSameMonth } from '@core'
import { useApp } from '@/app/context'
import styles from './MonthView.module.css'

const WK_HEAD = ['一', '二', '三', '四', '五', '六', '日'] as const

export function MonthView(): JSX.Element {
  const month = useApp((s) => s.month)
  const selected = useApp((s) => s.selected)
  const today = useApp((s) => s.today)
  const selectFromCalendar = useApp((s) => s.selectFromCalendar)
  const restore = useApp((s) => s.restoreScrollTo)
  const consumeRestore = useApp((s) => s.consumeRestoreScroll)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 从日视图返回时还原滚动位置（ADR-0005 来源三要素之一）
  useEffect(() => {
    if (restore != null && scrollRef.current) {
      scrollRef.current.scrollTop = restore
      consumeRestore()
    }
  }, [restore, consumeRestore])

  const days = month?.days ?? []

  return (
    <>
      <div className={styles.wkhead}>
        {WK_HEAD.map((w, i) => (
          <div key={w} className={i >= 5 ? styles.we : undefined}>{w}</div>
        ))}
      </div>
      <div className={styles.gridScroll} ref={scrollRef}>
        <div className={styles.grid} role="grid" aria-label="月视图">
          {days.map((d) => {
            const { d: dd } = fromKey(d.date)
            const isSel = d.date === selected
            const isToday = d.date === today
            const out = !isSameMonth(d.date, selected)
            const aria = `${fromKey(d.date).y}年${fromKey(d.date).m}月${dd}日`
              + (d.label.text ? ` ${d.label.text}` : '')
              + (d.todoTotal ? ` 待办${d.todoDone}/${d.todoTotal}` : '')
              + (d.costCents ? ` 支出${formatMoney(d.costCents)}元` : '')
              + (d.noteCount ? ` ${d.noteCount}条想法` : '')
            return (
              <div
                key={d.date}
                role="gridcell"
                tabIndex={0}
                aria-selected={isSel}
                aria-label={aria}
                title={aria}
                className={[styles.cell, isSel ? styles.sel : '', isToday ? styles.today : '', out ? styles.out : ''].filter(Boolean).join(' ')}
                onClick={() => selectFromCalendar(d.date, scrollRef.current?.scrollTop ?? 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectFromCalendar(d.date, scrollRef.current?.scrollTop ?? 0)
                  }
                }}
              >
                <div className={styles.ctop}>
                  <span className={styles.cnum}>{dd}</span>
                  {d.label.text && (
                    <span className={d.label.emphasis ? styles.fest : styles.clun}>
                      {d.label.text}
                      {d.label.extra ? <em className={styles.extra}>+{d.label.extra}</em> : null}
                    </span>
                  )}
                </div>
                {d.anniversaries.length > 0 && d.todoTotal === 0 && (
                  <span className={styles.anniBadge}>◷ {d.anniversaries[0]}</span>
                )}
                {d.todoTotal > 0 && (
                  <div className={styles.crow3}>
                    <span className={d.todoDone === d.todoTotal ? styles.allDone : styles.prog}>
                      {d.todoDone}/{d.todoTotal}
                    </span>
                    {d.costCents > 0 && <span className={styles.cost}>¥{formatMoneyShort(d.costCents)}</span>}
                    <span className={styles.nind}>
                      {d.noteCount > 0 && <i aria-hidden="true" />}
                      {d.noteCount > 1 && <em>{d.noteCount}</em>}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
