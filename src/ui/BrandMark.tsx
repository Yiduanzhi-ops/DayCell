/**
 * 品牌 logo（v7.4 更换，用户拍板）：「小格」概念——accent 圆角方块 + 白色田字格线，
 * 右上格实心白（人生小格 = 被标记出的那一格）。与启动页 splash、PWA 图标同源图形。
 * 颜色用 var(--accent) 跟随主题；尺寸由使用处的 CSS 控制（.brand svg）。
 */
import type { JSX } from 'react'

export function BrandMark(): JSX.Element {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="var(--accent)" />
      <path d="M12 6.2v11.6M6.2 12h11.6" stroke="#fff" strokeWidth="1.7" opacity="0.9" />
      <rect x="12.8" y="6.4" width="5" height="5" rx="1.3" fill="#fff" />
    </svg>
  )
}
