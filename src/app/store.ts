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
  type DateKey,
  type DayAggregate,
  type DayDetail,
  type MonthSummary,
  type WeekDay,
  type WeekTotal,
  type CategoryRecord,
} from '@core'
import type { CoreBundle } from './bootstrap'

export type View = 'day' | 'week' | 'month'
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
}

export interface AppStoreOptions {
  /** 注入的"今天"（测试用固定值）；缺省用真实时钟 */
  today?: DateKey
  /** 窄屏判定（< 900px）。缺省用 matchMedia；测试注入固定值 */
  isNarrow?: () => boolean
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
  /** 并发保护：快速翻页时旧响应不得覆盖新状态 */
  let loadSeq = 0
  let toastSeq = 0

  const canHistory = (): boolean => typeof globalThis.history?.pushState === 'function'

  return createStore<AppState>()((set, get) => ({
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

    degraded: bundle.degraded,
    lunarFailed: bundle.lunarFailed,
    loading: true,
    toast: null,

    theme: readTheme(),
    annivOpen: false,

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
        // detail 恒加载（桌面分栏右栏 / 手机日视图都要）；日历数据按当前视图加载
        const [detail, week, monthDays, monthSum] = await Promise.all([
          aggregates.aggregateDayDetail(selected),
          view === 'week' ? aggregates.aggregateWeek(selected) : Promise.resolve(null),
          view === 'month' ? aggregates.aggregateMonth(selected) : Promise.resolve(null),
          view === 'month' ? aggregates.monthSummary(selected) : Promise.resolve(null),
        ])
        if (seq !== loadSeq) return // 已有更新的加载在飞，丢弃过期结果

        const patch: Partial<AppState> = {
          detail,
          week,
          month: monthDays ? { days: monthDays, summary: monthSum! } : null,
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
      if (s.view === 'day') return
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

    showToast(msg) {
      if (!msg) return
      set({ toast: { msg, seq: ++toastSeq } })
    },

    clearToast() {
      set({ toast: null })
    },
  }))
}
