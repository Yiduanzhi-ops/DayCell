/**
 * 底部视图切换器（v7.3 / v8.13）：固定页面底部。
 * v8.13：扩为 5 tab，从左到右 **目标 | 想法 | 今天（中间，圆形）| 周 | 月**；
 * 「今天」居中并做成圆形强调（原型图确认），其余四 tab 图标 + 文字竖排。
 * 桌面端共用同一组件（保持单一布局逻辑，D17 修订：切换器从顶栏移到底部）。
 * 快捷键 d/t/w/m/g/n 由 App.tsx 全局接管，与点 tab 等价；键盘用户仍有 title 提示。
 */
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './TabBar.module.css'

/** 想法 = 便签（折角纸片，v8.13 想法 tab） */
function NoteIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 4h14v13l-4 3H5z" />
      <path d="M15 20v-3h4" />
      <path d="M9 9h6M9 12.5h6" />
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

/** 目标 = 星形（v7.9 阶段性目标 tab，与原型 goals.html 一致） */
function GoalIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l2.4 5.2 5.6.8-4 4.1.9 5.7L12 16.4 7.1 19l.9-5.7-4-4.1 5.6-.8z" />
    </svg>
  )
}

export function TabBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const setView = useApp((s) => s.setView)

  // v8.13：5 tab，从左到右 目标 | 想法 | 今天（中间）| 周 | 月
  const tabs: ReadonlyArray<readonly [ViewKey, string]> = [
    ['goals', '目标'],
    ['notes', '想法'],
    ['day', '今天'],
    ['week', '周'],
    ['month', '月'],
  ]

  return (
    <nav className={styles.bar} role="tablist" aria-label="视图切换">
      {tabs.map(([v, label]) => (
        <button
          key={v}
          role="tab"
          aria-selected={view === v}
          className={view === v ? `${styles.tab} ${styles.on}` : styles.tab}
          onClick={() => setView(v)}
          title={v === 'day' ? '快捷键 d / t，回到今天' : `快捷键 ${v[0]}`}
        >
          {v === 'day' ? (
            <span className={styles.today} aria-hidden="true">今</span>
          ) : v === 'notes' ? (
            <NoteIcon />
          ) : v === 'week' ? (
            <WeekIcon />
          ) : v === 'month' ? (
            <MonthIcon />
          ) : (
            <GoalIcon />
          )}
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

type ViewKey = 'day' | 'week' | 'month' | 'goals' | 'notes'
