/**
 * 应用外壳：横幅（E1 降级）+ 顶栏 + 主区（左日历 / 右日详情）+ Toast。
 *
 * 布局规则全部在 CSS（ADR-0005：不用 JS 判断设备类型做布局）：
 *  - 桌面 ≥900px：周/月 = 分栏（左日历 + 右 372px 日详情）；日 = 日历收起、详情占满
 *  - 手机 <900px：三视图各自全屏，非日视图时日详情 display:none
 * JS 只在**导航行为**上分叉（点格子是"切右栏"还是"跳日视图"），见 store.selectFromCalendar。
 */
import { useEffect } from 'react'
import type { JSX } from 'react'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/app/store'
import { AppStoreContext, useApp } from '@/app/context'
import { applyTheme } from '@/app/store'
import { TopBar } from './TopBar'
import { TabBar } from './TabBar'
import { DayView } from './DayView'
import { WeekView } from './WeekView'
import { MonthView } from './MonthView'
import { AnnivSettings } from './AnnivSettings'
import styles from './App.module.css'

export function App({ store }: { store: StoreApi<AppState> }): JSX.Element {
  return (
    <AppStoreContext.Provider value={store}>
      <Shell />
    </AppStoreContext.Provider>
  )
}

function Shell(): JSX.Element {
  const view = useApp((s) => s.view)
  const degraded = useApp((s) => s.degraded)
  const toast = useApp((s) => s.toast)
  const clearToast = useApp((s) => s.clearToast)
  const edit = useApp((s) => s.edit)
  const closeForm = useApp((s) => s.closeForm)
  const back = useApp((s) => s.back)
  const setView = useApp((s) => s.setView)
  const shift = useApp((s) => s.shift)
  const onPopstate = useApp((s) => s.onPopstate)
  const theme = useApp((s) => s.theme)
  const annivOpen = useApp((s) => s.annivOpen)

  // v7.5 夜间模式：store 里 setTheme 已同步 localStorage 与 <html>；这里兜底保证
  // 挂载时（含 localStorage 被别的标签页改过）状态一致
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // 全局快捷键（S4 / D17·v7）：j/k、←/→ 翻周/月（今天视图 no-op），d/t 回今天、w 周、m 月，
  // Esc 收起表单或返回。输入控件聚焦时跳过（表单里 Enter/Esc 有自己的语义）；IME 组合中跳过，
  // 否则中文输入按回车确认候选词会误触发保存/翻页。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.isComposing) return
      switch (e.key) {
        case 'j': case 'ArrowRight': shift(1); break
        case 'k': case 'ArrowLeft': shift(-1); break
        case 'd': case 't': setView('day'); break
        case 'w': setView('week'); break
        case 'm': setView('month'); break
        case 'Escape':
          if (edit) closeForm()
          else back()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shift, setView, edit, closeForm, back])

  // 系统手势返回（手机三条返回路径之二，ADR-0005：不能只依赖按钮和键盘）
  useEffect(() => {
    window.addEventListener('popstate', onPopstate)
    return () => window.removeEventListener('popstate', onPopstate)
  }, [onPopstate])

  // toast 1.9s 自动消失（与原型一致）
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(clearToast, 1900)
    return () => clearTimeout(t)
  }, [toast, clearToast])

  return (
    <div className={styles.app} data-view={view}>
      {degraded && (
        <div className={styles.banner} role="alert">
          浏览器存储不可用，当前数据<b>不会被保存</b>（刷新即丢）。
        </div>
      )}
      <TopBar />
      <div className={styles.main}>
        <section className={styles.cal} aria-label="日历">
          {view === 'month' && <MonthView />}
          {view === 'week' && <WeekView />}
        </section>
        <aside className={styles.detail} aria-label="日详情">
          <DayView />
        </aside>
      </div>
      <TabBar />
      <div
        className={toast ? `${styles.toast} ${styles.on}` : styles.toast}
        role="status"
        aria-live="polite"
      >
        {toast?.msg ?? ''}
      </div>
      {annivOpen && <AnnivSettings />}
    </div>
  )
}
