/**
 * 回顾 tab（v8.13 想法列表 → v8.42 改名回顾）：顶部 [想法 | 复盘] 切换。
 *  - 想法列表（v8.13）：按天分组、10 条/页、收藏置顶、点击原地编辑（v8.31）、删除带确认
 *  - 复盘列表（v8.42）：每日一条、日期倒序、10 条/页、日期 + 正文摘要 + 箭头，点条目进对应日视图
 *  - 返回语义：窄屏记来源（view='notes' + 页码 + 滚动位），返回精确还原
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { useApp } from '@/app/context'
import { NoteBody } from './NoteBody'
import { dowOf, fromKey, loadLunar, lunarFullText, type DateKey, type NoteRecord } from '@core'
import styles from './NotesView.module.css'
import { ReportView } from './ReportView'

/** v8.13：10 条一页（用户拍板）；复盘列表同规格（v8.42） */
const PAGE_SIZE = 10
const DOW = ['日', '一', '二', '三', '四', '五', '六']

interface Group {
  date: DateKey
  lunar: string
  items: NoteRecord[]
  /** v8.30：收藏组（pinned 置顶、无标题渲染，星标按钮保留） */
  pinned?: boolean
}

/** createdAt → 'HH:MM'（与今日视图同一口径） */
const hhmm = (ms: number): string => {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

export function NotesView(): JSX.Element {
  const notesList = useApp((s) => s.notesList)
  const notesPage = useApp((s) => s.notesPage)
  const setNotesPage = useApp((s) => s.setNotesPage)
  const toggleNotePinned = useApp((s) => s.toggleNotePinned)
  const deleteNote = useApp((s) => s.deleteNote)
  const restore = useApp((s) => s.restoreScrollTo)
  const consumeRestore = useApp((s) => s.consumeRestoreScroll)
  // v8.42：回顾页 [想法|复盘] 切换 + 复盘列表
  const reviewTab = useApp((s) => s.reviewTab)
  const setReviewTab = useApp((s) => s.setReviewTab)
  const reviewsList = useApp((s) => s.reviewsList)
  const reviewPage = useApp((s) => s.reviewPage)
  const setReviewPage = useApp((s) => s.setReviewPage)
  const openDayFromNotes = useApp((s) => s.openDayFromNotes)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [lunarMap, setLunarMap] = useState<ReadonlyMap<string, string>>(new Map())
  /** v8.31：正在原地编辑的想法 id（同一时刻最多一条） */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** v9.11（方案 B）：报告全屏页的返回来源（进入前是想法还是复盘） */
  const fromTabRef = useRef<'notes' | 'reviews'>('notes')

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

  // 分组：收藏（pinned）置顶、**不渲染标题**（v8.30，星标按钮即标识）；
  // 其余按天分组（notesList 已倒序，顺序遍历即分组+组内有序）
  const groups = useMemo<Group[]>(() => {
    const out: Group[] = []
    const pinned = notesList.filter((n) => n.pinned)
    const rest = notesList.filter((n) => !n.pinned)
    if (pinned.length > 0) out.push({ date: '__pinned__' as DateKey, lunar: '', items: pinned, pinned: true })
    for (const n of rest) {
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

  const onDelete = (n: NoteRecord): void => {
    if (window.confirm(`删除这条想法？`)) void deleteNote(n.id)
  }

  // v8.42 复盘列表：每日一条、日期倒序、10 条/页，点条目进对应日视图
  const rvTotal = reviewsList.length
  const rvPages = Math.max(1, Math.ceil(rvTotal / PAGE_SIZE))
  const rvPage = Math.min(reviewPage, rvPages)
  const rvFrom = (rvPage - 1) * PAGE_SIZE
  const rvVisible = reviewsList.slice(rvFrom, Math.min(rvFrom + PAGE_SIZE, rvTotal))

  const openReviewDay = (k: DateKey): void => {
    // 与想法列表点条目进日视图同语义：窄屏记来源返回，宽屏直接切日视图
    openDayFromNotes(k, 0)
  }

  // v9.11（方案 B）：报告不再是 seg 同级 tab，改为第二行入口卡片 → 全屏报告页
  const openReport = (): void => {
    fromTabRef.current = reviewTab === 'reviews' ? 'reviews' : 'notes'
    setReviewTab('report')
  }

  return (
    <section className={styles.page} data-testid="notes-view" aria-label="回顾列表">
      {/* v8.42：顶部 [想法 | 复盘] 分段切换（v9.11 报告移出，不再同级） */}
      <div className={styles.seg} role="tablist" aria-label="回顾内容">
        <button
          type="button"
          role="tab"
          aria-selected={reviewTab === 'notes'}
          className={reviewTab === 'notes' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
          onClick={() => setReviewTab('notes')}
        >
          想法
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={reviewTab === 'reviews'}
          className={reviewTab === 'reviews' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
          onClick={() => setReviewTab('reviews')}
        >
          复盘
        </button>
      </div>
      {/* v9.11（方案 B）：第二行报告入口卡片，点击进全屏报告页 */}
      <div className={styles.reportRow}>
        <div
          className={styles.reportCard}
          role="button"
          tabIndex={0}
          aria-label="查看每周/每月报告"
          onClick={openReport}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              openReport()
            }
          }}
        >
          <span className={styles.reportIc} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16M6 16v-6M10 16V7M14 16v-9M18 16v-4" />
            </svg>
          </span>
          <span className={styles.reportTx}>
            <b>报告</b>
            <span>每周 / 每月总结 · AI 深度复盘</span>
          </span>
          <span className={styles.reportArrow} aria-hidden="true">›</span>
        </div>
      </div>
      {/* v9.10：报告用全屏覆盖层（ReportView 自带滚动布局）；想法/复盘共用原 .list 容器 */}
      {reviewTab === 'report' ? (
        <ReportView onBack={() => setReviewTab(fromTabRef.current)} />
      ) : (
      <div className={styles.list} ref={scrollRef}>
        {reviewTab === 'reviews' ? (
          rvTotal === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyMain}>还没有写过复盘</p>
              <p className={styles.emptySub}>去「今天」视图的「复盘」区块记一条吧</p>
            </div>
          ) : (
            <>
              <div className={styles.count}>共 {rvTotal} 天复盘</div>
              {rvVisible.map((r) => {
                const { m, d } = fromKey(r.date)
                return (
                  <div
                    key={r.id}
                    className={styles.rvRow}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看 ${m}月${d}日复盘`}
                    onClick={() => openReviewDay(r.date)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        openReviewDay(r.date)
                      }
                    }}
                  >
                    <span className={styles.rvDate}>
                      {m}/{d}
                      <span className={styles.rvDow}>周{DOW[dowOf(r.date)]}</span>
                    </span>
                    <span className={styles.rvText}>{r.text}</span>
                    <span className={styles.rvArrow} aria-hidden="true">›</span>
                  </div>
                )
              })}
              {rvTotal > PAGE_SIZE && (
                <div className={styles.pager}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={rvPage <= 1}
                    onClick={() => setReviewPage(rvPage - 1)}
                  >
                    ‹ 上一页
                  </button>
                  <span className={styles.pageInfo}>
                    {rvPage} / {rvPages}
                  </span>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    disabled={rvPage >= rvPages}
                    onClick={() => setReviewPage(rvPage + 1)}
                  >
                    下一页 ›
                  </button>
                </div>
              )}
            </>
          )
        ) : total === 0 ? (
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
              return (
                <div key={g.date}>
                  {!g.pinned && (
                    (() => {
                      const { y, m, d } = fromKey(g.date)
                      return (
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
                      )
                    })()
                  )}
                  <div className={g.pinned ? `${styles.gbox} ${styles.gboxPin}` : styles.gbox}>
                    {items.map((n) =>
                      editingId === n.id ? (
                        <NoteEdit key={n.id} note={n} onDone={() => setEditingId(null)} />
                      ) : (
                        <div key={n.id} className={styles.item}>
                          <span className={styles.itemText}>
                            {/* v9.44：正文只读（可选中复制，超 3 行折起可展开），编辑走独立按钮 */}
                            <NoteBody text={n.text} clamp={3} />
                          </span>
                          <span className={styles.itemActs}>
                            <span className={styles.itemTime}>{hhmm(n.createdAt)}</span>
                            <span className={styles.actsSp} />
                            <button
                              type="button"
                              className={styles.edit}
                              aria-label={`编辑想法：${n.text}`}
                              title="编辑"
                              onClick={() => setEditingId(n.id)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={styles.icon}
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path d="M3 21l1.2-4.5L15.5 5.2a2.1 2.1 0 0 1 3 3L7.2 19.5 3 21z" />
                                <path d="M13.4 7.3l3.3 3.3" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className={styles.del}
                              aria-label="删除这条想法"
                              onClick={() => onDelete(n)}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={styles.icon}
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path d="M4.5 4.5l15 15M19.5 4.5L4.5 19.5" />
                              </svg>
                            </button>
                            <span
                              className={n.pinned ? `${styles.star} ${styles.starOn}` : styles.star}
                              role="button"
                              tabIndex={0}
                              aria-label={n.pinned ? '取消收藏' : '收藏'}
                              onClick={() => void toggleNotePinned(n.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  void toggleNotePinned(n.id)
                                }
                              }}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                className={styles.icon}
                                aria-hidden="true"
                                focusable="false"
                              >
                                <path d="M12 3.25L14.06 9.17L20.32 9.3L15.33 13.08L17.14 19.08L12 15.5L6.86 19.08L8.67 13.08L3.68 9.3L9.94 9.17Z" />
                              </svg>
                            </span>
                          </span>
                        </div>
                      ),
                    )}
                  </div>
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
      )}
    </section>
  )
}

/**
 * 就地编辑一条想法（v8.31，交互与日视图 NoteSection 一致）：
 * 裸回车换行、⌘/Ctrl+Enter 或「保存」提交、Esc 取消、失焦「有改动即保存」。
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
    <div className={styles.nedit}>
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
          if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
            return
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            finish(true)
          }
        }}
      />
      <div className={styles.acts}>
        <button className={styles.cancel} onClick={() => finish(false)}>
          取消
        </button>
        <button className={styles.save} onClick={() => finish(true)}>
          保存
        </button>
      </div>
    </div>
  )
}
