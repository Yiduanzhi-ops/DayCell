/**
 * 应用外壳：横幅（E1 降级）+ 顶栏 + 主区（左日历 / 右日详情）+ Toast。
 *
 * 布局规则全部在 CSS（ADR-0005：不用 JS 判断设备类型做布局）：
 *  - 桌面 ≥900px：周/月 = 分栏（左日历 + 右 372px 日详情）；日 = 日历收起、详情占满
 *  - 手机 <900px：三视图各自全屏，非日视图时日详情 display:none
 * JS 只在**导航行为**上分叉（点格子是"切右栏"还是"跳日视图"），见 store.selectFromCalendar。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { StoreApi } from 'zustand'
import type { AppState } from '@/app/store'
import { AppStoreContext, useApp } from '@/app/context'
import { applyTheme } from '@/app/store'
import { ensureFirstVisitMarks } from './telemetry'
import { watchKeyboardInset } from './keyboardInset'
import { ensureSession, isCloudLoggedIn } from './cloudbase'
import { TopBar } from './TopBar'
import { TabBar } from './TabBar'
import { DayView } from './DayView'
import { WeekView } from './WeekView'
import { MonthView } from './MonthView'
import { AnnivSettings } from './AnnivSettings'
import { GoalsView } from './GoalsView'
import { NotesView } from './NotesView'
import { HabitsView } from './HabitsView'
import { SyncSettings } from './SyncSettings'
import { ShareView } from './ShareView'
import { AIImportView } from './AIImportView'
import { ChangelogView } from './ChangelogView'
import { SettingsView } from './SettingsView'
import { NotificationSettingsView } from './NotificationSettingsView'
import { AccountSettingsView } from './AccountSettingsView'
import { OnboardingView } from './OnboardingView'
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
  const habitsOpen = useApp((s) => s.habitsOpen)
  const syncOpen = useApp((s) => s.syncOpen)
  const shareOpen = useApp((s) => s.shareOpen)
  const aiOpen = useApp((s) => s.aiOpen)
  const changelogOpen = useApp((s) => s.changelogOpen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const notificationSettingsOpen = useApp((s) => s.notificationSettingsOpen)
  const accountOpen = useApp((s) => s.accountOpen)
  const openAccount = useApp((s) => s.openAccount)
  const onboardingOpen = useApp((s) => s.onboardingOpen)

  // v7.5 夜间模式：store 里 setTheme 已同步 localStorage 与 <html>；这里兜底保证
  // 挂载时（含 localStorage 被别的标签页改过）状态一致
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // v8.58 收费资格埋点：首次访问 / 试用起点时间戳，写入后不覆盖（将来收费区分老用户的历史证据）
  useEffect(() => {
    ensureFirstVisitMarks()
  }, [])

  // v8.61 全弹窗键盘适配：visualViewport → --kb-inset，弹窗随键盘顶起
  useEffect(() => watchKeyboardInset(), [])

  // v9.7 默认登录：启动恢复会话；无登录态时——从未选过「先本地体验」或跳过标记已超 30 天 → 打开登录引导页。
  // 本地体验标记为时间戳：点跳过时写入当前时间；30 天到期后再次引导（常驻轻提示兜底，见下方 localHint）。
  const SKIP_WINDOW = 30 * 24 * 3600 * 1000
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const type = await ensureSession()
      if (cancelled) return
      if (type === 'none') {
        let skipTs = 0
        try {
          const raw = localStorage.getItem('daycell_skip_login')
          if (raw) {
            const n = Number(raw)
            skipTs = Number.isFinite(n) && n > 0 ? n : 0 // 旧值 '1' 视为已过期
          }
        } catch {
          skipTs = 0
        }
        if (!skipTs || Date.now() - skipTs > SKIP_WINDOW) openAccount()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // v9.7 本地模式常驻轻提示：未登录时显示「未登录 · 数据仅在本机」，点击进登录页；
  // 可关闭（本次会话内不显示，下次打开再现）；登录成功后自动隐藏。
  const [localHint, setLocalHint] = useState(() => {
    if (isCloudLoggedIn()) return false
    try {
      return sessionStorage.getItem('daycell_dismiss_login_hint') !== '1'
    } catch {
      return true
    }
  })
  useEffect(() => {
    if (!accountOpen && isCloudLoggedIn() && localHint) setLocalHint(false)
  }, [accountOpen, localHint])

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
        case 'g': setView('goals'); break
        case 'n': setView('notes'); break
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
      {localHint && (
        <div className={styles.localHint} data-testid="local-hint">
          <button className={styles.localHintMain} onClick={openAccount}>
            未登录 · 数据仅在本机
          </button>
          <button
            className={styles.localHintClose}
            aria-label="关闭提示"
            onClick={() => {
              setLocalHint(false)
              try {
                sessionStorage.setItem('daycell_dismiss_login_hint', '1')
              } catch {
                // 隐私模式写失败：下次打开再显示
              }
            }}
          >
            ✕
          </button>
        </div>
      )}
      <div className={styles.main}>
        {/* v7.9：目标视图整屏替换日历 + 详情（无日期语义，不渲染 .cal/.detail）。v8.13：想法视图同 */}
        {view === 'goals' ? (
          <GoalsView />
        ) : view === 'notes' ? (
          <NotesView />
        ) : (
          <>
            <section className={styles.cal} aria-label="日历">
              {view === 'month' && <MonthView />}
              {view === 'week' && <WeekView />}
            </section>
            <aside className={styles.detail} aria-label="日详情">
              <DayView />
            </aside>
          </>
        )}
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
      {habitsOpen && <HabitsView />}
      {syncOpen && <SyncSettings />}
      {shareOpen && <ShareView />}
      {aiOpen && <AIImportView />}
      {changelogOpen && <ChangelogView />}
      {settingsOpen && <SettingsView />}
      {notificationSettingsOpen && <NotificationSettingsView />}
      {accountOpen && <AccountSettingsView />}
      {onboardingOpen && <OnboardingView />}
    </div>
  )
}
