/**
 * 周视图（M2 / US-08）：7 行竖排，每天一整行。
 * 汇总条在顶部；行内是**正文摘要**（待办前 3 条 + 想法前 2 条，聚合层已备好预览）。
 * 点一行：窄屏跳进该日的日视图（记来源），宽屏只切换右栏——分叉在 store.selectFromCalendar。
 */
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { dowOf, fromKey, isSameMonth } from '@core'
import type { WeekDay } from '@core'
import { useApp } from '@/app/context'
import { Check } from './icons'
import styles from './WeekView.module.css'

const DOW = ['日', '一', '二', '三', '四', '五', '六'] as const

/**
 * 副标签：label 被节日/节气占用时补原始农历日（「中秋节 · 十五」）。
 * 纪念日不补——标题已经在下面的 badge 行里，重复显示是噪音（与原型的小差异，刻意的）。
 */
function subLabel(d: WeekDay): string {
  const { text, kind } = d.label
  if (!text) return ''
  if (kind === 'anniversary') return ''
  if ((kind === 'festival' || kind === 'solarTerm') && d.lunarDay && d.lunarDay !== text) {
    return `${text} · ${d.lunarDay}`
  }
  return text
}

export function WeekView(): JSX.Element {
  const week = useApp((s) => s.week)
  const selected = useApp((s) => s.selected)
  const today = useApp((s) => s.today)
  const selectFromCalendar = useApp((s) => s.selectFromCalendar)
  const restore = useApp((s) => s.restoreScrollTo)
  const consumeRestore = useApp((s) => s.consumeRestoreScroll)
  const scrollRef = useRef<HTMLDivElement>(null)

  // 从日视图返回时还原滚动位置（ADR-0005：来源 = 视图+日期+滚动位置，缺一不算还原）
  useEffect(() => {
    if (restore != null && scrollRef.current) {
      scrollRef.current.scrollTop = restore
      consumeRestore()
    }
  }, [restore, consumeRestore])

  const total = week?.total
  const days = week?.days ?? []

  return (
    <>
      <div className={styles.weekbar}>
        <span>
          {total && total.todoTotal > 0
            ? <>待办 <b>{total.todoDone}/{total.todoTotal}</b></>
            : '无待办'}
        </span>
        <i className={styles.vr} />
        <span>{total?.daysWithNotes ?? 0} 天有想法</span>
      </div>
      <div className={styles.wrap} ref={scrollRef}>
        {days.map((d) => {
          const { m, d: dd } = fromKey(d.date)
          const isSel = d.date === selected
          const isToday = d.date === today
          const out = !isSameMonth(d.date, selected)
          const sub = subLabel(d)
          const moreCount = d.todoTotal - d.todoPreview.length
          return (
            <div
              key={d.date}
              role="button"
              tabIndex={0}
              aria-label={`${m}月${dd}日 周${DOW[dowOf(d.date)]}${sub ? ' ' + sub : ''}${d.todoTotal ? ` 待办${d.todoDone}/${d.todoTotal}` : ''}`}
              className={[styles.wrow, isSel ? styles.sel : '', isToday ? styles.today : '', out ? styles.out : ''].filter(Boolean).join(' ')}
              onClick={() => selectFromCalendar(d.date, scrollRef.current?.scrollTop ?? 0)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectFromCalendar(d.date, scrollRef.current?.scrollTop ?? 0)
                }
              }}
            >
              <div className={styles.wdate}>
                <b className={isSel || isToday ? styles.wdNum : undefined}>{m}/{dd}</b>
                <span className={styles.wdow}>周{DOW[dowOf(d.date)]}</span>
              </div>
              <div className={styles.wright}>
                {sub && (
                  <div className={styles.wtop}>
                    <span className={d.label.emphasis ? styles.fest : styles.wlun}>{sub}</span>
                  </div>
                )}
                {d.anniversaries.length > 0 && (
                  <div className={styles.wanni}>
                    {d.anniversaries.map((a) => (
                      <span key={a} className={styles.anniBadge}>◷ {a}</span>
                    ))}
                  </div>
                )}
                {d.todoTotal > 0 ? (
                  <div className={styles.wtodos}>
                    <span className={d.todoDone === d.todoTotal ? styles.allDone : undefined}>
                      {d.todoDone}/{d.todoTotal}
                    </span>
                    <div className={styles.witems}>
                      {d.todoPreview.map((t) => (
                        <div key={t.id} className={t.done ? styles.done : undefined}>
                          <span className={styles.wchk}>{t.done && <Check size={8} />}</span>
                          <span className={styles.wtxt}>{t.text}</span>
                        </div>
                      ))}
                      {moreCount > 0 && <div className={styles.wmore}>+{moreCount} 项待办</div>}
                    </div>
                  </div>
                ) : d.label.emphasis && d.label.kind === 'festival' ? (
                  <div className={styles.wempty}>假日，没有待办</div>
                ) : null}
                {d.notePreview.map((n) => (
                  <div key={n.id} className={styles.wnote}>{n.text}</div>
                ))}
                {d.isEmpty && <div className={styles.wempty}>空白的一天</div>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
