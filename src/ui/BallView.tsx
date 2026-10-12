/**
 * 桌面壳悬浮球（Tauri 收起态）：
 * 整窗渲染 DayCell logo，点击展开面板（414×896）。
 *
 * 仅 Tauri 环境且窗口宽度 <90px 时由 BallGate 渲染；网页端永不出现。
 * 展开用 onPointerDown 而非 onClick：未激活的窗口第一次按下就应立即展开，
 * 避免 macOS 首击只 focus 不派发 click、需要点多下的问题。
 */
import { useEffect } from 'react'
import type { JSX } from 'react'
import { invoke } from '@tauri-apps/api/core'
import styles from './BallView.module.css'

const LOGO = `${import.meta.env.BASE_URL}logo-hi.png`

export function BallView({ onExpand }: { onExpand?: () => void }): JSX.Element {
  // 悬浮球窗口不透明（conf backgroundColor #101014）：html/body 背景对齐窗口底色，
  // 避免与球底出现色差；面板态时由 BallGate 卸载本组件恢复。
  useEffect(() => {
    const root = document.documentElement
    const body = document.body
    const prevRoot = root.style.background
    const prevBody = body.style.background
    root.style.background = '#101014'
    body.style.background = '#101014'
    return () => {
      root.style.background = prevRoot
      body.style.background = prevBody
    }
  }, [])

  const expand = (): void => {
    onExpand?.()
    void invoke('set_mode', { mode: 'panel' })
  }

  return (
    <button
      type="button"
      className={styles.ball}
      onPointerDown={expand}
      aria-label="展开 DayCell"
      title="DayCell"
    >
      <img className={styles.logo} src={LOGO} alt="DayCell" draggable={false} />
    </button>
  )
}
