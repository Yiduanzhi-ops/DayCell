/**
 * 想法 tab（v8.13）：全量想法列表。
 *  - 数据源 store.notesList（aggregates.notesAll：date 降序、同日 createdAt 降序）
 *  - 按天分组（组标题 = 公历 + 周几 + 农历 + 条数），条目两行省略 + 右下时间
 *  - 分页 10 条/页（跨组分页，底部「‹ 上一页 / 1 / N / 下一页 ›」）
 *  - 点击条目 → 进该日日视图（编辑/删除都在日视图做，交互复用）
 *  - 返回语义：窄屏记来源（view='notes' + 页码 + 滚动位），返回精确还原
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useApp } from '@/app/context'
import { dowOf, fromKey, loadLunar, lunarFullText, type DateKey, type NoteRecord } from '@core'
import styles from './NotesView.module.css'

/** v8.13：10 条一页（用户拍板） */
const PAGE_SIZE = 10
const DOW = ['日', '一', '二', '三', '四', '五', '六']

/** createdAt → 'HH:MM'（与 NoteSection 一致；UI 层允许用 Date） */
const hhmm = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

interface Group {
  date: DateKey
  lunar: string
  items: NoteRecord[]
}

export function NotesView(): JSX.Element {
  const notesList = useApp((s) => s.notesList)
  const notesPage = useApp((s) => s.notesPage)
  const setNotesPage = useApp((s) => s.setNotesPage)
  const openDayFromNotes = useApp((s) => s.openDayFromNotes)
  const restore = useApp((s) => s.restoreScrollTo)
  const consumeRestore = useApp((s) => s.consumeRestoreScroll)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lunarMap, setLunarMap] = useState<ReadonlyMap<string, string>>(new Map())

  // 农历：loadLunar 有模块级缓存（bootstrap 已加载过则直接命中）；
  // 只对当前列表涉及的日期算一次，失败静默降级（组标题省略农历，PRD E4 精神）
  useEffect(() => {
    let alive = true
    void loadLunar()
      .then((lunar) => {
        if (!alive || !lunar) return
        const dates = [...new Set(notesList.map((n) => n.date))]
        const m = new Map<string, string>()
        for (const k of dates) {
          const info = lunar.lunarOf(k)
          if (info) m.set(k, lunarFullText(info))
        }
        setLunarMap(m)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [notesList])

  // 从日视图返回时还原列表滚动位置（与 Week/MonthView 同机制）
  useEffect(() => {
    if (restore != null && scrollRef.current) {
      scrollRef.current.scrollTop = restore
      consumeRestore()
    }
  }, [restore, consumeRestore])

  // 按天分组（notesList 已倒序，顺序遍历即分组+组内有序）
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    for (const n of notesList) {
      const last = out[out.length - 1]
      if (last && last.date === n.date) last.items.push(n)
      else out.push({ date: n.date, lunar: lunarMap.get(n.date) ?? '', items: [n] })
    }
    return out
  }, [notesList, lunarMap])

  const total = notesList.length
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const page = Math.min(notesPage, pages)
  const from = (page - 1) * PAGE_SIZE
  const visible = useMemo(
    () => new Set(notesList.slice(from, Math.min(from + PAGE_SIZE, total)).map((n) => n.id)),
    [notesList, from, total],
  )

  const onItem = (n: NoteRecord): void => {
    openDayFromNotes(n.date, scrollRef.current?.scrollTop ?? 0)
  }

  return (
    <section className={styles.page} data-testid="notes-view" aria-label="想法列表">
      <div className={styles.list} ref={scrollRef}>
        {total === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyMain}>还没有记过想法</p>
            <p className={styles.emptySub}>去「今天」视图的「想法」区块记一条吧</p>
          </div>
        ) : (
          <>
            <div className={styles.count}>共 {total} 条想法</div>
            {groups.map((g) => {
              const items = g.items.filter((n) => visible.has(n.id))
              if (items.length === 0) return null
              const { y, m, d } = fromKey(g.date)
              return (
                <div key={g.date}>
                  <div className={styles.groupTitle}>
                    <span className={styles.groupDate}>
                      {m}月{d}日
                    </span>
                    <span className={styles.groupSub}>
                      {y} 年 · 周{DOW[dowOf(g.date)]}
                      {g.lunar ? ` · ${g.lunar}` : ''}
                    </span>
                    <span className={styles.groupCount}>{g.items.length} 条</span>
                  </div>
                  {items.map((n) => (
                    <button key={n.id} type="button" className={styles.item} onClick={() => onItem(n)}>
                      <span className={styles.itemText}>{n.text}</span>
                      <span className={styles.itemTime}>{hhmm(n.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )
            })}
            {total > PAGE_SIZE && (
              <div className={styles.pager}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page <= 1}
                  onClick={() => setNotesPage(page - 1)}
                >
                  ‹ 上一页
                </button>
                <span className={styles.pageInfo}>
                  {page} / {pages}
                </span>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page >= pages}
                  onClick={() => setNotesPage(page + 1)}
                >
                  下一页 ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
