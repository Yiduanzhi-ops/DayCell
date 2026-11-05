/**
 * 周/月报告（v8.74 移植自 v9-backend v9.11 全屏覆盖层，本地版）。
 *
 * 分层（方案拍板口径，勿另起）：
 *  - 报告主体（概览/习惯/待办/特殊日/目标）= **纯本地免费**，
 *    数字一律来自 core/report.ts（aggregates.buildReport），口径收敛在 core。
 *  - v8.74 无 AI 深度复盘段（v9-backend 该段为会员专属、依赖后端 /ai/review，
 *    main 为纯前端分支，故裁掉）。
 *  - 周/月切换、前后翻页都走 store（reportKind/reportCursor/loadReport），
 *    换档自动清掉旧结果，避免张冠李戴。
 *  - 全屏覆盖层（仿 ChangelogView），左上角「‹ 返回」回进入前的 tab
 *    （想法/复盘，由 NotesView 记 fromTab 传入 onBack）。
 */
import { useEffect, type JSX } from 'react'
import { useApp } from '@/app/context'
import { fromKey, type ReportData } from '@core'
import styles from './ReportView.module.css'

const DOW = ['一', '二', '三', '四', '五', '六', '日']

export function ReportView({ onBack }: { onBack?: () => void }): JSX.Element {
  const report = useApp((s) => s.report)
  const reportLoading = useApp((s) => s.reportLoading)
  const reportKind = useApp((s) => s.reportKind)
  const reportCursor = useApp((s) => s.reportCursor)
  const setReportKind = useApp((s) => s.setReportKind)
  const shiftReport = useApp((s) => s.shiftReport)
  const loadReport = useApp((s) => s.loadReport)
  const setReviewTab = useApp((s) => s.setReviewTab)

  // 全屏覆盖层左上角返回（onBack 由 NotesView 传入；兜底回「想法」）
  const back = (): void => {
    if (onBack) onBack()
    else setReviewTab('notes')
  }

  // 兜底：切进 tab 时 store 已触发 loadReport，这里补一次（换档后 report 为空时）
  useEffect(() => {
    if (!report && !reportLoading) void loadReport()
  }, [report, reportLoading, loadReport])

  if (reportLoading && !report) {
    return (
      <div className={styles.overlay} data-testid="report-view" aria-label="周/月报告">
        <div className={styles.page}>
          <div className={styles.head}>
            <button type="button" className={styles.back} onClick={back}>
              ‹ 返回
            </button>
            <span className={styles.title}>报告</span>
            <span className={styles.headSpacer} />
          </div>
          <div className={styles.loading}>统计中…</div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.overlay} data-testid="report-view" aria-label="周/月报告">
      <div className={styles.page}>
        {/* 全屏覆盖层头部：‹ 返回 + 报告 + 占位（仿 ChangelogView） */}
        <div className={styles.head}>
          <button type="button" className={styles.back} onClick={back}>
            ‹ 返回
          </button>
          <span className={styles.title}>报告</span>
          <span className={styles.headSpacer} />
        </div>
        {/* 顶部：周/月切换 + 前后翻页 + 期号 */}
        <div className={styles.header}>
          <div className={styles.seg} role="tablist" aria-label="报告周期">
            <button
              type="button"
              role="tab"
              aria-selected={reportKind === 'week'}
              className={reportKind === 'week' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
              onClick={() => setReportKind('week')}
            >
              周报
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={reportKind === 'month'}
              className={reportKind === 'month' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
              onClick={() => setReportKind('month')}
            >
              月报
            </button>
          </div>
          <div className={styles.nav}>
            <button
              type="button"
              className={styles.navBtn}
              aria-label="上一期"
              onClick={() => void shiftReport(-1)}
            >
              ‹
            </button>
            <span className={styles.period}>{report?.period.label ?? reportCursor}</span>
            <button
              type="button"
              className={styles.navBtn}
              aria-label="下一期"
              onClick={() => void shiftReport(1)}
            >
              ›
            </button>
          </div>
        </div>

        {!report ? (
          <div className={styles.empty}>
            <p className={styles.emptyMain}>统计失败</p>
            <p className={styles.emptySub}>下拉重试，或切换周期再试</p>
          </div>
        ) : (
          <div className={styles.scroll}>
            <OverviewCard report={report} />
            <SpecialDays report={report} />
            <HabitsCard report={report} />
            <GoalsCard report={report} />
            <TodoCard report={report} />
          </div>
        )}
      </div>
    </div>
  )
}

/** 概览：完成率 + 六格小指标 */
function OverviewCard({ report }: { report: ReportData }): JSX.Element {
  const o = report.overview
  return (
    <div className={styles.card}>
      <div className={styles.ovTop}>
        <span className={styles.ovRate}>{o.completionRate}%</span>
        <span className={styles.ovRateLabel}>待办完成率</span>
      </div>
      <div className={styles.ovGrid}>
        <MiniStat label="活跃天数" value={`${o.activeDays}/${o.days}`} />
        <MiniStat label="完成待办" value={String(o.todoDone)} />
        <MiniStat label="总待办" value={String(o.todoTotal)} />
        <MiniStat label="习惯打卡" value={String(o.checkinCount)} />
        <MiniStat label="想法" value={String(o.noteCount)} />
        <MiniStat label="复盘天数" value={String(o.reviewDays)} />
      </div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className={styles.mini}>
      <span className={styles.miniVal}>{value}</span>
      <span className={styles.miniLabel}>{label}</span>
    </div>
  )
}

/** 特殊日（纪念日/成就日/里程碑日） */
function SpecialDays({ report }: { report: ReportData }): JSX.Element {
  const days = report.specialDays
  return (
    <section className={styles.block} aria-label="特殊日">
      <h2 className={styles.blockTitle}>特殊日</h2>
      {days.length === 0 ? (
        <p className={styles.blockEmpty}>这个周期没有纪念日或里程碑</p>
      ) : (
        <ul className={styles.spList}>
          {days.map((s) => {
            const { m, d } = fromKey(s.date)
            return (
              <li key={`${s.date}-${s.title}`} className={styles.spRow}>
                <span className={styles.spDate}>
                  {m}/{d}
                </span>
                <span className={s.checked ? `${styles.spTitle} ${styles.spDone}` : styles.spTitle}>
                  {s.title}
                </span>
                {s.checked && <span className={styles.spChecked}>✓</span>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** 习惯：应打/实打/最长连续 */
function HabitsCard({ report }: { report: ReportData }): JSX.Element {
  const rows = report.habits
  return (
    <section className={styles.block} aria-label="习惯">
      <h2 className={styles.blockTitle}>习惯</h2>
      {rows.length === 0 ? (
        <p className={styles.blockEmpty}>没有活跃习惯</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((h) => (
            <li key={h.habitId} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{h.name}</span>
                <span className={styles.rowSub}>
                  {h.freq.kind === 'daily' ? '每天' : '每周'} · 应打 {h.dueCount} / 实打 {h.doneCount}
                </span>
              </span>
              <span
                className={h.streak >= 3 ? `${styles.streak} ${styles.streakHot}` : styles.streak}
              >
                连打 {h.streak} 天
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 目标：进度 + 子任务 + 打卡天数 */
function GoalsCard({ report }: { report: ReportData }): JSX.Element {
  const rows = report.goals
  return (
    <section className={styles.block} aria-label="目标">
      <h2 className={styles.blockTitle}>目标完成情况</h2>
      {rows.length === 0 ? (
        <p className={styles.blockEmpty}>没有进行中的目标</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((g) => (
            <li key={g.goalId} className={styles.row}>
              <span className={styles.rowMain}>
                <span className={styles.rowTitle}>{g.title}</span>
                <span className={styles.rowSub}>
                  子任务 {g.subtaskDone}/{g.subtaskTotal} · 打卡 {g.workDays} 天
                  {g.pct !== undefined && g.pct !== null ? ` · 进度 ${g.pct}%` : ''}
                </span>
              </span>
              {g.pct !== undefined && g.pct !== null && (
                <span className={styles.pct}>{g.pct}%</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 待办统计：完成/逾期/顺延 + 最忙一天 + 周内分布 */
function TodoCard({ report }: { report: ReportData }): JSX.Element {
  const t = report.todoStats
  const max = Math.max(...t.weekdayDone, 1)
  return (
    <section className={styles.block} aria-label="待办统计">
      <h2 className={styles.blockTitle}>待办统计</h2>
      <div className={styles.todoStats}>
        <MiniStat label="完成" value={String(t.done)} />
        <MiniStat label="逾期" value={String(t.overdue)} />
        <MiniStat label="顺延" value={String(t.rolled)} />
        <MiniStat
          label="最忙一天"
          value={t.busiestDay ? `${fromKey(t.busiestDay.date).m}/${fromKey(t.busiestDay.date).d}` : '—'}
        />
      </div>
      <div className={styles.week}>
        {t.weekdayDone.map((n, i) => (
          <div key={i} className={styles.weekCol} title={`周${DOW[i]} ${n} 件`}>
            <div className={styles.weekBarWrap}>
              <div
                className={styles.weekBar}
                style={{ height: `${Math.round((n / max) * 100)}%` }}
              />
            </div>
            <span className={styles.weekDow}>周{DOW[i]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
