/**
 * 日视图（v7：并入「今天」语义）：日头 + 顺延横幅 + 待办/想法两区块 + 今日习惯（v8.0）。
 *
 * v8.0：**支出区块从今天视图移除**（用户拍板：记账走 iCost，DayCell 不再录入/展示每日花费；
 * 历史支出数据保留，周/月汇总条不受影响，备份导出照常含 expenses 段）。
 *
 * 今天标签恒显示今天；其他日子的日详情只能从周/月点格子进入（手机全屏 + 返回条，
 * 桌面右栏）。
 *
 * v8.12（滑动翻日重做，用户要求"滑的途中同时看到两边数据"）：日视图改为**三页轨道**——
 * 轨道同时渲染 前一天 / 当前 / 后一天 三页（各占一屏宽），相邻页藏在屏幕外；
 * 触摸跟手 = 整条轨道平移，**滑动途中能看到两边的真实内容**（原生日历手感）；
 * 松手超阈值滑到目标页 → 重排三页 + 无感复位；不足回弹。
 * 相邻日 detail 由 store.prefetchDay 预取进 dayCache（内存缓存，IndexedDB 本地读，
 * 未就绪的页显示轻骨架，数据落地自动填充）。桌面无手势时轨道静止 = 单页外观。
 *
 * 两条硬性交互（ADR-0005 v6 / PRD D18）：
 *  1. 「← 返回」只在**从周/月点格子进来**（source != null）时出现，回到来源视图+日期+滚动位置
 *  2. 表单只在**手动点「+ 添加」**时展开（v7.2 起不再对空白日自动展开），展开后聚焦
 *     （wantFocus → [data-autofocus]）并 scrollIntoView——表单可能在折叠线以下，不滚过去
 *     看起来像"点了没反应"
 *
 * 换日过渡（v7/v8.12）：点格子/返回/今天这类非滑动换日，重排后播放入场动画
 * （窄屏轻滑入、宽屏淡入，Web Animations 渐进增强；jsdom / reduced-motion 静默跳过）；
 * 滑动翻页的动画完全由手势流程接管（滑出 → shiftDay → 无动画复位）。
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { addDays, dowOf, fromKey, lunarFullText } from '@core'
import type { DateKey } from '@core'
import { useApp } from '@/app/context'
import { TodoSection } from './TodoSection'
import { NoteSection } from './NoteSection'
import { HabitSection } from './HabitSection'
import styles from './DayView.module.css'

const DOW = ['日', '一', '二', '三', '四', '五', '六'] as const

/** v8.12 轨道：中间页相对轨道起点的位移。轨道宽 300%（3 屏），translateX 百分比相对轨道自身宽 */
const BASE = 'translateX(-33.3333%)'

export function DayView(): JSX.Element {
  const selected = useApp((s) => s.selected)
  const source = useApp((s) => s.source)
  const back = useApp((s) => s.back)
  const edit = useApp((s) => s.edit)
  const wantFocus = useApp((s) => s.wantFocus)
  const consumeFocus = useApp((s) => s.consumeFocus)
  const shiftDay = useApp((s) => s.shiftDay)
  const prefetchDay = useApp((s) => s.prefetchDay)

  const [pages, setPages] = useState<[DateKey, DateKey, DateKey]>(() => [
    addDays(selected, -1),
    selected,
    addDays(selected, 1),
  ])
  const trackRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  const swipeBusy = useRef(false) // 轨道过渡动画中，忽略新手势
  const swipeAnim = useRef(false) // 本次 selected 变化由滑动引起：重排无动画复位
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  // 表单聚焦（手动展开入口；wantFocus 由 openForm 置位，渲染后消费一次）
  useEffect(() => {
    if (!wantFocus || !edit) return
    const el = trackRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    el?.focus()
    el?.scrollIntoView?.({ block: 'nearest' })
    consumeFocus()
  }, [wantFocus, edit, consumeFocus])

  // 挂载 / selected 变化：重排三页 + 预取相邻日 + 复位轨道。
  // 滑动翻页（swipeAnim）走无动画复位（内容在过渡时已停在目标页）；其他换日播入场动画。
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const prev = addDays(selected, -1)
    const next = addDays(selected, 1)
    setPages([prev, selected, next])
    void prefetchDay(prev)
    void prefetchDay(next)
    if (firstRender.current || swipeAnim.current) {
      firstRender.current = false
      swipeAnim.current = false
      el.style.transition = 'none'
      el.style.transform = BASE
      return
    }
    el.style.transition = 'none'
    el.style.transform = BASE
    if (typeof el.animate === 'function' && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      void el.animate(
        [
          { transform: 'translateX(calc(-33.3333% + 24px))', opacity: 0.35 },
          { transform: BASE, opacity: 1 },
        ],
        { duration: 180, easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)' },
      )
    }
  }, [selected, prefetchDay])

  // v8.12 触摸滑动：整条轨道跟手平移（途中可见两侧真实内容）→ 松手超阈值滑到目标页。
  // 原生监听：touchmove 需要 passive:false 才能 preventDefault（React 合成触摸事件为 passive）。
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const THRESHOLD = 70
    const DUR = 260
    let startX = 0
    let startY = 0
    let startT = 0
    let dx = 0
    let dy = 0
    let tracking = false

    const cleanup = (): void => {
      el.style.transition = ''
      el.style.transform = ''
    }

    const settle = (): void => {
      // 位移不足 → 回弹回中间页
      el.style.transition = 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)'
      el.style.transform = BASE
      window.setTimeout(cleanup, 200)
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
      // 手指按下即预取两侧（命中缓存立即返回），滑动途中两侧页就绪
      void prefetchDay(addDays(selectedRef.current, -1))
      void prefetchDay(addDays(selectedRef.current, 1))
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
      el.style.transform = `translateX(calc(-33.3333% + ${dx}px))`
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
      // v8.15：先等目标页预取就绪再播过渡（touchstart 已预取过 → 命中缓存微秒返回；
      // 快速滑动时若未完成则短暂等待，避免滑到目标页仍是骨架白屏）。prefetch 期间忽略新手势（swipeBusy）。
      const target = addDays(selectedRef.current, dir)
      void prefetchDay(target).then(() => {
        if (!swipeBusy.current) return // 已被 touchcancel/新会话打断
        if (selectedRef.current !== addDays(target, -dir)) {
          // 等待期间 selected 被其他路径改变（如 Esc 返回）→ 放弃本次过渡，回弹
          swipeBusy.current = false
          settle()
          return
        }
        // 过渡目标位移：translateX(百分比) 相对轨道自身宽（300% = 3 屏）→ 显示第3段需 -2 屏 = -66.6667%，
        // 显示第1段需 0。⚠️ 曾误写 -133.3333%/66.6667%（= ±4/2 屏），滑到屏幕外 → 落地全白（v8.17 修复）。
        // 左滑：轨道向左一屏（右页进入）；右滑：向右一屏（左页进入）
        el.style.transition = `transform ${DUR}ms cubic-bezier(0.22, 1, 0.36, 1)`
        el.style.transform = dx < 0 ? 'translateX(-66.6667%)' : 'translateX(0%)'
        const finish = (ev: TransitionEvent): void => {
          if (ev.target !== el) return
          el.removeEventListener('transitionend', finish)
          swipeBusy.current = false
          swipeAnim.current = true
          shiftDay(dir)
          // selected 变化 → 上面的重排 effect 负责 setPages + 无动画复位（视觉无跳变）
        }
        el.addEventListener('transitionend', finish, { once: true })
      })
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
    }
  }, [shiftDay, prefetchDay])

  return (
    <>
      {source && (
        <div className={styles.daybar}>
          <button className={styles.backBtn} onClick={() => back()}>
            ← 返回
            <span className={styles.backSrc}>
              {source.view === 'week' ? '周视图' : source.view === 'month' ? '月视图' : '想法列表'}
            </span>
          </button>
        </div>
      )}
      <div className={styles.trackWrap}>
        <div className={styles.track} ref={trackRef} data-testid="day-scroll">
          <div className={styles.tpage}>
            <DaySide date={pages[0]} />
          </div>
          <div className={styles.tpage}>
            <DayFull />
          </div>
          <div className={styles.tpage}>
            <DaySide date={pages[2]} />
          </div>
        </div>
      </div>
    </>
  )
}

/** 中间页：当前选中日的完整视图（可交互：待办勾选/编辑、想法、习惯、顺延横幅、空态）。
 *  数据源 = dayCache.get(selected)（滑动预取/refresh 写入，恒为 selected 当日的完整 detail）兜底 store.detail。
 *  v8.15：翻页落地重排瞬间 store.detail 仍是旧日期的（refresh 异步），直接用会标题/内容错位或闪骨架，
 *  缓存优先保证落地即显示目标日真实内容；refresh 完成后 cache.set(selected, 新 detail) 无缝接管。
 *  v8.19：缓存条目携带 dataVer，过期（ver < dataVer，写操作/同步后）时兜底 store.detail（refresh 聚合的最新数据）。 */
function DayFull(): JSX.Element {
  const selected = useApp((s) => s.selected)
  const cached = useApp((s) => {
    const e = s.dayCache.get(selected)
    return e && e.ver >= s.dataVer ? e.detail : undefined
  })
  const detail = useApp((s) => s.detail)
  const today = useApp((s) => s.today)
  const rollDismissed = useApp((s) => s.rollDismissed)
  const rollOver = useApp((s) => s.rollOver)
  const dismissRoll = useApp((s) => s.dismissRoll)
  const edit = useApp((s) => s.edit)

  const effective = cached ?? detail
  if (!effective) {
    return (
      <div className={styles.pageInner}>
        <div className={styles.skels}><div className={styles.skel} /><div className={styles.skel} /><div className={styles.skel} /></div>
      </div>
    )
  }

  const { y, m, d } = fromKey(selected)
  const isToday = selected === today
  const lunarText = lunarFullText(effective.lunar)
  const lunarEmphasis = !!(effective.lunar?.festival || effective.lunar?.solarTerm)
  const showRoll = effective.prevDayRollable > 0 && !rollDismissed[selected]
  const dayWord = isToday ? '今天' : ''

  return (
    <div className={styles.pageInner}>
      <div className={styles.dhead}>
        <div className={styles.dtitle}>
          {y} 年 {m} 月 {d} 日
          <span className={styles.dow}>周{DOW[dowOf(selected)]}</span>
          {isToday && <span className={styles.todayMark}>今天</span>}
        </div>
        {(lunarText || effective.anniversaries.length > 0) && (
          <div className={styles.dsub}>
            {lunarText && (
              <span className={lunarEmphasis ? styles.fest : undefined}>{lunarText}</span>
            )}
            {effective.anniversaries.map((a) => (
              <span key={a.id} className={styles.anniBadge}>◷ {a.title}</span>
            ))}
          </div>
        )}
      </div>

      {showRoll && (
        <div className={styles.roll}>
          <span className={styles.rollText}>
            前一天还有 <b>{effective.prevDayRollable}</b> 件没做完
          </span>
          <button onClick={() => void rollOver()}>顺延</button>
          <button className={styles.ghostBtn} onClick={dismissRoll}>忽略</button>
        </div>
      )}

      <TodoSection dayWord={dayWord} />
      <HabitSection />
      <NoteSection dayWord={dayWord} />

      {effective.summary.isEmpty && !edit && (
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
  )
}

/** 两侧页：相邻日的只读摘要（滑动途中预览），无交互；数据未就绪显示轻骨架。
 *  v8.18：与落地内容对齐——待办/想法不再截断（全部显示，侧页可滚动）、
 *  补农历/纪念日副标题，途中看到的内容与松手后一致，减少"跳变"感。
 *  v8.19：条目过期（ver < dataVer，写操作/同步后、新聚合未完成）时不显示旧数据，显示骨架。 */
function DaySide({ date }: { date: DateKey }): JSX.Element {
  const detail = useApp((s) => {
    const e = s.dayCache.get(date)
    return e && e.ver >= s.dataVer ? e.detail : undefined
  })
  const today = useApp((s) => s.today)
  const { y, m, d } = fromKey(date)
  const isToday = date === today
  const lunarText = detail ? lunarFullText(detail.lunar) : ''
  const lunarEmphasis = !!(detail?.lunar?.festival || detail?.lunar?.solarTerm)

  return (
    <div className={styles.pageInner}>
      <div className={styles.dhead}>
        <div className={styles.dtitle}>
          {y} 年 {m} 月 {d} 日
          <span className={styles.dow}>周{DOW[dowOf(date)]}</span>
          {isToday && <span className={styles.todayMark}>今天</span>}
        </div>
        {detail && (lunarText || detail.anniversaries.length > 0) && (
          <div className={styles.dsub}>
            {lunarText && <span className={lunarEmphasis ? styles.fest : undefined}>{lunarText}</span>}
            {detail.anniversaries.map((a) => (
              <span key={a.id} className={styles.anniBadge}>◷ {a.title}</span>
            ))}
          </div>
        )}
      </div>
      {!detail ? (
        <div className={styles.skels}><div className={styles.skel} /><div className={styles.skel} /><div className={styles.skel} /></div>
      ) : (
        <>
          {detail.todos.filter((t) => !t.done).length > 0 && (
            <div className={styles.sideBlock}>
              <div className={styles.sideTitle}>待办</div>
              {detail.todos
                .filter((t) => !t.done)
                .map((t) => (
                  <div key={t.id} className={styles.sideItem}><span className={styles.sideDot} />{t.text}</div>
                ))}
            </div>
          )}
          {detail.notes.length > 0 && (
            <div className={styles.sideBlock}>
              <div className={styles.sideTitle}>想法</div>
              {detail.notes.map((n) => (
                <div key={n.id} className={styles.sideItem}>
                  <span className={styles.sideDot} />
                  {n.text.length > 44 ? `${n.text.slice(0, 44)}…` : n.text}
                </div>
              ))}
            </div>
          )}
          {detail.summary.isEmpty && (
            <div className={styles.empty}>○ 这一天还什么都没有</div>
          )}
        </>
      )}
    </div>
  )
}
