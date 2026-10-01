/**
 * 品牌 logo（v7.6 更换，用户提供）：「浅蓝渐变圆角方块 + 白色矩形对勾」应用图标。
 * 与启动页 splash、PWA 图标同源（public/logo.png，scripts/gen-logo-icons.py 生成）。
 * 尺寸由使用处的 CSS 控制（.brand img）；BASE_URL 适配 GitHub Pages 子路径。
 */
import type { JSX } from 'react'

const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`

export function BrandMark(): JSX.Element {
  return <img src={LOGO_URL} alt="" className={undefined} aria-hidden="true" />
}
