/**
 * 桌面壳（Tauri）形态切换门：窗口宽度 <90px（悬浮球态）渲染 BallView，
 * 否则渲染正常 App。网页端（非 Tauri）永远渲染 children。
 *
 * 悬浮球展开/收回时后端改窗口尺寸 → resize 事件 → 这里自动切换。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { BallView } from './BallView'

const IS_TAURI = Boolean(import.meta.env.VITE_TAURI)
const BALL_MAX_W = 90 // 悬浮球窗口宽 52，面板 390；阈值取中间值

function isBallWidth(): boolean {
  return window.innerWidth < BALL_MAX_W
}

export function BallGate({ children }: { children: JSX.Element }): JSX.Element {
  const [isBall, setIsBall] = useState(() => IS_TAURI && isBallWidth())

  useEffect(() => {
    if (!IS_TAURI) return
    const onResize = (): void => setIsBall(isBallWidth())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (isBall) return <BallView />
  return children
}
