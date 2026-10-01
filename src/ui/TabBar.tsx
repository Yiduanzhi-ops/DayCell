/**
 * 底部视图切换器（v7.3）：固定页面底部，今天/周/月三 tab。
 * 手机端风格：图标 + 文字竖排、active 高亮 accent 色 + 顶部指示条；
 * 桌面端共用同一组件（保持单一布局逻辑，D17 修订：切换器从顶栏移到底部）。
 * 快捷键 d/t/w/m 由 App.tsx 全局接管，与点 tab 等价；键盘用户仍有 title 提示。
 */
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './TabBar.module.css'

/** 今天 = 时钟（"现在"） */
function TodayIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.8 2" />
    </svg>
  )
}

/** 周 = 四条横线（一周七行的抽象） */
function WeekIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M4 6.5h16M4 11.5h16M4 16.5h16M4 21h8" />
    </svg>
  )
}

/** 月 = 网格（42 格月历的抽象） */
function MonthIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M4 10h16M10 4v16" />
    </svg>
  )
}

export function TabBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)

  const tabs: ReadonlyArray<readonly [ViewKey, string, JSX.Element]> = [
    ['day', '今天', <TodayIcon key="i" />],
    ['week', '周', <WeekIcon key="i" />],
    ['month', '月', <MonthIcon key="i" />],
  ]

  return (
    <nav className={styles.bar} role="tablist" aria-label="视图切换">
      {tabs.map(([v, label, icon]) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          className={view === v ? `${styles.tab} ${styles.on}` : styles.tab}
          onClick={() => setView(v)}
          title={v === 'day' ? '快捷键 d / t，回到今天' : `快捷键 ${v[0]}`}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

type ViewKey = 'day' | 'week' | 'month'
