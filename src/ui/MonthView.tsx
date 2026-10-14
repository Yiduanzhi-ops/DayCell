/**
 * 月视图（M3 / US-06）：7 列 × 恒 6 行 = 42 格（D2：不做 5/6 行自适应，避免网格高度跳动）。
 * 格内只放**指示器**不放正文；正文在周视图和日视图。周一起始（D1）；邻月补齐格淡化但可点。
 *
 * 格子固定三行（v7.1，用户拍板）：
 *   行1  日期圆 + 农历/节日标签
 *   行2  纪念日徽章（v8.4 起月格不再显示支出金额；徽章优先占用此行）
 *   行3  待办进度 ✓done/total（左）+ **想法点（右下角）**
 * 邻月补齐格只显示行1（密度信息属于本月，淡化格再带内容是噪音）。
 *
 * v8.34：月视图接入**三页轨道滑动**（与日视图同机制）——左滑/右滑丝滑切换上一月/下一月，
 * 途中可见两侧真实月内容；原左右箭头保留。三屏：中间屏 = 当前月（monthCache 优先 + store.month 兜底）；
 * 两侧屏 = 上一/下一月（monthCache 只读，dataVer 过期显骨架，预取落地自动填充）。
 */
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { addMonths, fromKey, isSameMonth, monthOf } from '@core'
import type { DateKey } from '@core'
import { useApp } from '@/app/context'
import { SwipeTrack } from './SwipeTrack'
import swipeStyles from './SwipeTrack.module.css'
import styles from './MonthView.module.css'

const WK_HEAD = ['一', '二', '三', '四', '五', '六', '日'] as const

export function MonthView(): JSX.Element {
  const selected = useApp((s) => s.selected)
  const shift = useApp((s) => s.shift)
  const prefetchMonth = useApp((s) => s.prefetchMonth)

  return (
    <SwipeTrack
      current={selected}
      prevOf={(k) => addMonths(k, -1)}
      nextOf={(k) => addMonths(k, 1)}
      prefetch={prefetchMonth}
      flip={shift}
      testId="month-scroll"
      renderPage={(k, role) => <MonthPage monthKey={k} role={role} />}
    />
  )
}

/** 单月完整视图（v8.34 三屏共用）：中间屏 = 当前月（可交互）；两侧屏 = 相邻月（只读预览）。
 *  数据源 = monthCache.get(monthOf(k))（滑动预取/refresh 写入）；中间屏兜底 store.month。
 *  dataVer 过期（写操作/同步后）：侧屏无兜底 → 骨架；中间屏兜底 s.month（refresh 聚合的最新数据）。 */
function MonthPage({ monthKey, role }: { monthKey: DateKey; role: 'center' | 'side' }): JSX.Element {
  const cached = useApp((s) => {
    const e = s.monthCache.get(monthOf(monthKey))
    return e && e.ver >= s.dataVer ? e.detail : undefined
  })
  const current = useApp((s) => (role === 'center' ? s.month : undefined))
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

  const data = cached ?? current
  if (!data) {
    return (
      <div className={swipeStyles.skels}>
        <div className={swipeStyles.skel} />
        <div className={swipeStyles.skel} />
        <div className={swipeStyles.skel} />
      </div>
    )
  }

  const days = data.days

  return (
    <>
      <div className={styles.mbar}>
        <span>{data.summary.daysWithRecords ?? 0} 天有记录</span>
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
            // 行2：纪念日徽章（v8.8 修复手机窄屏截断：徽章留在格内，一行放不下自然换行，最多 3 行，不漂移）
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
                {/* v8.42：当日有复盘 → 右上角小圆点（clun/fest 已右移避让） */}
                {d.hasReview && <i className={styles.rdot} aria-label="这天有复盘" />}
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
