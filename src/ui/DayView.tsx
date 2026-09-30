/**
 * 日视图（v6 的默认落地页）：日头 + 顺延横幅 + 待办/花费/想法三区块。
 *
 * 三条硬性交互（ADR-0005 v6 / PRD D18）：
 *  1. 「← 返回」只在**从周/月点格子进来**（source != null）时出现，回到来源视图+日期+滚动位置
 *  2. 左右滑动翻日（仅日视图；水平位移 ≥50px 且 ≥1.5× 垂直位移，避免和纵向滚动打架）
 *  3. 完全空白的一天自动展开待办表单并聚焦（wantFocus → [data-autofocus]），
 *     且必须 scrollIntoView——表单可能在折叠线以下，不滚过去看起来像"点了没反应"
 */
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { dowOf, fromKey, lunarFullText } from '@core'
import { useApp } from '@/app/context'
import { TodoSection } from './TodoSection'
import { ExpenseSection } from './ExpenseSection'
import { NoteSection } from './NoteSection'
import styles from './DayView.module.css'

const DOW = ['日', '一', '二', '三', '四', '五', '六'] as const

export function DayView(): JSX.Element {
  const detail = useApp((s) => s.detail)
  const selected = useApp((s) => s.selected)
  const today = useApp((s) => s.today)
  const source = useApp((s) => s.source)
  const view = useApp((s) => s.view)
  const back = useApp((s) => s.back)
  const shift = useApp((s) => s.shift)
  const rollDismissed = useApp((s) => s.rollDismissed)
  const rollOver = useApp((s) => s.rollOver)
  const dismissRoll = useApp((s) => s.dismissRoll)
  const edit = useApp((s) => s.edit)
  const wantFocus = useApp((s) => s.wantFocus)
  const consumeFocus = useApp((s) => s.consumeFocus)

  const scrollRef = useRef<HTMLDivElement>(null)
  const touch = useRef({ x: 0, y: 0 })

  // 表单聚焦（自动展开 / 手动展开共用一条路径）
  useEffect(() => {
    if (!wantFocus || !edit) return
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
    consumeFocus()
  }, [wantFocus, edit, consumeFocus])

  if (!detail) {
    return <div className={styles.dscroll} ref={scrollRef}><div className={styles.empty}>加载中…</div></div>
  }

  const { y, m, d } = fromKey(selected)
  const isToday = selected === today
  const lunarText = lunarFullText(detail.lunar)
  const lunarEmphasis = !!(detail.lunar?.festival || detail.lunar?.solarTerm)
  const showRoll = detail.prevDayRollable > 0 && !rollDismissed[selected]
  const dayWord = isToday ? '今天' : ''

  return (
    <>
      {source && (
        <div className={styles.daybar}>
          <button className={styles.backBtn} onClick={() => back()}>
            ← 返回
            <span className={styles.backSrc}>{source.view === 'week' ? '周视图' : '月视图'}</span>
          </button>
          <span className={styles.swipeHint}>左右滑动可翻日</span>
        </div>
      )}
      <div
        className={styles.dscroll}
        ref={scrollRef}
        onTouchStart={(e) => {
          const t0 = e.changedTouches[0]
          touch.current = { x: t0.clientX, y: t0.clientY }
        }}
        onTouchEnd={(e) => {
          if (view !== 'day') return
          const t1 = e.changedTouches[0]
          const dx = t1.clientX - touch.current.x
          const dy = t1.clientY - touch.current.y
          if (Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return
          shift(dx < 0 ? 1 : -1) // 左滑 → 下一天，右滑 → 前一天
        }}
      >
        <div className={styles.dhead}>
          <div className={styles.dtitle}>
            {y} 年 {m} 月 {d} 日
            <span className={styles.dow}>周{DOW[dowOf(selected)]}</span>
            {isToday && <span className={styles.todayMark}>今天</span>}
          </div>
          {(lunarText || detail.anniversaries.length > 0) && (
            <div className={styles.dsub}>
              {lunarText && (
                <span className={lunarEmphasis ? styles.fest : undefined}>{lunarText}</span>
              )}
              {detail.anniversaries.map((a) => (
                <span key={a.id} className={styles.anniBadge}>◷ {a.title}</span>
              ))}
            </div>
          )}
        </div>

        {showRoll && (
          <div className={styles.roll}>
            <span className={styles.rollText}>
              前一天还有 <b>{detail.prevDayRollable}</b> 件没做完
            </span>
            <button onClick={() => void rollOver()}>顺延</button>
            <button className={styles.ghostBtn} onClick={dismissRoll}>忽略</button>
          </div>
        )}

        <TodoSection dayWord={dayWord} />
        <ExpenseSection dayWord={dayWord} />
        <NoteSection dayWord={dayWord} />

        {detail.summary.isEmpty && !edit && (
          <div className={styles.empty}>
            <div className={styles.big}>○</div>
            {isToday ? (
              <>今天还什么都没有<br />点各区块右上角的「+ 添加」开始记录</>
            ) : (
              <>这一天还什么都没有<br />点各区块右上角的「+ 添加」补记</>
            )}
          </div>
        )}
      </div>
    </>
  )
}
