/**
 * 共享的内联 SVG 图标（ stroke 风格与原型一致）。
 * 不引图标库——总共就这么几个，内联最省字节（首屏预算 80 KB）。
 */
import type { JSX } from 'react'

export function ChevronLeft(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

export function ChevronRight(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

/** 勾选。size 10 用于日详情，8 用于周行 */
export function Check({ size = 10 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff"
      strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/** v8.4：顶栏右上角菜单按钮（三横/汉堡） */
export function MenuIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="3" y="5" width="18" height="2.2" rx="1.1" />
      <rect x="3" y="10.9" width="18" height="2.2" rx="1.1" />
      <rect x="3" y="16.8" width="18" height="2.2" rx="1.1" />
    </svg>
  )
}
