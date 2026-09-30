/**
 * 想法区块（M5 / US-02）：多行纯文本，不解析 Markdown（D6）。
 * ⌘/Ctrl+Enter 保存（多行场景里裸回车必须是换行），保存后表单保留并清空。
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import { FormActs } from './forms'
import styles from './detail.module.css'

/** createdAt → 'HH:MM'。UI 层允许用 Date（core 才有铁律约束） */
const hhmm = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function NoteSection({ dayWord }: { dayWord: string }): JSX.Element {
  const detail = useApp((s) => s.detail)
  const edit = useApp((s) => s.edit)
  const openForm = useApp((s) => s.openForm)
  const deleteNote = useApp((s) => s.deleteNote)

  const notes = detail?.notes ?? []

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>想法</h3>
        {notes.length > 0 && <span className={styles.n}>{notes.length}</span>}
        <span className={styles.line} />
        <button className={styles.addbtn} onClick={() => openForm('note')} aria-expanded={edit === 'note'}>
          {edit === 'note' ? '收起' : '+ 添加'}
        </button>
      </div>
      <div className={styles.nlist}>
        {notes.length > 0 ? (
          notes.map((n) => (
            <div key={n.id} className={styles.nitem}>
              <div className={styles.ntxt}>{n.text}</div>
              <div className={styles.ntime}>{hhmm(n.createdAt)}</div>
              <button className={styles.ndel} aria-label="删除这条想法" onClick={() => void deleteNote(n.id)}>
                ×
              </button>
            </div>
          ))
        ) : edit === 'note' ? null : (
          <div className={styles.emptySm}>{dayWord}没有记下想法</div>
        )}
      </div>
      {edit === 'note' && <NoteForm />}
    </div>
  )
}

function NoteForm(): JSX.Element {
  const createNote = useApp((s) => s.createNote)
  const closeForm = useApp((s) => s.closeForm)
  const [v, setV] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = async (): Promise<void> => {
    const ok = await createNote(v)
    if (ok) {
      setV('')
      ref.current?.focus()
    }
  }

  return (
    <div className={styles.iform}>
      <textarea
        data-autofocus
        ref={ref}
        className={styles.ifArea}
        rows={3}
        value={v}
        placeholder="冒出来的念头，可以写好几行"
        aria-label="新想法"
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') { e.preventDefault(); closeForm(); return }
          // 多行输入：裸回车是换行，⌘/Ctrl+Enter 才是保存（US-02）
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() }
        }}
      />
      <FormActs tip="⌘ / Ctrl + 回车保存" onCancel={closeForm} onSave={submit} />
    </div>
  )
}
