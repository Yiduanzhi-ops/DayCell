/**
 * 月视图（M3 / US-06）：7 列 × 恒 6 行 = 42 格（D2：不做 5/6 行自适应，避免网格高度跳动）。
 * 格内只放**指示器**不放正文；正文在周视图和日视图。周一起始（D1）；邻月补齐格淡化但可点。
 *
 * 格子固定三行（v7.1，用户拍板）：
 *   行1  日期圆 + 农历/节日标签
 *   行2  **花费**（独立一行，只要有花费就显示——不再被待办 gate 住；
 *        当天有纪念日徽章时徽章优先占用此行，花费让位）
 *   行3  待办进度 ✓done/total（左）+ **想法点（右下角）**
 * 邻月补齐格只显示行1（密度信息属于本月，淡化格再带花费是噪音）。
 */
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { fromKey, isSameMonth } from '@core'
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

  // 从日详情返回时还原滚动位置（ADR-0005 来源三要素之一）
  useEffect(() => {
    if (restore != null && scrollRef.current) {
      scrollRef.current.scrollTop = restore
      consumeRestore()
    }
  }, [restore, consumeRestore])

  const days = month?.days ?? []

  return (
    <>
      {/* v8.4：移除「本月消费」汇总条（用户拍板：周/月视图不再显示支出相关文字） */}
      <div className={styles.mbar}>
        <span>{month?.summary.daysWithRecords ?? 0} 天有记录</span>
      </div>
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
              + (d.noteCount ? ` ${d.noteCount}条想法` : '')
            // 行2：纪念日徽章（v8.4 起月格不再显示支出金额）
            const showAnni = d.anniversaries.length > 0
            // 行3：有待办或有想法才渲染；想法点靠 margin-left:auto 恒在右下角
            const showRow3 = !out && (d.todoTotal > 0 || d.noteCount > 0)
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
                {showAnni && (
                  <span className={styles.anniBadge}>◷ {d.anniversaries[0]}</span>
                )}
                {showRow3 && (
                  <div className={styles.crow3}>
                    {d.todoTotal > 0 && (
                      <span className={d.todoDone === d.todoTotal ? styles.allDone : styles.prog}>
                        {d.todoDone > 0 && <CheckMark />}
                        {d.todoDone}/{d.todoTotal}
                      </span>
                    )}
                    {d.noteCount > 0 && (
                      <span className={styles.nind}>
                        <i aria-hidden="true" />
                        {d.noteCount > 1 && <em>{d.noteCount}</em>}
                      </span>
                    )}
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

/**
 * 进度前缀小对勾（done > 0 时出现）。
 * 用内联 SVG 而不是 '✓' 字符：字体对 U+2713 的渲染参差不齐（有的Fallback 到emoji 体），
 * 9px 下不可控；stroke 与周行的 Check 图标同源。
 */
function CheckMark(): JSX.Element {
  return (
    <svg
      className={styles.progChk}
      width="7"
      height="7"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
