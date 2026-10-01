/**
 * 支出区块（M6 / US-03 / M12 日汇总）。
 * v7.6：区块名「花费」→「支出」；录入**去掉分类选择**（v7.6 用户拍板：
 * 先写做了什么，再填多少钱即可，金额前固定带 ¥；未指定分类的支出统一归「其他」）。
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

  const expenses = detail?.expenses ?? []
  const costCents = detail?.summary.costCents ?? 0
  const byCat = detail?.summary.byCat ?? []

  return (
    <div className={styles.sect}>
      <div className={styles.sectH}>
        <h3>支出</h3>
        {costCents > 0
          ? <span className={styles.total}>¥{formatMoney(costCents)}</span>
          : <span className={styles.n}>无</span>}
        <span className={styles.line} />
        <button
          className={styles.addbtn}
          onClick={() => openForm('cost')}
          aria-expanded={edit === 'cost'}
          aria-label={edit === 'cost' ? '收起支出表单' : '记一笔支出'}
        >
          {edit === 'cost' ? '收起' : '+ 记一笔'}
        </button>
      </div>
      {expenses.length > 0 ? (
        <>
          <div className={styles.elist}>
            {expenses.map((x) => (
              <div key={x.id} className={styles.eitem}>
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
  const createExpense = useApp((s) => s.createExpense)
  const closeForm = useApp((s) => s.closeForm)
  const showToast = useApp((s) => s.showToast)

  // v7.6：录入不再选分类，统一归「其他」（DEFAULT_CATEGORIES 恒有它；E21 归并照常）
  const fallbackCatId = cats.find((c) => c.name === '其他')?.id ?? cats[0]?.id ?? ''
  const [note, setNote] = useState('')
  const [amt, setAmt] = useState('')
  const amtRef = useRef<HTMLInputElement>(null)

  const submit = async (): Promise<void> => {
    // 校验走 core 的 parseAmount：失败文案由 core 给（UI 不得自行拼接，CORE-API §2.1）
    const r = parseAmount(amt)
    if (!r.ok) {
      showToast(r.message)
      amtRef.current?.focus()
      return
    }
    const ok = await createExpense(r.value, fallbackCatId, note.trim())
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
        <input
          data-autofocus
          className={styles.ifExpNote}
          value={note}
          placeholder="做了什么"
          autoComplete="off"
          aria-label="做了什么"
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={onKey}
        />
        <span className={styles.yenWrap}>
          <span className={styles.yen}>¥</span>
          <input
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
        </span>
      </div>
      <FormActs onCancel={closeForm} onSave={submit} />
    </div>
  )
}
