/**
 * 想法区块（M5 / US-02）：多行纯文本，不解析 Markdown（D6）。
 * ⌘/Ctrl+Enter 保存（多行场景里裸回车必须是换行），保存后表单保留并清空。
 * US-13（v7）：点正文就地编辑——裸回车换行、⌘/Ctrl+Enter 或「保存」按钮提交、Esc 取消，
 * 失焦时「有改动即保存」。手机没有 ⌘ 键，所以编辑态也必须给可点的「保存」。
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import type { NoteRecord } from '@core'
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
  // v8.15：缓存优先（同 TodoSection：翻页落地瞬间 store.detail 仍是旧日期，直接用会错位闪旧）
  const selected = useApp((s) => s.selected)
  const cached = useApp((s) => s.dayCache.get(selected))
  const detail = useApp((s) => s.detail)
  const edit = useApp((s) => s.edit)
  const openForm = useApp((s) => s.openForm)
  const deleteNote = useApp((s) => s.deleteNote)

  const notes = (cached ?? detail)?.notes ?? []
  /** 正在就地编辑的想法 id（v7 / US-13）。同一时刻最多一条 */
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>想法</h3>
        {notes.length > 0 && <span className={styles.n}>{notes.length}</span>}
        <span className={styles.line} />
        <button
          className={styles.addbtn}
          onClick={() => openForm('note')}
          aria-expanded={edit === 'note'}
          aria-label={edit === 'note' ? '收起想法表单' : '添加想法'}
        >
          {edit === 'note' ? '收起' : '+ 添加'}
        </button>
      </div>
      <div className={styles.nlist}>
        {notes.length > 0 ? (
          notes.map((n) =>
            editingId === n.id ? (
              <NoteEdit key={n.id} note={n} onDone={() => setEditingId(null)} />
            ) : (
              <div key={n.id} className={styles.nitem}>
                <button
                  className={styles.ntxtBtn}
                  aria-label={`编辑想法：${n.text}`}
                  onClick={() => setEditingId(n.id)}
                >
                  <span className={styles.ntxt}>{n.text}</span>
                </button>
                <div className={styles.ntime}>{hhmm(n.createdAt)}</div>
                <button className={styles.ndel} aria-label="删除这条想法" onClick={() => void deleteNote(n.id)}>
                  ×
                </button>
              </div>
            ),
          )
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
      closeForm() // v7.6 修订：创建完表单收起（与待办一致，用户拍板改手动；需要时再点「+ 添加」）
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
      <FormActs onCancel={closeForm} onSave={submit} />
    </div>
  )
}

/**
 * 就地编辑一条想法（US-13）。
 *
 * 多行语义与新建表单一致：裸回车 = 换行，⌘/Ctrl+Enter = 保存。
 * 失焦「有改动即保存」——手机上点别处收起键盘就是提交；「保存」按钮是给
 * 没有 ⌘ 键的设备的显式出口（PRD 场景 B 的同一理由）。
 * `done` 防双触发：保存按钮的 click 之前浏览器先派发 blur，谁先到谁生效。
 */
function NoteEdit({ note, onDone }: { note: NoteRecord; onDone: () => void }): JSX.Element {
  const updateNoteText = useApp((s) => s.updateNoteText)
  const [v, setV] = useState(note.text)
  const done = useRef(false)

  const finish = (save: boolean): void => {
    if (done.current) return
    done.current = true
    if (save && v !== note.text) void updateNoteText(note.id, v)
    onDone()
  }

  return (
    <div className={`${styles.nitem} ${styles.nedit}`}>
      <textarea
        className={styles.neditArea}
        rows={3}
        value={v}
        autoFocus
        aria-label="编辑想法"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Escape') { e.preventDefault(); finish(false); return }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish(true) }
        }}
      />
      <div className={styles.acts}>
        <button className={styles.cancel} onClick={() => finish(false)}>取消</button>
        <button className={styles.save} onClick={() => finish(true)}>保存</button>
      </div>
    </div>
  )
}
