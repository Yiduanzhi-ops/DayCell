/**
 * 待办区块（M4：CRUD + 勾选；US-04 顺延痕迹展示；US-13 点文字就地编辑，v7）。
 * 表单保存后**收起**（v7.4：原"保留并清空连续录入"改为手动——用户拍板），Esc / 取消收起。
 *
 * 编辑交互（US-13）：点待办文字 → 原位变输入框；回车保存、Esc 取消、
 * 失焦时「有改动即保存、没改动即取消」。IME 组合中的回车是确认候选词，不触发保存。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { todoProgress, isOverdueDone, type TodoRecord } from '@core'
import { compareKey, type DateKey } from '@core'
import { useApp } from '@/app/context'
import { Check } from './icons'
import { FormActs } from './forms'
import styles from './detail.module.css'

/** 'YYYY-MM-DD' → 'M/D'（顺延来源标签用） */
const md = (k: string): string => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`

/** 当前本地时刻 'HH:mm'（at 型过点置灰判定用） */
const nowHm = (): string => {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * v9.2.3 行内时间标签：due 截止蓝（逾期红、逾期完成淡红）/ at 提醒绿（当天过点置灰）。
 * 今天只写「今天」；无 timeType 老数据：有截止日按 due、无按 at 推导。
 */
function TimePill({ t, k }: { t: TodoRecord; k: DateKey }): JSX.Element {
  const isDue = (t.timeType ?? (t.deadline ? 'due' : 'at')) === 'due'
  const late = isDue && !!t.deadline && compareKey(t.deadline, k) < 0
  const overdueDone = isDue && isOverdueDone(t)
  const day = t.deadline ? (t.deadline === k ? '今天' : md(t.deadline)) : ''
  const label = isDue
    ? `${overdueDone ? '逾期完成 · ' : late && !t.done ? '已逾期 · ' : ''}截止 ${day} ${t.time}`
        .replace(/\s{2,}/g, ' ')
        .trim()
    : day
      ? `${day} ${t.time} 提醒`
      : `${t.time} 提醒`
  // at 型仅提醒日当天比较时刻（未来日不置灰）
  const past = !isDue && !!t.time && (!t.deadline || t.deadline === k) && t.time <= nowHm()
  const cls = isDue
    ? overdueDone
      ? styles.ttimeLateDone
      : late && !t.done
        ? styles.ttimeLate
        : styles.ttime
    : past
      ? styles.tatPast
      : styles.tat
  return <span className={cls}>{label}</span>
}

/** 待办区块（M4：CRUD + 勾选；US-04 顺延痕迹展示；US-13 点文字就地编辑，v7）。
 *  v8.21：加 date prop——两侧页（滑动预览相邻日）传 date 渲染**静态完整版**：
 *  不读全局 edit（不展开表单/就地编辑态），只读展示；中间页（date 缺省）保持交互。
 *  表单保存后**收起**（v7.4：原"保留并清空连续录入"改为手动——用户拍板），Esc / 取消收起。 */
export function TodoSection({ dayWord, date }: { dayWord: string; date?: DateKey }): JSX.Element {
  // v8.15：缓存优先（dayCache.get(k) 恒为目标日完整 detail），兜底 store.detail——
  // 翻页落地重排瞬间 store.detail 仍是旧日期（refresh 异步），直接读会内容错位闪旧。
  // v8.19：缓存条目携带 dataVer，过期（ver < dataVer）时兜底 store.detail（最新聚合）；
  // 侧页（有 date）无兜底——过期显示骨架，绝不显示旧数据。
  const selected = useApp((s) => s.selected)
  const k = date ?? selected
  const cached = useApp((s) => {
    const e = s.dayCache.get(k)
    return e && e.ver >= s.dataVer ? e.detail : undefined
  })
  // v8.40：detail 兜底加 detailDate 校验（与 DayFull 同规则）——换日瞬间 store.detail 仍是旧日的，
  // 仅当 detail 确实属于当前 k 时才兜底，否则走骨架，杜绝「标题新日、内容旧日」闪旧数据
  const detail = useApp((s) => (date || s.detailDate !== k ? undefined : s.detail))
  const edit = useApp((s) => (date ? undefined : s.edit)) // 侧页不受全局表单态影响
  const openForm = useApp((s) => s.openForm)
  const toggleTodo = useApp((s) => s.toggleTodo)
  const deleteTodo = useApp((s) => s.deleteTodo)
  const toggleAnnivDone = useApp((s) => s.toggleAnnivDone)

  const todos = (cached ?? detail)?.todos ?? []
  // v7.6：已完成的自动沉底；v9.2.2：未完成内「有具体时间 → 置顶按时刻升序」，无时间的保持原序（稳定排序）
  const sorted = [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    const ta = a.time
    const tb = b.time
    if (ta && tb) return ta < tb ? -1 : 1
    if (ta) return -1
    if (tb) return 1
    return 0
  })
  // v8.27：当天命中的特殊日当作待办展示在待办列表最上方（置顶）
  // v8.29：可勾选——勾选态存 annivchecks（annivDones），划线置灰，与普通待办同款圆圈
  const annis = (cached ?? detail)?.anniversaries ?? []
  const annivDones = new Set((cached ?? detail)?.annivDones ?? [])
  const { done, total } = todoProgress(sorted)
  /** 正在就地编辑的待办 id（v7 / US-13）。同一时刻最多一条 */
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>待办</h3>
        {total > 0 && <span className={styles.n}>{done}/{total}</span>}
        <span className={styles.line} />
        <button
          className={styles.addbtn}
          onClick={() => openForm('todo')}
          aria-expanded={edit === 'todo'}
          aria-label={edit === 'todo' ? '收起待办表单' : '添加待办'}
        >
          {edit === 'todo' ? '收起' : '+ 添加'}
        </button>
      </div>
      <div className={styles.tlist}>
        {sorted.length > 0 || annis.length > 0 ? (
          <>
          {annis.map((a) => {
            const aDone = annivDones.has(a.id)
            return (
              <div key={`anni-${a.id}`} className={`${styles.titem} ${styles.anniItem} ${aDone ? styles.done : ''}`}>
                <button
                  className={styles.chk}
                  aria-label={aDone ? `取消标记：${a.title}` : `标记完成：${a.title}`}
                  aria-pressed={aDone}
                  onClick={() => void toggleAnnivDone(k, a.id)}
                >
                  {aDone && <Check />}
                </button>
                <span className={styles.ttxt}>{a.title}</span>
                <span className={styles.anniTag}>特殊日</span>
              </div>
            )
          })}
          {sorted.map((t) => (
            <div
              key={t.id}
              className={[
                styles.titem,
                t.done ? styles.done : '',
                t.rolledTo ? styles.rolledout : '',
              ].filter(Boolean).join(' ')}
            >
              <button
                className={styles.chk}
                aria-label={t.done ? `标记未完成：${t.text}` : `标记完成：${t.text}`}
                aria-pressed={t.done}
                onClick={() => void toggleTodo(t.id)}
              >
                {t.done && <Check />}
              </button>
              {editingId === t.id ? (
                <TodoEdit todo={t} onDone={() => setEditingId(null)} />
              ) : t.subtaskId ? (
                // v8.63 子任务来源待办：不可编辑文字（标题快照只读），可勾选、可删除；
                // v8.64 文字后标注来源目标「· 目标名」
                <span className={styles.ttxt}>
                  {t.text}
                  {t.subtaskGoalTitle && <span className={styles.subGoalTag}> · {t.subtaskGoalTitle}</span>}
                </span>
              ) : (
                <button
                  className={styles.ttxtBtn}
                  aria-label={`编辑待办：${t.text}`}
                  onClick={() => setEditingId(t.id)}
                >
                  <span className={styles.ttxt}>{t.text}</span>
                </button>
              )}
              {t.rolledTo && <span className={styles.rolled}>已顺延 →</span>}
              {t.rolledFrom && <span className={styles.rolled}>顺延自 {md(t.rolledFrom)}</span>}
              {/* v9.2.3 时间标签合并为单枚语义 pill：截止蓝（逾期红）/ 提醒绿（过点灰），今天只写「今天」 */}
              {t.time ? (
                <TimePill t={t} k={k} />
              ) : t.deadline ? (
                <span
                  className={`${styles.ddlBadge} ${
                    !t.done && compareKey(t.deadline, k) < 0 ? styles.ddlLate : ''
                  } ${isOverdueDone(t) ? styles.ddlLateDone : ''}`}
                >
                  {isOverdueDone(t)
                    ? '逾期完成 · '
                    : !t.done && compareKey(t.deadline, k) < 0
                      ? '已逾期 · '
                      : ''}
                  {/* v9.2.2：截止日恰为今天时标注（今天） */}
                  截止 {md(t.deadline)}
                  {t.deadline === k ? '（今天）' : ''}
                </span>
              ) : null}
              {!t.rolledTo && (
                <button className={styles.tdel} aria-label={`删除待办：${t.text}`} onClick={() => void deleteTodo(t.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
          </>
        ) : edit === 'todo' ? null : (
          <div className={styles.emptySm}>{dayWord}还没有待办</div>
        )}
      </div>
      {edit === 'todo' && <TodoForm />}
    </div>
  )
}

function TodoForm(): JSX.Element {
  const createTodo = useApp((s) => s.createTodo)
  const closeForm = useApp((s) => s.closeForm)
  const todayKey = useApp((s) => s.today)
  const [v, setV] = useState('')
  // v8.53.1：默认截止日 = 今天（待办默认当天截止，没做完每天置顶提醒）
  const [ddl, setDdl] = useState<string>(todayKey)
  // v9.2.2：具体时间可选，默认不设置
  const [tm, setTm] = useState('')
  // v9.2.3：时间语义（截止/提醒）。表单默认日期=今天 → 默认「截止」；用户可在 sheet 内切换
  const [tp, setTp] = useState<'due' | 'at'>('due')

  const submit = async (): Promise<void> => {
    const ok = await createTodo(v, ddl || undefined, tm || undefined, tp)
    // v7.4：创建完收起表单（不再保留并聚焦"连续录入"——用户拍板改手动，需要时再点「+ 添加」）
    if (ok) closeForm()
  }

  return (
    <div className={styles.iform}>
      <input
        data-autofocus
        className={styles.ifInput}
        value={v}
        placeholder="要做的事"
        autoComplete="off"
        aria-label="新待办"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return // IME 组合中的回车是确认候选词，不是保存
          if (e.key === 'Escape') { e.preventDefault(); closeForm(); return }
          if (e.key === 'Enter') { e.preventDefault(); void submit() }
        }}
      />
      {/* v9.2.4：待办类型独立一行，放在日期/时间上方——截止型 / 提醒型 */}
      <div className={styles.todoTypeRow} role="radiogroup" aria-label="待办类型">
        <button
          type="button"
          className={`${styles.todoTypeBtn} ${tp === 'due' ? styles.todoTypeOn : ''}`}
          aria-pressed={tp === 'due'}
          onClick={() => setTp('due')}
        >
          截止型
        </button>
        <button
          type="button"
          className={`${styles.todoTypeBtn} ${tp === 'at' ? styles.todoTypeOn : ''} ${tp === 'at' ? styles.todoTypeOnAt : ''}`}
          aria-pressed={tp === 'at'}
          onClick={() => setTp('at')}
        >
          提醒型
        </button>
      </div>
      <DdlPicker value={ddl} onChange={setDdl} />
      <TimePicker value={tm} type={tp} onChange={setTm} />
      <FormActs onCancel={closeForm} onSave={submit} />
    </div>
  )
}

/**
 * v8.53 截止日期选择行：今天 / 自定义。
 * 创建表单默认「今天」；编辑态空值 = 未设截止日（两个选项都不亮，保存不改动）。
 * v8.53.1：去「无/明天」快捷项，只留今天 + 自定义（用户拍板）。
 * v8.53.2：自定义改为无框「日期 + 箭头」样式（方案 B）——隐藏原生 date input 铺满整行，
 *          点击仍是系统选择器（手机滚轮 / 桌面日历），视觉上不再是一条输入框。
 */
function DdlPicker({ value, onChange }: { value: string; onChange: (v: string) => void }): JSX.Element {
  // 「今天」用 app 注入时钟（store.today），与视图语义一致
  const t = useApp((s) => s.today)
  const custom = value && value !== t
  return (
    <div className={styles.ddlRow}>
      {/* v9.2.3：语义从「截止」改为「日期」——提醒型也会在别的时间设日期 */}
      <span className={styles.ddlLabel}>日期</span>
      <button
        type="button"
        className={`${styles.ddlChip} ${value === t ? styles.ddlOn : ''}`}
        aria-pressed={value === t}
        onClick={() => onChange(t)}
      >
        今天
      </button>
      <span className={`${styles.ddlDateWrap} ${custom ? styles.ddlDateSet : ''}`}>
        {custom ? fmtFullDate(value) : '自定义'}
        <svg className={styles.ddlChevron} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <input
          type="date"
          className={styles.ddlDateInput}
          value={value === t ? '' : value}
          aria-label="自定义截止日"
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </div>
  )
}

/** DateKey('YYYY-MM-DD') → 「YYYY年M月D日」 */
function fmtFullDate(k: string): string {
  return `${k.slice(0, 4)}年${Number(k.slice(5, 7))}月${Number(k.slice(8, 10))}日`
}

// ---------------------------------------------------------------------------
// v9.2.2 具体时间（可选）：点击整行弹出**底部 sheet**（遮罩 + 面板），默认「不设置」
// v9.2.3 sheet 内加「截止 / 提醒」类型切换 chip：
//   设了日期默认「截止」（due）、没设默认「提醒」（at）；确定才提交（点遮罩 = 取消不保存）
// 滚轮 = 原生滚动容器（scroll-snap 对齐），触摸/滚轮都能滑，手机体验接近系统滚轮
// 弹出前先收起手机键盘（blur 活动元素），避免底部面板与键盘重叠
// ---------------------------------------------------------------------------

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))
/** 每项高度（px），与 .wheelItem 的 height 保持一致 */
const WHEEL_ITEM = 36
/** 首尾占位项数（让选中项居中显示在中间行） */
const WHEEL_PAD = 2

function TimePicker({
  value,
  type,
  onChange,
}: {
  value: string
  type: 'due' | 'at'
  onChange: (v: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  // 滚轮内部选中态：展开时对齐当前 value（无则 09:00 起步）
  const [hh, setHh] = useState(value ? value.slice(0, 2) : '09')
  const [mm, setMm] = useState(value ? value.slice(3, 5) : '00')

  const openWheel = (): void => {
    setHh(value ? value.slice(0, 2) : '09')
    setMm(value ? value.slice(3, 5) : '00')
    // v9.2.3 先收起手机键盘：底部 sheet 弹出时避免与键盘重叠（iOS/Android 焦点 blur 后键盘回落）
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    setOpen(true)
  }

  return (
    <div className={styles.timeRow}>
      {/* v9.2.4：类型切换已移到表单上方独立行；这里只做时间 */}
      <span className={styles.timeLabel}>时间</span>
      <button
        type="button"
        className={styles.timeBtn}
        onClick={openWheel}
        aria-expanded={open}
        aria-label="具体时间（可选）"
      >
        <span className={value ? styles.timeVal : styles.timeEmpty}>{value || '不设置'}</span>
        <svg className={styles.timeChevron} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        createPortal(
          <div className={styles.timeMask} onMouseDown={() => setOpen(false)}>
          <div
            className={styles.timeSheet}
            role="dialog"
            aria-label="选择时间"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className={styles.timeSheetHead}>
              <span className={styles.timeSheetTitle}>选择时间</span>
              <span className={styles.timeSheetNote}>点遮罩取消</span>
            </div>
            <div className={styles.timeBigWrap}>
              <span className={`${styles.timeBig} ${type === 'at' ? styles.timeBigAt : ''}`}>
                {`${hh}:${mm}`}
              </span>
            </div>
            <div className={styles.timeWheels}>
              <div className={styles.wheelBar} aria-hidden="true" />
              <Wheel values={HOURS} value={hh} onChange={setHh} ariaLabel="时" />
              <span className={styles.timeColon}>:</span>
              <Wheel values={MINUTES} value={mm} onChange={setMm} ariaLabel="分" />
            </div>
            <div className={styles.timeActs}>
              <button
                type="button"
                className={styles.timeClear}
                onClick={() => {
                  onChange('')
                  setOpen(false)
                }}
              >
                清除
              </button>
              <button
                type="button"
                className={styles.timeOk}
                onClick={() => {
                  onChange(`${hh}:${mm}`)
                  setOpen(false)
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>,
          document.body
        )}
    </div>
  )
}

/**
 * 单列滚轮：原生滚动 + 防抖吸附；选中项（中间行）高亮放大。
 * v9.2.4 循环列表：values 渲染 3 份（0/1/2 段），初始定位到第 1 段选中项——
 * 选中任意值（含 00）时上下都有真实数字，与相邻列视觉完全对称（iOS 无限滚轮效果）。
 */
const WHEEL_REPEAT = 3

function Wheel({
  values,
  value,
  onChange,
  ariaLabel,
}: {
  values: string[]
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const len = values.length
  const idx = Math.max(0, values.indexOf(value))
  // 定位到第 1 段（offset=len）的选中项；居中公式：scrollTop = (idx+len)*ITEM + PAD*ITEM
  const anchor = (idx + len) * WHEEL_ITEM + WHEEL_PAD * WHEEL_ITEM
  const anchored = useRef(false)
  const lastRaw = useRef(-1)
  const timer = useRef<number | undefined>(undefined)
  // 当前滚到的段（相对 raw 索引），未滚动时为 anchor 段；只高亮该段内的选中值，避免 3 份重复高亮
  const [curRaw, setCurRaw] = useState<number | null>(null)
  const effSeg = ((curRaw ?? anchor) / len) | 0
  useEffect(() => {
    const el = ref.current
    if (el && !anchored.current) {
      anchored.current = true
      requestAnimationFrame(() => {
        el.scrollTop = anchor
      })
    }
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = Array.from({ length: WHEEL_REPEAT }, (_, seg) =>
    values.map((v, i) => (
      <div
        key={`${seg}-${i}`}
        className={`${styles.wheelItem} ${seg === effSeg && v === value ? styles.wheelOn : ''}`}
      >
        {v}
      </div>
    ))
  )

  return (
    <div
      ref={ref}
      className={styles.wheel}
      role="listbox"
      aria-label={ariaLabel}
      onScroll={(e) => {
        const el = e.currentTarget
        const raw = Math.round((el.scrollTop - WHEEL_PAD * WHEEL_ITEM) / WHEEL_ITEM)
        if (raw !== lastRaw.current) {
          lastRaw.current = raw
          setCurRaw(raw)
          const v = values[((raw % len) + len) % len]
          if (v !== undefined && v !== value) onChange(v)
        }
        if (timer.current) window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          const t = raw * WHEEL_ITEM + WHEEL_PAD * WHEEL_ITEM
          const max = el.scrollHeight - el.clientHeight
          const target = Math.max(0, Math.min(max, t))
          if (Math.abs(el.scrollTop - target) > 0.5) el.scrollTop = target
        }, 120)
      }}
    >
      {Array.from({ length: WHEEL_PAD }, (_, i) => (
        <div key={`pad-${i}`} className={styles.wheelPad} />
      ))}
      {rows}
      {Array.from({ length: WHEEL_PAD }, (_, i) => (
        <div key={`padb-${i}`} className={styles.wheelPad} />
      ))}
    </div>
  )
}

/**
 * 就地编辑一条待办（US-13）。
 *
 * `done` 防双触发：Esc → cancel 会先卸载输入框，随后的 blur 不得再走一次保存；
 * 「保存」按钮同理——click 前浏览器先派发 blur，谁先到谁生效，后到的直接 no-op。
 */
function TodoEdit({ todo, onDone }: { todo: TodoRecord; onDone: () => void }): JSX.Element {
  const updateTodoText = useApp((s) => s.updateTodoText)
  const updateTodoDeadline = useApp((s) => s.updateTodoDeadline)
  const updateTodoTime = useApp((s) => s.updateTodoTime)
  const [v, setV] = useState(todo.text)
  const [ddl, setDdl] = useState(todo.deadline ?? '')
  // v9.2.2：具体时间（可选）
  const [tm, setTm] = useState(todo.time ?? '')
  // v9.2.3：时间语义。老数据无 timeType → 有截止日按「截止」、无截止日按「提醒」推导
  const [tp, setTp] = useState<'due' | 'at'>(todo.timeType ?? (todo.deadline ? 'due' : 'at'))
  const done = useRef(false)
  // v8.55：blur 保存改为延迟一帧判断——焦点若转移到表单内（截止行的「今天/自定义」），
  // 说明用户正在改截止日，**不保存不关闭**，否则 date input 会被卸载、系统选择器弹不出来。
  const wrapRef = useRef<HTMLDivElement>(null)
  const blurTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save) {
      if (v !== todo.text) void updateTodoText(todo.id, v)
      // v8.53：截止日变化（设/改/清）一并保存
      const next = ddl || null
      if (next !== (todo.deadline ?? null)) void updateTodoDeadline(todo.id, next)
      // v9.2.2：具体时间变化（设/改/清）一并保存；v9.2.3 type 变化也一并提交
      const ntm = tm || null
      // 推导基准：老数据无 timeType 时按 deadline 有无推导；编辑后以当前 tp 为准
      const baseTp = todo.timeType ?? (todo.deadline ? 'due' : 'at')
      if (ntm !== (todo.time ?? null) || tp !== baseTp) void updateTodoTime(todo.id, ntm, tp)
    }
    onDone()
  }

  const handleBlur = (): void => {
    // 焦点若转移到表单内（截止行的「今天/自定义」），说明用户在改截止日，不保存不关闭
    window.clearTimeout(blurTimer.current)
    blurTimer.current = window.setTimeout(() => {
      if (wrapRef.current && wrapRef.current.contains(document.activeElement)) return
      finish(true)
    }, 0)
  }

  return (
    <div
      ref={wrapRef}
      className={styles.teditWrap}
      onBlur={handleBlur} // 兜底：焦点停在 date input / 今天 chip 上时点外部离开，同样要保存关闭
    >
      <input
        className={styles.tedit}
        value={v}
        autoFocus
        aria-label="编辑待办"
        onChange={(e) => setV(e.target.value)}
        onBlur={handleBlur}
        onFocus={() => window.clearTimeout(blurTimer.current)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') { e.preventDefault(); finish(false) }
          if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        }}
      />
      {/* v9.2.4：待办类型独立一行（编辑态同步）——截止型 / 提醒型 */}
      <div className={styles.todoTypeRow} role="radiogroup" aria-label="待办类型">
        <button
          type="button"
          className={`${styles.todoTypeBtn} ${tp === 'due' ? styles.todoTypeOn : ''}`}
          aria-pressed={tp === 'due'}
          onClick={() => setTp('due')}
        >
          截止型
        </button>
        <button
          type="button"
          className={`${styles.todoTypeBtn} ${tp === 'at' ? styles.todoTypeOn : ''} ${tp === 'at' ? styles.todoTypeOnAt : ''}`}
          aria-pressed={tp === 'at'}
          onClick={() => setTp('at')}
        >
          提醒型
        </button>
      </div>
      <DdlPicker value={ddl} onChange={setDdl} />
      <TimePicker value={tm} type={tp} onChange={setTm} />
    </div>
  )
}
