/**
 * 应用层状态机（Zustand vanilla store；React 绑定见 context.ts）。
 *
 * 职责（SPEC §3 / ADR-0005 v6，**v7 修订**）：
 *  - **视图（今天/周/月）与选中日期的单一真相**：v7 起「日视图」并入「今天」——
 *    今天标签恒显示今天；其他日子的日详情只能从周/月点格子进入（selected 跟随格子）
 *  - **一层来源栈**：手机从周/月点格子进日详情时记住 {view, date, scrollTop}，
 *    返回时精确还原——不得把人扔回今天（原型 v5.1 sheet 事故的 v6 变形防线）
 *  - **history 协作**：进日详情 push 一条；周/月翻页**绝不 push**（否则按一次返回
 *    只退一页，永远退不出当前视图）；popstate → back()
 *  - 所有写操作走 repo，成功后 refresh() 重新加载当前视图的聚合数据
 *
 * ⚠️ 本文件在**纯 Node 测试环境**里也会被 import：所有 window/history/matchMedia
 *    访问都必须typeof 守卫或注入（isNarrow 可注入正是为此）。
 */
import { createStore, type StoreApi } from 'zustand'
import {
  addDays,
  addMonths,
  formatMoney,
  isDayCellError,
  mergeBackup,
  monthKeys,
  parseBackup,
  rangeKeys,
  renderRangeMd,
  serializeBackup,
  today as todayKey,
  weekKeys,
  type AnniversaryInput,
  type AnniversaryRecord,
  type CategoryRecord,
  type DateKey,
  type DayAggregate,
  type DayDetail,
  type GoalRecord,
  type GoalSummary,
  type HabitDay,
  type HabitFreq,
  type HabitRecord,
  type MonthSummary,
  type StageInput,
  type StageRecord,
  type SubtaskInput,
  type SubtaskRecord,
  type WeekDay,
  type WeekTotal,
  type SyncEngine,
  type SyncStatus,
  type GiteeConfig,
} from '@core'
import type { CoreBundle } from './bootstrap'
import { buildTransport, readSyncConfig, writeSyncConfig } from './sync'

export type View = 'day' | 'week' | 'month' | 'goals'
/** v6.1：内联表单是唯一录入入口，同一时刻最多展开一个 */
export type FormKind = 'todo' | 'cost' | 'note'

export interface SourceState {
  view: 'week' | 'month'
  selected: DateKey
  scrollTop: number
}

export interface ToastState {
  msg: string
  /** 每次 +1，让相同文案也能重新触发 Toast 的动画/计时 */
  seq: number
}

export interface AppState {
  today: DateKey
  view: View
  selected: DateKey
  source: SourceState | null
  /** 有一条自己 push 且尚未弹掉的 history 条目 */
  historyPushed: boolean
  /** 返回来源视图后要还原的滚动位置；由 Week/MonthView 挂载时消费一次 */
  restoreScrollTo: number | null

  detail: DayDetail | null
  week: { days: WeekDay[]; total: WeekTotal } | null
  month: { days: DayAggregate[]; summary: MonthSummary } | null
  cats: CategoryRecord[]
  /** v7.5：纪念日设置页列表（打开页面时加载，刷新随 CRUD） */
  annivList: AnniversaryRecord[]
  /** v7.9：目标列表（目标 tab 数据源） */
  goalList: GoalSummary[]
  /** v7.9：打开中的目标详情（null = 目标列表页）。v8.5 加 subtasks（阶段/子任务双视图） */
  goalDetail: { goal: GoalRecord; stages: StageRecord[]; subtasks: SubtaskRecord[] } | null
  /** v8.0：今日习惯（selected 日该做的习惯 + 打卡状态） */
  habitDay: HabitDay | null
  /** v8.0：习惯设置页列表（全部活习惯，含暂停的） */
  habitList: HabitRecord[]

  /** IndexedDB 不可用（PRD E1）：数据不持久，UI 顶部红色横幅 */
  degraded: boolean
  /** 农历加载失败（PRD E4）：v0 暂不单独提示，标签自动留空 */
  lunarFailed: boolean
  loading: boolean
  toast: ToastState | null

  /** v7.5：夜间模式。手动开关（不跟随系统），持久化在 localStorage */
  theme: 'light' | 'dark'
  /** v7.5：纪念日设置页是否打开（全屏覆盖层） */
  annivOpen: boolean
  /** v8.0：习惯设置页是否打开（全屏覆盖层，菜单「习惯设置」进入） */
  habitsOpen: boolean
  /** v8.1：同步设置页是否打开（全屏覆盖层，菜单「同步设置」进入） */
  syncOpen: boolean
  /** v8.3：分享与手册页是否打开（全屏覆盖层，菜单「分享与手册」进入） */
  shareOpen: boolean
  /** v8.4：版本更新页是否打开（全屏覆盖层，菜单「版本更新」进入） */
  changelogOpen: boolean
  /** v8.1：同步引擎最近状态（设置页展示；null = 未创建引擎） */
  syncStatus: SyncStatus | null
  /** v8.1：当前已保存的同步配置（打开设置页时读入） */
  syncConfig: GiteeConfig | null

  edit: FormKind | null
  /** 请求聚焦当前表单并 scrollIntoView；DayView 渲染后消费一次 */
  wantFocus: boolean
  /** 已点「忽略」顺延横幅的日期（会话级） */
  rollDismissed: Record<string, true>
  /** 上次记支出选的分类（S5，会话级）——v7.6 录入不再选分类，字段保留待将来恢复 */
  lastCatId: string | null

  // ---- actions ----
  init(): Promise<void>
  refresh(): Promise<void>
  setView(v: View): void
  gotoToday(): void
  /** 翻页：周 ±7 天 / 月 ±1 月（US-09）。**日视图 no-op**——v7 起今天视图不翻日 */
  shift(dir: 1 | -1): void
  /** 点周/月的格子。窄屏跳进日视图并记来源；宽屏只切换右栏 */
  selectFromCalendar(k: DateKey, scrollTop?: number): void
  /** 返回来源视图。没有来源时返回 false（Esc 等路径靠它判断有没有事发生） */
  back(): boolean
  onPopstate(): void
  openForm(f: FormKind): void
  closeForm(): void
  consumeFocus(): void
  consumeRestoreScroll(): void
  createTodo(text: string): Promise<boolean>
  toggleTodo(id: string): Promise<void>
  /** 就地编辑待办文字（v7 / US-13 / 原 C3）。失败返回 false 并 toast core 文案 */
  updateTodoText(id: string, text: string): Promise<boolean>
  deleteTodo(id: string): Promise<void>
  createNote(text: string): Promise<boolean>
  /** 就地编辑想法正文（v7 / US-13 / 原 C3） */
  updateNoteText(id: string, text: string): Promise<boolean>
  deleteNote(id: string): Promise<void>
  createExpense(cents: number, catId: string, note: string): Promise<boolean>
  deleteExpense(id: string): Promise<void>
  rollOver(): Promise<void>
  dismissRoll(): void
  showToast(msg: string): void
  clearToast(): void

  // ---- v7.5：菜单 / 主题 / 备份 / 纪念日 ----
  setTheme(t: 'light' | 'dark'): void
  /** 加载纪念日列表（设置页打开/CRUD 后调用） */
  refreshAnniv(): Promise<void>
  openAnniv(): void
  closeAnniv(): void
  /** 导出整库 JSON 备份（PRD M14）。浏览器里触发下载 */
  exportBackup(): Promise<boolean>
  /** 从 JSON 备份**合并**导入（PRD M15，v7.5 用户口径：按 id 去重，不覆盖本地） */
  importBackup(file: { name?: string; text(): Promise<string> }): Promise<boolean>
  /** 一键导出 Markdown：kind='week' 本周 / 'month' 本月 */
  exportMd(kind: 'week' | 'month'): Promise<boolean>
  createAnniversary(input: AnniversaryInput): Promise<boolean>
  updateAnniversary(id: string, patch: Partial<AnniversaryInput>): Promise<boolean>
  deleteAnniversary(id: string): Promise<boolean>

  // ---- v7.9：阶段目标（底部 tab「目标」） ----
  /** 目标列表（目标 tab 打开/切换/写操作后刷新） */
  refreshGoals(): Promise<void>
  /** 进入目标详情：加载目标 + 其全部阶段 */
  openGoal(id: string): Promise<void>
  closeGoal(): void
  createGoal(title: string, note: string): Promise<boolean>
  updateGoal(id: string, patch: { title?: string; note?: string }): Promise<boolean>
  /** 目标整体完成/取消完成（完成的目标沉底到「已完成」列表） */
  setGoalDone(id: string, done: boolean): Promise<boolean>
  /** 删目标（连带其全部阶段，repo 维护） */
  deleteGoal(id: string): Promise<boolean>
  createStage(input: StageInput): Promise<boolean>
  updateStage(id: string, patch: Partial<Omit<StageInput, 'goalId' | 'pct'>> & { pct?: number | null }): Promise<boolean>
  /** 设为当前（同目标互斥） */
  setCurrentStage(id: string): Promise<boolean>
  setStageDone(id: string, done: boolean): Promise<boolean>
  deleteStage(id: string): Promise<boolean>
  // ---- v8.5：子任务（阶段/子任务双视图） ----
  createSubtask(input: SubtaskInput): Promise<boolean>
  updateSubtask(id: string, patch: { title: string }): Promise<boolean>
  setSubtaskDone(id: string, done: boolean): Promise<boolean>
  deleteSubtask(id: string): Promise<boolean>

  // ---- v8.0：习惯（今日视图区块 + 菜单「习惯设置」） ----
  /** 刷新习惯设置页列表（打开/CRUD 后调用） */
  refreshHabits(): Promise<void>
  openHabits(): void
  closeHabits(): void
  createHabit(input: { name: string; freq: HabitFreq }): Promise<boolean>
  updateHabit(id: string, patch: Partial<{ name: string; freq: HabitFreq; paused: boolean }>): Promise<boolean>
  deleteHabit(id: string): Promise<boolean>
  /** 打卡/取消（纯勾选）；成功后刷新今日习惯 */
  toggleHabit(date: DateKey, habitId: string): Promise<void>

  // ---- v8.1：坚果云同步 ----
  openSync(): void
  closeSync(): void
  /** 保存同步配置（localStorage + 引擎重建 + 立即同步一次） */
  saveSyncConfig(cfg: GiteeConfig): Promise<boolean>
  /** 手动「立即同步」（pull + push） */
  syncNow(): Promise<boolean>

  // ---- v8.3：分享与手册 ----
  openShare(): void
  closeShare(): void

  // ---- v8.4：版本更新 ----
  openChangelog(): void
  closeChangelog(): void
}

export interface AppStoreOptions {
  /** 注入的"今天"（测试用固定值）；缺省用真实时钟 */
  today?: DateKey
  /** 窄屏判定（< 900px）。缺省用 matchMedia；测试注入固定值 */
  isNarrow?: () => boolean
  /** v8.1：同步引擎（main.tsx 创建后传入；测试可不传） */
  sync?: SyncEngine | null
  /** v8.1：engine.onStatus 的注入点（engine 先于 store 创建，经闭包 sink 接上） */
  onSyncStatus?: (fn: (s: SyncStatus) => void) => void
}

/** 断点与 CSS 一致（ADR-0005：布局归 CSS 媒体查询，这里只用于**导航行为**分叉） */
export const defaultIsNarrow = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 899.98px)').matches
}

const errMsg = (e: unknown): string =>
  isDayCellError(e) ? e.message : '操作失败，请重试'

// ---------------------------------------------------------------------------
// v7.5：夜间模式（手动开关，localStorage 持久化，不跟随系统）
// ---------------------------------------------------------------------------

const THEME_KEY = 'daycell-theme'

export const readTheme = (): 'light' | 'dark' => {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY) === 'dark') return 'dark'
  return 'light'
}

/** 应用主题到 <html data-theme> 与 theme-color meta（splash 与 PWA 状态栏同步） */
export function applyTheme(t: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = t
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', t === 'dark' ? '#141518' : '#FFFFFF')
}

const downloadText = (filename: string, text: string, mime: string): void => {
  if (typeof document === 'undefined') return // Node 测试环境不真下载
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function createAppStore(
  bundle: CoreBundle,
  opts: AppStoreOptions = {},
): StoreApi<AppState> {
  const { repos, aggregates } = bundle
  const narrow = opts.isNarrow ?? defaultIsNarrow
  const syncEngine = opts.sync ?? null
  /** 并发保护：快速翻页时旧响应不得覆盖新状态 */
  let loadSeq = 0
  let toastSeq = 0

  const canHistory = (): boolean => typeof globalThis.history?.pushState === 'function'

  const api = createStore<AppState>()((set, get) => ({
    today: opts.today ?? todayKey(),
    view: 'day',
    selected: opts.today ?? todayKey(),
    source: null,
    historyPushed: false,
    restoreScrollTo: null,

    detail: null,
    week: null,
    month: null,
    cats: [],
    annivList: [],
    goalList: [],
    goalDetail: null,
    habitDay: null,
    habitList: [],

    degraded: bundle.degraded,
    lunarFailed: bundle.lunarFailed,
    loading: true,
    toast: null,

    theme: readTheme(),
    annivOpen: false,
    habitsOpen: false,
    syncOpen: false,
    shareOpen: false,
    changelogOpen: false,
    syncStatus: syncEngine?.status() ?? null,
    syncConfig: null,

    edit: null,
    wantFocus: false,
    rollDismissed: {},
    lastCatId: null,

    async init() {
      set({ loading: true })
      try {
        const cats = await repos.categories.all()
        set({ cats, lastCatId: cats[0]?.id ?? null })
      } catch (e) {
        get().showToast(errMsg(e))
      }
      await get().refresh()
    },

    async refresh() {
      const seq = ++loadSeq
      const { selected, view } = get()
      try {
        // v7.9 目标视图：不加载日历聚合，只刷目标列表（goalList 是它的唯一数据源）
        if (view === 'goals') {
          const goalList = await aggregates.goalSummaries()
          if (seq !== loadSeq) return
          set({ goalList, loading: false })
          return
        }
        // detail 恒加载（桌面分栏右栏 / 手机日视图都要）；日历数据按当前视图加载
        const [detail, week, monthDays, monthSum, habitDay] = await Promise.all([
          aggregates.aggregateDayDetail(selected),
          view === 'week' ? aggregates.aggregateWeek(selected) : Promise.resolve(null),
          view === 'month' ? aggregates.aggregateMonth(selected) : Promise.resolve(null),
          view === 'month' ? aggregates.monthSummary(selected) : Promise.resolve(null),
          // v8.0：习惯按选中日显示（今天视图 = 今天该做的习惯）
          aggregates.habitDay(selected),
        ])
        if (seq !== loadSeq) return // 已有更新的加载在飞，丢弃过期结果

        const patch: Partial<AppState> = {
          detail,
          week,
          month: monthDays ? { days: monthDays, summary: monthSum! } : null,
          habitDay,
          loading: false,
        }

        set(patch)
      } catch (e) {
        if (seq !== loadSeq) return
        set({ loading: false })
        get().showToast(errMsg(e))
      }
    },

    setView(v) {
      const s = get()
      if (s.view === v) return
      // 主动切视图不是"返回"：清来源栈，并弹掉之前压的 history 条目（否则它会变成幽灵，
      // 下一次系统返回会被它吃掉）。popstate 到来时 source 已是 null，back() 自然无操作。
      const needPop = s.historyPushed
      // v7：日视图 = 今天。「今天」标签从任何状态按下都回到今天（D16/D19）；
      // 周/月之间切换仍然保留选中日期（D17）
      const nextSelected = v === 'day' ? s.today : s.selected
      set({
        view: v,
        selected: nextSelected,
        source: null,
        historyPushed: false,
        edit: null,
        wantFocus: false,
        // 切回目标 tab 一律回列表（详情页不跨 tab 保持）
        goalDetail: v === 'goals' ? null : s.goalDetail,
      })
      if (needPop && canHistory()) history.back()
      void get().refresh()
    },

    gotoToday() {
      const s = get()
      if (s.selected === s.today) return
      set({ selected: s.today, edit: null, wantFocus: false })
      void get().refresh()
    },

    shift(dir) {
      const s = get()
      // v7：今天视图不翻日（D19）——补记其他日子走周/月点格子。
      // 顶栏的翻页按钮在日视图下由 CSS 隐藏，这里是行为层的同一事实。
      // v7.9：目标视图无日期语义，翻页同样 no-op。
      if (s.view === 'day' || s.view === 'goals') return
      const next = s.view === 'week' ? addDays(s.selected, dir * 7) : addMonths(s.selected, dir)
      if (next === s.selected) return
      set({ selected: next, edit: null, wantFocus: false })
      void get().refresh()
    },

    selectFromCalendar(k, scrollTop = 0) {
      const s = get()
      if (narrow() && s.view !== 'day') {
        // 手机：跳进全屏日视图并记住来源（ADR-0005 v6 硬约束）
        if (canHistory()) history.pushState({ daycell: 'day' }, '')
        set({
          source: { view: s.view as 'week' | 'month', selected: s.selected, scrollTop },
          selected: k,
          view: 'day',
          historyPushed: true,
          edit: null,
          wantFocus: false,
        })
      } else {
        // 桌面分栏：只切换右栏内容，不打断日历
        if (k === s.selected) return
        set({ selected: k, edit: null, wantFocus: false })
      }
      void get().refresh()
    },

    back() {
      const s = get()
      if (!s.source) return false
      const src = s.source
      const needPop = s.historyPushed
      set({
        source: null,
        view: src.view,
        selected: src.selected,
        historyPushed: false,
        edit: null,
        wantFocus: false,
        restoreScrollTo: src.scrollTop,
      })
      void get().refresh()
      // 手势返回（popstate）进来时条目已被浏览器弹掉，needPop 为 false，不会二次 back
      if (needPop && canHistory()) history.back()
      return true
    },

    onPopstate() {
      if (!get().historyPushed) return // 不是我们压的条目（或已弹掉），不处理
      set({ historyPushed: false })
      get().back()
    },

    openForm(f) {
      const s = get()
      if (s.edit === f) {
        // 再点一次同一个「+ 添加」= 收起
        set({ edit: null, wantFocus: false })
      } else {
        set({ edit: f, wantFocus: true })
      }
    },

    closeForm() {
      if (!get().edit) return
      set({ edit: null, wantFocus: false })
    },

    consumeFocus() {
      set({ wantFocus: false })
    },

    consumeRestoreScroll() {
      set({ restoreScrollTo: null })
    },

    // ---- 写操作：repo 校验（失败抛 DayCellError → toast 中文文案）→ refresh ----

    async createTodo(text) {
      try {
        await repos.todos.create(get().selected, text)
        await get().refresh()
        get().showToast('已添加待办')
        return true // 表单保留并清空，方便连续录入（US-06）
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async toggleTodo(id) {
      try {
        const t = await repos.todos.toggle(id)
        await get().refresh()
        if (t.done) get().showToast('完成了一件')
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    async updateTodoText(id, text) {
      try {
        await repos.todos.setText(id, text)
        await get().refresh()
        get().showToast('已更新待办')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteTodo(id) {
      try {
        await repos.todos.softDelete(id)
        await get().refresh()
        get().showToast('已删除')
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    async createNote(text) {
      try {
        await repos.notes.create(get().selected, text)
        await get().refresh()
        get().showToast('已记下这个想法')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async updateNoteText(id, text) {
      try {
        await repos.notes.setText(id, text)
        await get().refresh()
        get().showToast('已更新想法')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteNote(id) {
      try {
        await repos.notes.softDelete(id)
        await get().refresh()
        get().showToast('已删除')
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    async createExpense(cents, catId, note) {
      try {
        const rec = await repos.expenses.create(get().selected, { amountCents: cents, catId, note })
        set({ lastCatId: catId }) // S5：下次默认选中同一分类
        await get().refresh()
        const name = get().cats.find((c) => c.id === catId)?.name ?? ''
        get().showToast(`${name} ¥${formatMoney(rec.amountCents)}${note ? ' · ' + note : ''}`)
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteExpense(id) {
      try {
        await repos.expenses.softDelete(id)
        await get().refresh()
        get().showToast('已删除这笔支出')
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    async rollOver() {
      const s = get()
      const from = addDays(s.selected, -1)
      try {
        const r = await repos.todos.rollOver(from, s.selected)
        set({ rollDismissed: { ...s.rollDismissed, [s.selected]: true } })
        await get().refresh()
        get().showToast(r.moved.length > 0 ? `已顺延 ${r.moved.length} 件` : '没有可顺延的待办')
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    dismissRoll() {
      const s = get()
      set({ rollDismissed: { ...s.rollDismissed, [s.selected]: true } })
    },

    // ---- v7.5：主题 / 菜单页 / 备份 / 纪念日 ----

    setTheme(t) {
      set({ theme: t })
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, t)
      } catch {
        // 隐私模式等写入失败：本次会话仍生效，只是不持久
      }
      applyTheme(t)
    },

    openAnniv() {
      set({ annivOpen: true })
      void get().refreshAnniv()
    },

    closeAnniv() {
      set({ annivOpen: false })
    },

    async refreshAnniv() {
      try {
        const all = await repos.anniversaries.all()
        set({ annivList: all.filter((r) => !r.deleted) })
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    async exportBackup() {
      try {
        const file = await serializeBackup(bundle.store)
        const day = new Date(file.exportedAt).toISOString().slice(0, 10)
        const filename = `daycell-backup-${day}.json`
        downloadText(
          filename,
          JSON.stringify(file, null, 2),
          'application/json',
        )
        // v7.6：明确告知文件名与去向（用户反馈"只给了文本没告诉保存"）
        get().showToast(`已导出备份：${filename}（文件在浏览器下载列表）`)
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async importBackup(file) {
      try {
        const parsed = parseBackup(await file.text())
        const stats = await mergeBackup(bundle.store, parsed)
        // 分类可能新增 → 清分类名缓存，避免显示旧名
        aggregates.invalidate()
        await get().refresh()
        const total =
          stats.added.todos + stats.added.notes + stats.added.expenses +
          stats.added.anniversaries + stats.added.categories + stats.settingsAdded
        if (total > 0) {
          get().showToast(`已合并导入 ${total} 条记录`)
        } else {
          get().showToast('备份里没有新数据，本地已是最新')
        }
        return true
      } catch (e) {
        // BackupCorruptError 自带"现有数据未改动"语义，直接透传给用户
        get().showToast(errMsg(e))
        return false
      }
    },

    async exportMd(kind) {
      const s = get()
      try {
        const weekStartsOn = (await repos.settings.get('weekStartsOn', 1)) as 0 | 1
        const keys =
          kind === 'week' ? weekKeys(s.selected, weekStartsOn) : monthKeys(s.selected)
        const from = keys[0]
        const to = keys[keys.length - 1]!
        const [data, catMap] = await Promise.all([
          bundle.store.byDateAll(from, to),
          repos.categories.nameMap(),
        ])
        const days = rangeKeys(from, to).map((date) => ({
          date,
          todos: data.todos.filter((t) => t.date === date),
          notes: data.notes.filter((n) => n.date === date),
          expenses: data.expenses.filter((e) => e.date === date),
          catName: (catId: string) => catMap.get(catId) ?? '已删除分类',
        }))
        const title = kind === 'week' ? 'DayCell · 本周记录' : 'DayCell · 本月记录'
        const md = renderRangeMd(title, days)
        const filename = `daycell-${kind === 'week' ? '周记录' : '月记录'}-${from}.md`
        downloadText(
          filename,
          md,
          'text/markdown;charset=utf-8',
        )
        get().showToast(`已导出：${filename}（文件在浏览器下载列表）`)
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async createAnniversary(input) {
      try {
        await repos.anniversaries.create(input)
        await get().refresh()
        await get().refreshAnniv()
        get().showToast('已添加纪念日')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async updateAnniversary(id, patch) {
      try {
        await repos.anniversaries.update(id, patch)
        await get().refresh()
        await get().refreshAnniv()
        get().showToast('已更新纪念日')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteAnniversary(id) {
      try {
        await repos.anniversaries.softDelete(id)
        await get().refresh()
        await get().refreshAnniv()
        get().showToast('已删除纪念日')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    // ---- v7.9 目标 ----

    async refreshGoals() {
      try {
        const goalList = await aggregates.goalSummaries()
        set({ goalList })
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    async openGoal(id) {
      try {
        const [goal, stages, subtasks] = await Promise.all([
          repos.goals.all().then((gs) => gs.find((g) => g.id === id) ?? null),
          aggregates.stagesOfGoal(id),
          aggregates.subtasksOfGoal(id),
        ])
        if (!goal) {
          get().showToast('目标不存在')
          return
        }
        // done 归一化（旧记录/旧备份无此字段）
        set({ goalDetail: { goal: { ...goal, done: goal.done ?? false }, stages, subtasks } })
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    closeGoal() {
      set({ goalDetail: null })
      void get().refreshGoals()
    },

    async createGoal(title, note) {
      try {
        await repos.goals.create({ title, note })
        await get().refreshGoals()
        get().showToast('已创建目标')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async updateGoal(id, patch) {
      try {
        const goal = await repos.goals.update(id, patch)
        set((s) => (s.goalDetail && s.goalDetail.goal.id === id ? { goalDetail: { ...s.goalDetail, goal } } : s))
        await get().refreshGoals()
        get().showToast('已更新目标')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async setGoalDone(id, done) {
      try {
        const goal = await repos.goals.setDone(id, done)
        set((s) => (s.goalDetail && s.goalDetail.goal.id === id ? { goalDetail: { ...s.goalDetail, goal } } : s))
        await get().refreshGoals()
        get().showToast(done ? '目标已完成' : '已恢复进行中')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteGoal(id) {
      try {
        await repos.goals.softDelete(id)
        if (get().goalDetail?.goal.id === id) set({ goalDetail: null })
        await get().refreshGoals()
        get().showToast('已删除目标')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async createStage(input) {
      try {
        const stage = await repos.stages.create(input)
        set((s) =>
          s.goalDetail && s.goalDetail.goal.id === input.goalId
            ? { goalDetail: { ...s.goalDetail, stages: [...s.goalDetail.stages, stage] } }
            : s,
        )
        await get().refreshGoals()
        get().showToast('已添加阶段')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async updateStage(id, patch) {
      try {
        const stage = await repos.stages.update(id, patch)
        set((s) =>
          s.goalDetail
            ? { goalDetail: { ...s.goalDetail, stages: s.goalDetail.stages.map((x) => (x.id === id ? stage : x)) } }
            : s,
        )
        await get().refreshGoals()
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async setCurrentStage(id) {
      try {
        const stage = await repos.stages.setCurrent(id)
        set((s) =>
          s.goalDetail
            ? {
                goalDetail: {
                  ...s.goalDetail,
                  stages: s.goalDetail.stages.map((x) =>
                    x.goalId === stage.goalId ? { ...x, isCurrent: x.id === id, done: x.id === id ? false : x.done } : x,
                  ),
                },
              }
            : s,
        )
        await get().refreshGoals()
        get().showToast('已设为当前阶段')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async setStageDone(id, done) {
      try {
        const stage = await repos.stages.setDone(id, done)
        set((s) =>
          s.goalDetail
            ? { goalDetail: { ...s.goalDetail, stages: s.goalDetail.stages.map((x) => (x.id === id ? stage : x)) } }
            : s,
        )
        await get().refreshGoals()
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteStage(id) {
      try {
        await repos.stages.softDelete(id)
        set((s) =>
          s.goalDetail
            ? { goalDetail: { ...s.goalDetail, stages: s.goalDetail.stages.filter((x) => x.id !== id) } }
            : s,
        )
        await get().refreshGoals()
        get().showToast('已删除阶段')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    // ---- v8.5 子任务 ----

    async createSubtask(input) {
      try {
        const subtask = await repos.subtasks.create(input)
        set((s) =>
          s.goalDetail && s.goalDetail.goal.id === input.goalId
            ? { goalDetail: { ...s.goalDetail, subtasks: [...s.goalDetail.subtasks, subtask] } }
            : s,
        )
        await get().refreshGoals()
        get().showToast('已添加子任务')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async updateSubtask(id, patch) {
      try {
        const subtask = await repos.subtasks.update(id, patch)
        set((s) =>
          s.goalDetail
            ? { goalDetail: { ...s.goalDetail, subtasks: s.goalDetail.subtasks.map((x) => (x.id === id ? subtask : x)) } }
            : s,
        )
        await get().refreshGoals()
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async setSubtaskDone(id, done) {
      try {
        const subtask = await repos.subtasks.setDone(id, done)
        set((s) =>
          s.goalDetail
            ? { goalDetail: { ...s.goalDetail, subtasks: s.goalDetail.subtasks.map((x) => (x.id === id ? subtask : x)) } }
            : s,
        )
        await get().refreshGoals()
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteSubtask(id) {
      try {
        await repos.subtasks.softDelete(id)
        set((s) =>
          s.goalDetail
            ? { goalDetail: { ...s.goalDetail, subtasks: s.goalDetail.subtasks.filter((x) => x.id !== id) } }
            : s,
        )
        await get().refreshGoals()
        get().showToast('已删除子任务')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    // ---- v8.0 习惯 ----

    async refreshHabits() {
      try {
        const habitList = await repos.habits.all()
        set({ habitList })
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    openHabits() {
      set({ habitsOpen: true })
      void get().refreshHabits()
    },

    closeHabits() {
      set({ habitsOpen: false })
    },

    async createHabit(input) {
      try {
        await repos.habits.create(input)
        await get().refreshHabits()
        await get().refresh()
        get().showToast('已新建习惯')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async updateHabit(id, patch) {
      try {
        await repos.habits.update(id, patch)
        await get().refreshHabits()
        await get().refresh()
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async deleteHabit(id) {
      try {
        await repos.habits.softDelete(id)
        await get().refreshHabits()
        await get().refresh()
        get().showToast('已删除习惯')
        return true
      } catch (e) {
        get().showToast(errMsg(e))
        return false
      }
    },

    async toggleHabit(date, habitId) {
      try {
        const done = await repos.checkins.toggle(date, habitId)
        await get().refresh()
        if (done) get().showToast('打卡成功')
      } catch (e) {
        get().showToast(errMsg(e))
      }
    },

    // ---- v8.1：坚果云同步 ----

    openSync() {
      set({ syncOpen: true, syncConfig: readSyncConfig() })
    },

    closeSync() {
      set({ syncOpen: false })
    },

    async saveSyncConfig(cfg) {
      writeSyncConfig(cfg)
      syncEngine?.setTransport(buildTransport(cfg))
      set({ syncConfig: cfg })
      get().showToast('已保存同步设置')
      if (syncEngine?.configured) {
        // 保存后立即同步一次，让用户马上看到效果（失败时状态页已显示原因）
        await get().syncNow()
      } else {
        get().showToast('当前环境不支持网络同步')
      }
      return true
    },

    async syncNow() {
      if (!syncEngine?.configured) {
        get().showToast('请先填写同步设置')
        return false
      }
      try {
        await syncEngine.sync()
        get().showToast('同步完成')
        return true
      } catch (e) {
        // 引擎已把错误记入 status；这里把中文原因 toast 出来
        get().showToast(syncEngine.status().lastError ?? errMsg(e))
        return false
      }
    },

    // ---- v8.3：分享与手册 ----
    openShare() {
      set({ shareOpen: true })
    },

    closeShare() {
      set({ shareOpen: false })
    },

    // ---- v8.4：版本更新 ----
    openChangelog() {
      set({ changelogOpen: true })
    },

    closeChangelog() {
      set({ changelogOpen: false })
    },

    showToast(msg) {
      if (!msg) return
      set({ toast: { msg, seq: ++toastSeq } })
    },

    clearToast() {
      set({ toast: null })
    },
  }))

  // v8.1：engine 先于 store 创建，status 回调经闭包 sink 接进来
  opts.onSyncStatus?.((s) => api.setState({ syncStatus: s }))
  return api
}
