/**
 * 待办区块（M4：CRUD + 勾选；US-04 顺延痕迹展示；US-13 点文字就地编辑，v7）。
 * 表单保存后**收起**（v7.4：原"保留并清空连续录入"改为手动——用户拍板），Esc / 取消收起。
 *
 * 编辑交互（US-13）：点待办文字 → 原位变输入框；回车保存、Esc 取消、
 * 失焦时「有改动即保存、没改动即取消」。IME 组合中的回车是确认候选词，不触发保存。
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { todoProgress, isOverdueDone, type TodoRecord } from '@core'
import { compareKey, type DateKey } from '@core'
import { useApp } from '@/app/context'
import { Check } from './icons'
import { FormActs } from './forms'
import styles from './detail.module.css'

/** 'YYYY-MM-DD' → 'M/D'（顺延来源标签用） */
const md = (k: string): string => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`

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
  // v7.6：已完成的自动沉底；未完成保持原序（Array.prototype.sort 稳定）
  const sorted = [...todos].sort((a, b) => Number(a.done) - Number(b.done))
  // v8.27：当天命中的纪念日当作待办展示在待办列表最上方（置顶）
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
                <span className={styles.anniTag}>纪念日</span>
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
              {t.deadline && (
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
                  截止 {md(t.deadline)}
                </span>
              )}
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

  const submit = async (): Promise<void> => {
    const ok = await createTodo(v, ddl || undefined)
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
      <DdlPicker value={ddl} onChange={setDdl} />
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
      <span className={styles.ddlLabel}>截止</span>
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

/**
 * 就地编辑一条待办（US-13）。
 *
 * `done` 防双触发：Esc → cancel 会先卸载输入框，随后的 blur 不得再走一次保存；
 * 「保存」按钮同理——click 前浏览器先派发 blur，谁先到谁生效，后到的直接 no-op。
 */
function TodoEdit({ todo, onDone }: { todo: TodoRecord; onDone: () => void }): JSX.Element {
  const updateTodoText = useApp((s) => s.updateTodoText)
  const updateTodoDeadline = useApp((s) => s.updateTodoDeadline)
  const [v, setV] = useState(todo.text)
  const [ddl, setDdl] = useState(todo.deadline ?? '')
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
      <DdlPicker value={ddl} onChange={setDdl} />
    </div>
  )
}
