/**
 * 日视图（v7：并入「今天」语义）：日头 + 顺延横幅 + 待办/花费/想法三区块。
 *
 * 今天标签恒显示今天；其他日子的日详情只能从周/月点格子进入（手机全屏 + 返回条，
 * 桌面右栏）。**不再提供翻日**（D19）——左右滑动翻日已删除：它既是低频路径，
 * 也正是「左右切换不丝滑」的来源（手势与纵向滚动打架 + 每翻一天整页硬切）。
 *
 * 两条硬性交互（ADR-0005 v6 / PRD D18）：
 *  1. 「← 返回」只在**从周/月点格子进来**（source != null）时出现，回到来源视图+日期+滚动位置
 *  2. 表单只在**手动点「+ 添加」**时展开（v7.2 起不再对空白日自动展开），展开后聚焦
 *     （wantFocus → [data-autofocus]）并 scrollIntoView——表单可能在折叠线以下，不滚过去
 *     看起来像"点了没反应"
 *
 * 换日过渡（v7）：detail 刷新期间旧内容保持可见（store.refresh 不清 detail），
 * 新数据落地后按 selected 变化重放一次 CSS 入场动画——窄屏整屏滑入、宽屏内容淡入。
 * 动画是渐进增强：jsdom / 无 Web Animations 环境静默跳过，prefers-reduced-motion 尊重系统设置。
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
  const back = useApp((s) => s.back)
  const rollDismissed = useApp((s) => s.rollDismissed)
  const rollOver = useApp((s) => s.rollOver)
  const dismissRoll = useApp((s) => s.dismissRoll)
  const edit = useApp((s) => s.edit)
  const wantFocus = useApp((s) => s.wantFocus)
  const consumeFocus = useApp((s) => s.consumeFocus)

  const scrollRef = useRef<HTMLDivElement>(null)

  // 表单聚焦（手动展开入口；wantFocus 由 openForm 置位，渲染后消费一次）
  useEffect(() => {
    if (!wantFocus || !edit) return
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
    consumeFocus()
  }, [wantFocus, edit, consumeFocus])

  // 换日过渡：selected 变化（点格子进详情 / 桌面右栏换日 / 返回今天）时重放入场动画。
  // 首次挂载不播——落地页直接出现，不该有位移。
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    const el = scrollRef.current
    if (!el || typeof el.animate !== 'function') return
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return
    }
    const narrow =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 899.98px)').matches
    // 窄屏：日详情是全屏页面，整屏滑入（原生 App 的推页手感）；宽屏：右栏内容轻淡入
    const from = narrow ? 56 : 14
    void el.animate(
      [
        { opacity: 0.35, transform: `translateX(${from}px)` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: narrow ? 220 : 160, easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)' },
    )
  }, [selected])

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
        </div>
      )}
      <div className={styles.dscroll} ref={scrollRef}>
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
