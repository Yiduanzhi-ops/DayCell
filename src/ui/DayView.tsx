/**
 * 日视图（v7：并入「今天」语义）：日头 + 顺延横幅 + 待办/想法两区块 + 今日习惯（v8.0）。
 *
 * v8.0：**支出区块从今天视图移除**（用户拍板：记账走 iCost，DayCell 不再录入/展示每日花费；
 * 历史支出数据保留，周/月汇总条不受影响，备份导出照常含 expenses 段）。
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
import { NoteSection } from './NoteSection'
import { HabitSection } from './HabitSection'
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
  const shiftDay = useApp((s) => s.shiftDay)

  const scrollRef = useRef<HTMLDivElement>(null)
  // v8.11 触摸滑动翻日：swipeBusy=过渡动画进行中忽略新手势；swipeAnim=本次 selected 变化由滑动引起（跳过入场动画）
  const swipeBusy = useRef(false)
  const swipeAnim = useRef(false)

  // 表单聚焦（手动展开入口；wantFocus 由 openForm 置位，渲染后消费一次）
  useEffect(() => {
    if (!wantFocus || !edit) return
    const el = scrollRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
    consumeFocus()
  }, [wantFocus, edit, consumeFocus])

  // 换日过渡：selected 变化（点格子进详情 / 桌面右栏换日 / 返回今天）时重放入场动画。
  // 首次挂载不播——落地页直接出现，不该有位移。滑动翻页（swipeAnim）也跳过——动画由手势流程接管。
  const firstRender = useRef(true)
  useEffect(() => {
    if (swipeAnim.current) return
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

  // v8.11 触摸滑动翻日（所有日视图生效）：整屏跟手 → 松手两阶段滑入/回弹。
  // 用原生监听：touchmove 需要 passive:false 才能 preventDefault（React 合成触摸事件为 passive）。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const THRESHOLD = 70
    const DUR = 250
    let startX = 0
    let startY = 0
    let startT = 0
    let dx = 0
    let dy = 0
    let tracking = false
    let finishTimer = 0

    const cleanupInline = (): void => {
      el.style.transition = ''
      el.style.transform = ''
    }

    const settle = (): void => {
      // 位移不足 → 回弹回原位
      el.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
      el.style.transform = 'translateX(0px)'
      window.setTimeout(cleanupInline, 200)
    }

    const onStart = (e: TouchEvent): void => {
      if (swipeBusy.current) return
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startT = performance.now()
      dx = 0
      dy = 0
      tracking = true
      el.style.transition = 'none'
    }

    const onMove = (e: TouchEvent): void => {
      if (!tracking) return
      const t = e.touches[0]
      dx = t.clientX - startX
      dy = t.clientY - startY
      // 竖向为主（页面滚动）→ 放弃手势，交给浏览器滚动
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
        tracking = false
        return
      }
      if (Math.abs(dx) > 6) e.preventDefault()
      el.style.transform = `translateX(${dx}px)`
    }

    const onEnd = (): void => {
      if (!tracking) return
      tracking = false
      const dur = performance.now() - startT
      const over = Math.abs(dx) > THRESHOLD || (Math.abs(dx) > 40 && Math.abs(dx) / Math.max(dur, 1) > 0.45)
      if (!over) {
        settle()
        return
      }
      const dir = dx < 0 ? 1 : -1
      swipeBusy.current = true
      swipeAnim.current = true
      // 阶段一：当前页跟手位置滑出屏幕
      el.style.transition = `transform ${DUR}ms cubic-bezier(0.22, 1, 0.36, 1)`
      el.style.transform = dx < 0 ? 'translateX(-100%)' : 'translateX(100%)'
      const finish = (ev: TransitionEvent): void => {
        if (ev.target !== el) return
        el.removeEventListener('transitionend', finish)
        shiftDay(dir)
        // 阶段二：新内容从反向起点滑入
        el.style.transition = 'none'
        el.style.transform = dx < 0 ? 'translateX(100%)' : 'translateX(-100%)'
        void el.offsetWidth // 强制 reflow，让上面的无过渡定位生效
        el.style.transition = `transform ${DUR}ms cubic-bezier(0.22, 1, 0.36, 1)`
        el.style.transform = 'translateX(0px)'
        window.clearTimeout(finishTimer)
        finishTimer = window.setTimeout(() => {
          cleanupInline()
          swipeBusy.current = false
          swipeAnim.current = false
        }, DUR + 60)
      }
      el.addEventListener('transitionend', finish, { once: true })
    }

    const onCancel = (): void => {
      if (!tracking) return
      tracking = false
      settle()
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      window.clearTimeout(finishTimer)
    }
  }, [shiftDay])

  if (!detail) {
    return <div className={styles.dscroll} ref={scrollRef} data-testid="day-scroll"><div className={styles.empty}>加载中…</div></div>
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
      <div className={styles.dscroll} ref={scrollRef} data-testid="day-scroll">
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
        <HabitSection />
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
