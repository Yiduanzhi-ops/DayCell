/**
 * 待办区块（M4：CRUD + 勾选；US-04 顺延痕迹展示）。
 * 表单保存后**保留并清空**（US-06 连续录入），Esc / 取消收起。
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { todoProgress } from '@core'
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

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>待办</h3>
        {total > 0 && <span className={styles.n}>{done}/{total}</span>}
        <span className={styles.line} />
        <button className={styles.addbtn} onClick={() => openForm('todo')} aria-expanded={edit === 'todo'}>
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
              <span className={styles.ttxt}>{t.text}</span>
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
  const ref = useRef<HTMLInputElement>(null)

  const submit = async (): Promise<void> => {
    const ok = await createTodo(v)
    if (ok) {
      setV('') // 表单保留并清空，方便连续录入（US-06）
      ref.current?.focus()
    }
  }

  return (
    <div className={styles.iform}>
      <input
        data-autofocus
        ref={ref}
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
      <FormActs tip="回车保存" onCancel={closeForm} onSave={submit} />
    </div>
  )
}
