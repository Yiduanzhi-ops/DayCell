/**
 * 花费区块（M6 / US-03 / M12 日汇总）。
 *
 * 金额纪律（ADR-0003）：输入用 core 的 parseAmount 转**整数分**（字符串逐位算法，
 * 不是 *100），显示用 formatMoney。UI 层任何地方不得出现 *100 / /100。
 */
import { useRef, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { formatMoney, parseAmount } from '@core'
import { useApp } from '@/app/context'
import { FormActs } from './forms'
import styles from './detail.module.css'

export function ExpenseSection({ dayWord }: { dayWord: string }): JSX.Element {
  const detail = useApp((s) => s.detail)
  const edit = useApp((s) => s.edit)
  const openForm = useApp((s) => s.openForm)
  const deleteExpense = useApp((s) => s.deleteExpense)
  const cats = useApp((s) => s.cats)

  const expenses = detail?.expenses ?? []
  const costCents = detail?.summary.costCents ?? 0
  const byCat = detail?.summary.byCat ?? []
  const catName = (id: string): string => cats.find((c) => c.id === id)?.name ?? '已删分类'

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>花费</h3>
        {costCents > 0
          ? <span className={styles.total}>¥{formatMoney(costCents)}</span>
          : <span className={styles.n}>无</span>}
        <span className={styles.line} />
        <button
          className={styles.addbtn}
          onClick={() => openForm('cost')}
          aria-expanded={edit === 'cost'}
          aria-label={edit === 'cost' ? '收起记账表单' : '记一笔花费'}
        >
          {edit === 'cost' ? '收起' : '+ 记一笔'}
        </button>
      </div>
      {expenses.length > 0 ? (
        <>
          <div className={styles.elist}>
            {expenses.map((x) => (
              <div key={x.id} className={styles.eitem}>
                <span className={styles.ecat}>{catName(x.catId)}</span>
                <span className={styles.enote}>
                  {x.note || <span className={styles.ph}>无备注</span>}
                </span>
                <span className={styles.eamt}>{formatMoney(x.amountCents)}</span>
                <button
                  className={styles.edel}
                  aria-label={`删除这笔支出：${formatMoney(x.amountCents)} 元`}
                  onClick={() => void deleteExpense(x.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {byCat.length > 1 && (
            <div className={styles.ebreak}>
              {byCat.map((c) => (
                <span key={c.catId}>{c.name} <b>{formatMoney(c.cents)}</b></span>
              ))}
            </div>
          )}
        </>
      ) : edit === 'cost' ? null : (
        <div className={styles.emptySm}>{dayWord}还没有记账</div>
      )}
      {edit === 'cost' && <ExpenseForm />}
    </div>
  )
}

function ExpenseForm(): JSX.Element {
  const cats = useApp((s) => s.cats)
  const lastCatId = useApp((s) => s.lastCatId)
  const createExpense = useApp((s) => s.createExpense)
  const closeForm = useApp((s) => s.closeForm)
  const showToast = useApp((s) => s.showToast)

  // S5：默认选中上次用过的分类（会话级）
  const [catId, setCatId] = useState(lastCatId ?? cats[0]?.id ?? '')
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  const amtRef = useRef<HTMLInputElement>(null)

  const submit = async (): Promise<void> => {
    // 校验走 core 的 parseAmount：失败文案由 core 给（UI 不得自行拼接，CORE-API §2.1）
    const r = parseAmount(amt)
    if (!r.ok) {
      showToast(r.message)
      amtRef.current?.focus()
      return
    }
    const ok = await createExpense(r.value, catId, note.trim())
    if (ok) {
      setAmt('')
      setNote('')
      amtRef.current?.focus() // 表单保留，连续记下一笔（US-06）
    }
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.nativeEvent.isComposing) return // IME 组合中的回车是确认候选词
    if (e.key === 'Escape') { e.preventDefault(); closeForm(); return }
    if (e.key === 'Enter') { e.preventDefault(); void submit() }
  }

  return (
    <div className={styles.iform}>
      <div className={styles.ifRow}>
        <select
          className={styles.ifCat}
          value={catId}
          aria-label="分类"
          onChange={(e) => setCatId(e.target.value)}
        >
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <input
          data-autofocus
          ref={amtRef}
          className={styles.ifAmt}
          value={amt}
          placeholder="0.00"
          inputMode="decimal"
          autoComplete="off"
          aria-label="金额（元）"
          onChange={(e) => setAmt(e.target.value)}
          onKeyDown={onKey}
        />
        <input
          className={styles.ifExpNote}
          value={note}
          placeholder="备注（可空）"
          autoComplete="off"
          aria-label="备注"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onKey}
        />
      </div>
      <FormActs onCancel={closeForm} onSave={submit} />
    </div>
  )
}
