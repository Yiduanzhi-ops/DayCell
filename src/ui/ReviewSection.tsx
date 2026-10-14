/**
 * 复盘区块（v8.42）：今日视图最下方，**每日一条**。
 * 视觉对齐想法（NoteSection）：同款区块头、卡片、就地编辑、表单样式。
 * 差异：
 *  - 没有「+ 添加」——一天一条，空态即入口（点「今天还没复盘，点这里写」）
 *  - 没有删除 ×——清空在编辑态里做（「清空」按钮，置墓碑）
 *  - 侧页（date prop）静态展示，不读全局编辑态（同 NoteSection / v8.21）
 *  - 缓存优先（同 v8.40 各区块）：换日瞬间 store.detail 仍是旧日，走 dayCache 杜绝闪旧
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DateKey } from '@core'
import { useApp } from '@/app/context'
import styles from './detail.module.css'

/** v8.42：编辑态（预填当日内容；「清空」= 当日复盘置墓碑） */
const ReviewEdit = ({ initial, onDone }: { initial: string; onDone: () => void }): JSX.Element => {
  const updateReviewText = useApp((s) => s.updateReviewText)
  const deleteReview = useApp((s) => s.deleteReview)
  const [v, setV] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  const submit = async (): Promise<void> => {
    const ok = await updateReviewText(v)
    if (ok) onDone()
  }

  const clear = async (): Promise<void> => {
    await deleteReview()
    onDone()
  }

  return (
    <div className={styles.iform}>
      <textarea
        ref={ref}
        data-autofocus
        className={styles.ifArea}
        placeholder="今天过得怎么样？记下一段复盘"
        value={v}
        onChange={(e) => setV(e.target.value)}
      />
      <div className={styles.acts}>
        <button className={styles.rcDel} aria-label="清空当天复盘" onClick={() => void clear()}>
          清空
        </button>
        <button className={styles.cancel} onClick={onDone}>
          取消
        </button>
        <button className={styles.save} disabled={!v.trim()} onClick={() => void submit()}>
          保存
        </button>
      </div>
    </div>
  )
}

export function ReviewSection({ dayWord, date }: { dayWord: string; date?: DateKey }): JSX.Element {
  const selected = useApp((s) => s.selected)
  const k = date ?? selected
  // 缓存优先（v8.40 模式）：滑动翻日落地瞬间 store.detail 仍是旧日，dayCache 里才是当前日
  const cached = useApp((s) => {
    const e = s.dayCache.get(k)
    return e && e.ver >= s.dataVer ? e.detail : undefined
  })
  const detail = useApp((s) => (date || s.detailDate !== k ? undefined : s.detail))
  const review = (cached ?? detail)?.review ?? null

  /** 正在就地编辑（仅中间交互页；侧页永不进入编辑态） */
  const [editing, setEditing] = useState(false)

  if (date) {
    // 侧页静态完整版：只展示、不交互（同 NoteSection / v8.21）
    return (
      <div className={styles.sect}>
        <div className={styles.sectH}>
          <h3>复盘</h3>
          {review && <span className={styles.n}>1</span>}
          <span className={styles.line} />
        </div>
        <div className={styles.nlist}>
          {review ? (
            <div className={styles.nitem}>
              <span className={styles.ntxt}>{review.text}</span>
            </div>
          ) : (
            <div className={styles.emptySm}>这天没有复盘</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>复盘</h3>
        {review && <span className={styles.n}>1</span>}
        <span className={styles.line} />
      </div>
      <div className={styles.nlist}>
        {review ? (
          editing ? (
            <ReviewEdit initial={review.text} onDone={() => setEditing(false)} />
          ) : (
            <div className={styles.nitem}>
              <button
                className={styles.ntxtBtn}
                aria-label="编辑今天复盘"
                onClick={() => setEditing(true)}
              >
                <span className={styles.ntxt}>{review.text}</span>
              </button>
            </div>
          )
        ) : (
          <button
            className={styles.reviewEmpty}
            onClick={() => setEditing(true)}
          >
            今天还没复盘，点这里写
          </button>
        )}
      </div>
    </div>
  )
}
