/**
 * 待办区块（M4：CRUD + 勾选；US-04 顺延痕迹展示；US-13 点文字就地编辑，v7）。
 * 表单保存后**收起**（v7.4：原"保留并清空连续录入"改为手动——用户拍板），Esc / 取消收起。
 *
 * 编辑交互（US-13）：点待办文字 → 原位变输入框；回车保存、Esc 取消、
 * 失焦时「有改动即保存、没改动即取消」。IME 组合中的回车是确认候选词，不触发保存。
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { todoProgress, type TodoRecord } from '@core'
import { useApp } from '@/app/context'
import { Check } from './icons'
import { FormActs } from './forms'
import styles from './detail.module.css'

/** 'YYYY-MM-DD' → 'M/D'（顺延来源标签用） */
const md = (k: string): string => `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`

export function TodoSection({ dayWord }: { dayWord: string }): JSX.Element {
  const detail = useApp((s) => s.detail)
  const edit = useApp((s) => s.edit)
  const openForm = useApp((s) => s.openForm)
  const toggleTodo = useApp((s) => s.toggleTodo)
  const deleteTodo = useApp((s) => s.deleteTodo)

  const todos = detail?.todos ?? []
  const { done, total } = todoProgress(todos)
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
        {todos.length > 0 ? (
          todos.map((t) => (
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
              {!t.rolledTo && (
                <button className={styles.tdel} aria-label={`删除待办：${t.text}`} onClick={() => void deleteTodo(t.id)}>
                  ×
                </button>
              )}
            </div>
          ))
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
  const [v, setV] = useState('')

  const submit = async (): Promise<void> => {
    const ok = await createTodo(v)
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
      <FormActs onCancel={closeForm} onSave={submit} />
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
  const [v, setV] = useState(todo.text)
  const done = useRef(false)

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && v !== todo.text) void updateTodoText(todo.id, v)
    onDone()
  }

  return (
    <input
      className={styles.tedit}
      value={v}
      autoFocus
      aria-label="编辑待办"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (e.key === 'Escape') { e.preventDefault(); finish(false) }
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
      }}
    />
  )
}
