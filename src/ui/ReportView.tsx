/**
 * 回顾页第三 tab「报告」（v9.10）：每周/每月报告。
 *
 * 分层（方案拍板口径，勿另起）：
 *  - 报告主体（概览/习惯/待办/特殊日/目标）= **纯本地免费**，
 *    数字一律来自 core/report.ts（aggregates.buildReport），口径收敛在 core。
 *  - AI 结构化深度复盘（L2 六段）= **会员专属**：调 cloudbase.aiReview（/ai/review，
 *    后端 DeepSeek 分析，会员 daily 配额）；非会员尾部显示「升级解锁」。
 *  - 周/月切换、前后翻页都走 store（reportKind/reportCursor/loadReport），
 *    换档自动清掉旧 AI 结果（store 侧），避免张冠李戴。
 */
import { useCallback, useEffect, useState, type JSX } from 'react'
import { useApp } from '@/app/context'
import { fromKey, type ReportAiResult, type ReportData } from '@core'
import { aiReview, fetchMember, getAccessToken } from './cloudbase'
import styles from './ReportView.module.css'

const DOW = ['一', '二', '三', '四', '五', '六', '日']

/** L2 六段展示顺序与标题（后端返回同名字段） */
const AI_SECTIONS: Array<{ key: keyof ReportAiResult; title: string }> = [
  { key: 'trend', title: '效率趋势' },
  { key: 'habits', title: '习惯警报' },
  { key: 'procrastination', title: '拖延信号' },
  { key: 'thoughts', title: '想法洞察' },
  { key: 'goals', title: '目标偏差' },
  { key: 'advice', title: '下周建议' },
]

export function ReportView(): JSX.Element {
  const report = useApp((s) => s.report)
  const reportLoading = useApp((s) => s.reportLoading)
  const reportKind = useApp((s) => s.reportKind)
  const reportCursor = useApp((s) => s.reportCursor)
  const reportAi = useApp((s) => s.reportAi)
  const reportAiError = useApp((s) => s.reportAiError)
  const setReportKind = useApp((s) => s.setReportKind)
  const shiftReport = useApp((s) => s.shiftReport)
  const loadReport = useApp((s) => s.loadReport)
  const setReportAi = useApp((s) => s.setReportAi)

  const [member, setMember] = useState<boolean | null>(null)

  // 会员判定（轻量：仅报告页使用，不污染全局状态）
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const token = await getAccessToken()
        if (!token) {
          if (alive) setMember(false)
          return
        }
        const m = await fetchMember(token)
        if (alive) setMember(m.ok ? (m.member ?? false) : false)
      } catch {
        if (alive) setMember(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // 兜底：切进 tab 时 store 已触发 loadReport，这里补一次（换档后 report 为空时）
  useEffect(() => {
    if (!report && !reportLoading) void loadReport()
  }, [report, reportLoading, loadReport])

  const runAi = useCallback(async (): Promise<void> => {
    if (!report) return
    const token = await getAccessToken()
    if (!token) {
      setReportAi(null, '请先在「设置 › 账号与同步」登录')
      return
    }
    const res = await aiReview(token, report.aiFeed)
    if (res.ok && res.review) {
      setReportAi(res.review, null)
    } else {
      setReportAi(null, res.error ?? '生成失败，请稍后再试')
    }
  }, [report, setReportAi])

  if (reportLoading && !report) {
    return (
      <div className={styles.page} data-testid="report-view">
        <div className={styles.loading}>统计中…</div>
      </div>
    )
  }

  return (
    <section className={styles.page} data-testid="report-view" aria-label="周/月报告">
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
          <AiCard
            member={member}
            reportAi={reportAi}
            reportAiError={reportAiError}
            onRun={runAi}
          />
        </div>
      )}
    </section>
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

/** AI 结构化深度复盘：会员生成六段，非会员「升级解锁」 */
function AiCard({
  member,
  reportAi,
  reportAiError,
  onRun,
}: {
  member: boolean | null
  reportAi: ReportAiResult | null
  reportAiError: string | null
  onRun: () => void
}): JSX.Element {
  return (
    <section className={styles.block} aria-label="AI 深度复盘">
      <h2 className={styles.blockTitle}>AI 深度复盘</h2>

      {reportAi ? (
        <div className={styles.aiBody}>
          {AI_SECTIONS.map((sec) => (
            <div key={sec.key} className={styles.aiSec}>
              <h3 className={styles.aiSecTitle}>{sec.title}</h3>
              <p className={styles.aiSecText}>{reportAi[sec.key] || '—'}</p>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className={styles.aiHint}>
            基于本周期数据，用 AI 做结构化复盘：效率趋势、习惯警报、拖延信号、想法洞察、目标偏差与下周建议。
          </p>
          {member === false ? (
            <div className={styles.aiLock}>
              <p className={styles.aiLockMain}>升级 DayCell 会员解锁</p>
              <p className={styles.aiLockSub}>AI 深度复盘为会员专属功能</p>
            </div>
          ) : (
            <button type="button" className={styles.aiBtn} onClick={() => void onRun()}>
              生成深度复盘
            </button>
          )}
          {reportAiError && <p className={styles.aiErr}>{reportAiError}</p>}
        </>
      )}
    </section>
  )
}
