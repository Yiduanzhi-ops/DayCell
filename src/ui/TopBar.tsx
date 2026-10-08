/**
 * 顶栏：品牌（logo + DayCell，v7.6 去「人生小格」前缀）/ 前后翻页 / 标题 / 今天按钮 / **右上角菜单**（v7.5）。
 *
 * 标题内容按视图分叉（原型 renderTitle 的移植）：
 *  - 今天：**空**（v7.5 用户拍板：顶栏不重复显示日期周几，内容区已有完整日期）
 *  - 周：月份或跨月区间 + `28–4 日`
 *  - 月：`2026 年 9 月` + `N 天有记录 · ¥x`（月汇总，US-11）
 * 「今天」按钮只在选中日 ≠ 今天时出现（US-09）。
 * 翻页箭头在今天视图下由 CSS 隐藏——v7 起日视图不翻日（D19），行为层 shift() 也是 no-op。
 *
 * ## v7.5 右上角菜单（手机端同位置）——菜单项顺序（用户拍板，v8.3 加「分享与手册」、v8.4 加「版本更新」并移除「关于」占位）：
 * 导出备份 → 导入备份 → 一键导出 MD（点开弹本周/本月）→ 纪念日设置
 * → 习惯设置（v8.0）→ 同步设置（v8.1）→ 分隔线
 * → 分享与手册（v8.3）→ 版本更新（v8.4）→ 夜间模式（手动开关，最下面）
 * 菜单按钮（v8.4 起）：浅色圆角按钮 + 三横汉堡图标（原先的省略号太小不显眼）。
 * 导入走隐藏 <input type=file>；MD 二级菜单返回上级。
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { formatMoney, fromKey } from '@core'
import { useApp } from '@/app/context'
import { ChevronLeft, ChevronRight, MenuIcon } from './icons'
import { BrandMark } from './BrandMark'
import styles from './TopBar.module.css'

export function TopBar(): JSX.Element {
  const view = useApp((s) => s.view)
  const selected = useApp((s) => s.selected)
  const today = useApp((s) => s.today)
  const month = useApp((s) => s.month)
  const week = useApp((s) => s.week)
  const shift = useApp((s) => s.shift)
  const gotoToday = useApp((s) => s.gotoToday)

  // ---- v7.5 菜单 ----
  const theme = useApp((s) => s.theme)
  const setTheme = useApp((s) => s.setTheme)
  const openAnniv = useApp((s) => s.openAnniv)
  const openHabits = useApp((s) => s.openHabits)
  const openSync = useApp((s) => s.openSync)
  const openShare = useApp((s) => s.openShare)
  const openChangelog = useApp((s) => s.openChangelog)
  const exportBackup = useApp((s) => s.exportBackup)
  const importBackup = useApp((s) => s.importBackup)
  const exportMd = useApp((s) => s.exportMd)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mdOpen, setMdOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const closeMenu = (): void => {
    setMenuOpen(false)
    setMdOpen(false)
  }

  const { y, m } = fromKey(selected)
  let title = `${y} 年 ${m} 月`
  let sub = ''
  if (view === 'day') {
    // v7.5：今天视图顶栏只留品牌——日期与周几由内容区展示，避免重复（用户拍板）
    title = ''
  } else if (view === 'goals') {
    // v7.9：目标视图无日期语义
    title = '目标'
  } else if (view === 'week') {
    const a = week?.days[0] ? fromKey(week.days[0].date) : null
    const b = week?.days[6] ? fromKey(week.days[6].date) : null
    if (a && b) {
      title = a.m === b.m ? `${a.y} 年 ${a.m} 月` : `${a.m} 月 – ${b.m} 月`
      sub = `${a.d}–${b.d} 日`
    }
  } else if (month) {
    sub = `${month.summary.daysWithRecords} 天有记录 · ¥${formatMoney(month.summary.costCents)}`
  }

  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <BrandMark />
        <span>DayCell</span>
      </div>
      <div className={view === 'day' || view === 'goals' ? `${styles.nav} ${styles.navDay}` : styles.nav}>
        <button onClick={() => shift(-1)} aria-label="上一个" title="上一个">
          <ChevronLeft />
        </button>
        <button onClick={() => shift(1)} aria-label="下一个" title="下一个">
          <ChevronRight />
        </button>
      </div>
      <div className={styles.title}>
        {title}
        {sub && <small>{sub}</small>}
      </div>
      <div className={styles.spacer} />
      {view !== 'goals' && selected !== today && (
        <button className={styles.todayBtn} onClick={gotoToday}>
          今天
        </button>
      )}
      <button
        className={styles.menuBtn}
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="菜单"
        aria-expanded={menuOpen}
        title="菜单"
      >
        <MenuIcon />
      </button>

      {menuOpen && (
        <>
          <div className={styles.mask} onClick={closeMenu} />
          <div className={styles.menu} role="menu">
            {!mdOpen ? (
              <>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    void exportBackup()
                  }}
                >
                  导出备份
                </button>
                <button className={styles.mi} role="menuitem" onClick={() => fileRef.current?.click()}>
                  导入备份
                </button>
                <button className={styles.mi} role="menuitem" onClick={() => setMdOpen(true)}>
                  一键导出 MD
                </button>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    openAnniv()
                  }}
                >
                  纪念日设置
                </button>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    openHabits()
                  }}
                >
                  习惯设置
                </button>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    openSync()
                  }}
                >
                  同步设置
                </button>
                <div className={styles.sep} />
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    openShare()
                  }}
                >
                  分享与手册
                </button>
                <div className={styles.themeRow}>
                  <span>夜间模式</span>
                  <button
                    role="switch"
                    aria-checked={theme === 'dark'}
                    className={theme === 'dark' ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  >
                    <span className={styles.knob} />
                  </button>
                </div>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    openChangelog()
                  }}
                >
                  版本更新
                </button>
              </>
            ) : (
              <>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    void exportMd('week')
                  }}
                >
                  本周
                </button>
                <button
                  className={styles.mi}
                  role="menuitem"
                  onClick={() => {
                    closeMenu()
                    void exportMd('month')
                  }}
                >
                  本月
                </button>
                <button className={styles.mi} role="menuitem" onClick={() => setMdOpen(false)}>
                  ← 返回
                </button>
              </>
            )}
          </div>
        </>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = '' // 允许再次选择同一文件
          if (!f) return
          closeMenu()
          void importBackup(f)
        }}
      />
    </header>
  )
}
