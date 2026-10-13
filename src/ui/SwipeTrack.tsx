/**
 * v8.34 通用三页轨道滑动容器（周/月视图共用）。
 *
 * 机制与 DayView 的日滑动同源（v8.12–v8.21 多轮迭代收敛的标准）：
 *  - 轨道恒渲染 上一页/当前/下一页 三屏（各占一屏宽），相邻页藏在屏幕外；
 *  - 触摸跟手 = 整条轨道平移，**滑动途中可见两侧真实内容**（原生日历手感）；
 *  - 松手超阈值滑到目标页：先等目标页预取就绪再播过渡（避免落地白屏/骨架），
 *    过渡结束调 flip(dir) 让 store 换周/月，selected 变化触发重排 effect 无动画复位；
 *  - swipeBusy 防重入（过渡/预取期间忽略新手势）；swipeAnim 标记滑动翻页（重排不走入场动画）；
 *  - 桌面无手势时轨道静止 = 单页外观（周/月原左右箭头照常可用）。
 *
 * 使用方职责：prevOf/nextOf 给出上一/下一页 key（周 ±7 天、月 ±1 月），
 * prefetch 预取某页聚合入 weekCache/monthCache，flip(dir) 调 store.shift（周/月语义在 store 侧），
 * renderPage(k, role) 渲染一屏完整内容（role='center' 当前页可交互，'side' 两侧页只读）。
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import styles from './SwipeTrack.module.css'

/** 中间页相对轨道起点的位移。轨道宽 300%（3 屏），translateX 百分比相对轨道自身宽 */
const BASE = 'translateX(-33.3333%)'

export interface SwipeTrackProps<K> {
  /** 当前页 key（周：该周内任意日期；月：该月内任意日期） */
  current: K
  /** 上一页 key */
  prevOf: (k: K) => K
  /** 下一页 key */
  nextOf: (k: K) => K
  /** 预取某页聚合数据（写入对应内存缓存；命中缓存立即返回） */
  prefetch: (k: K) => Promise<void>
  /** 松手确认换页：调用 store 换周/月 action（view 语义由调用方决定） */
  flip: (dir: 1 | -1) => void
  /** 渲染一屏完整内容 */
  renderPage: (k: K, role: 'center' | 'side') => ReactNode
  /** 轨道 data-testid（中间屏为 `${testId}-center`） */
  testId?: string
}

export function SwipeTrack<K>({
  current,
  prevOf,
  nextOf,
  prefetch,
  flip,
  renderPage,
  testId,
}: SwipeTrackProps<K>): JSX.Element {
  const [pages, setPages] = useState<[K, K, K]>(() => [prevOf(current), current, nextOf(current)])
  const trackRef = useRef<HTMLDivElement>(null)
  const firstRender = useRef(true)
  const swipeBusy = useRef(false) // 轨道过渡/预取中，忽略新手势
  const swipeAnim = useRef(false) // 本次 current 变化由滑动引起：重排无动画复位
  // 回调与 current 存 ref：手势/重排闭包读最新版本，effect 依赖保持最小（防回调引用漂移导致重跑）
  const currentRef = useRef(current)
  currentRef.current = current
  const prevOfRef = useRef(prevOf)
  prevOfRef.current = prevOf
  const nextOfRef = useRef(nextOf)
  nextOfRef.current = nextOf
  const prefetchRef = useRef(prefetch)
  prefetchRef.current = prefetch
  const flipRef = useRef(flip)
  flipRef.current = flip

  // 挂载 / current 变化：重排三页 + 预取相邻 + 复位轨道。
  // 滑动翻页（swipeAnim）走无动画复位（内容在过渡时已停在目标页）；其他换页播入场动画。
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const prev = prevOfRef.current(current)
    const next = nextOfRef.current(current)
    setPages([prev, current, next])
    void prefetchRef.current(prev)
    void prefetchRef.current(next)
    if (firstRender.current || swipeAnim.current) {
      firstRender.current = false
      swipeAnim.current = false
      el.style.transition = 'none'
      el.style.transform = BASE
      return
    }
    el.style.transition = 'none'
    el.style.transform = BASE
    if (
      typeof el.animate === 'function' &&
      !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    ) {
      void el.animate(
        [
          { transform: 'translateX(calc(-33.3333% + 24px))', opacity: 0.35 },
          { transform: BASE, opacity: 1 },
        ],
        { duration: 180, easing: 'cubic-bezier(0.25, 0.8, 0.35, 1)' },
      )
    }
  }, [current])

  // 触摸滑动（与 DayView 同机制）：touchstart 预取两侧 → touchmove 跟手（竖向为主放弃手势交给滚动）
  // → touchend 阈值判定：够则等目标页预取就绪 → 播过渡 → transitionend 调 flip；不足回弹。
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
      void prefetchRef.current(prevOfRef.current(currentRef.current))
      void prefetchRef.current(nextOfRef.current(currentRef.current))
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
      // 先等目标页预取就绪再播过渡（touchstart 已预取过 → 命中缓存微秒返回；
      // 快速滑动时若未完成则短暂等待，避免滑到目标页仍是骨架白屏）
      const target = dir === 1 ? nextOfRef.current(currentRef.current) : prevOfRef.current(currentRef.current)
      void prefetchRef.current(target).then(() => {
        if (!swipeBusy.current) return // 已被 touchcancel/新会话打断
        // 等待期间 current 被其他路径改变（如点箭头/点格子）→ 放弃本次过渡，回弹
        const expectBack = dir === 1 ? prevOfRef.current(target) : nextOfRef.current(target)
        if (currentRef.current !== expectBack) {
          swipeBusy.current = false
          settle()
          return
        }
        // 过渡目标位移：显示第3段需 -2 屏 = -66.6667%，显示第1段需 0（相对轨道自身宽 300%）。
        // 左滑：轨道向左一屏（右页进入）；右滑：向右一屏（左页进入）
        el.style.transition = `transform ${DUR}ms cubic-bezier(0.22, 1, 0.36, 1)`
        el.style.transform = dx < 0 ? 'translateX(-66.6667%)' : 'translateX(0%)'
        const finish = (ev: TransitionEvent): void => {
          if (ev.target !== el) return
          el.removeEventListener('transitionend', finish)
          swipeBusy.current = false
          swipeAnim.current = true
          flipRef.current(dir)
          // current 变化 → 上面的重排 effect 负责 setPages + 无动画复位（视觉无跳变）
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
  }, [])

  return (
    <div className={styles.trackWrap}>
      <div className={styles.track} ref={trackRef} data-testid={testId}>
        <div className={`${styles.tpage} ${styles.readonly}`}>{renderPage(pages[0], 'side')}</div>
        <div className={styles.tpage} data-testid={testId ? `${testId.replace(/-scroll$/, '')}-center` : undefined}>
          {renderPage(pages[1], 'center')}
        </div>
        <div className={`${styles.tpage} ${styles.readonly}`}>{renderPage(pages[2], 'side')}</div>
      </div>
    </div>
  )
}
