/**
 * 首次使用引导（v8.22 onboarding）——全屏覆盖层，手机/桌面同构。
 *
 * 产品形态（与用户多轮原型迭代确认，v7 口径）：
 *  - 6 屏：总览 → 今日视图 → 周/月视图 → 目标管理 → 纪念日 → 数据安全
 *  - 仅首次出现：由 main.tsx 在启动时检测本地标记（daycell-onboarding-v1），
 *    未看过才打开；「跳过 / 开始使用」都会经 closeOnboarding 写入标记，之后不再打扰
 *  - 可从「使用手册」（ShareView）重新观看，重看不重置标记
 *  - 视觉对齐产品令牌：极简黑白灰 + 单一强调色（--accent），夜间模式自动适配
 *  - 首屏品牌 logo 居中 + 6 个亮点网格 + 「添加到主屏幕」提示条
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './OnboardingView.module.css'

const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`

const STEPS = 6

// 首屏 6 个功能亮点（两列网格，单行）
const HIGHLIGHTS: { icon: string; label: string }[] = [
  { icon: '✓', label: '待办·习惯·想法' },
  { icon: '◎', label: '目标·阶段·进度' },
  { icon: '▦', label: '周 / 月双视图' },
  { icon: '♥', label: '纪念日提醒' },
  { icon: '⇄', label: '多端同步' },
  { icon: '▣', label: '本地备份' },
]

function IlluOverview(): JSX.Element {
  return (
    <svg viewBox="0 0 240 150" className={styles.illuSvg} aria-hidden="true">
      <rect x="18" y="18" width="96" height="52" rx="13" fill="var(--bg)" stroke="var(--line)" />
      <rect x="30" y="30" width="22" height="22" rx="8" fill="var(--accent-soft)" />
      <path d="M36 41 l4 4 8 -9" stroke="var(--accent)" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="62" y="45" fontSize="11" fontWeight="700" fill="var(--ink)">待办</text>
      <rect x="126" y="18" width="96" height="52" rx="13" fill="var(--bg)" stroke="var(--line)" />
      <rect x="138" y="30" width="22" height="22" rx="8" fill="var(--accent-soft)" />
      <circle cx="149" cy="41" r="5" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <path d="M147 41 l2 2 4 -4" stroke="var(--accent)" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="170" y="45" fontSize="11" fontWeight="700" fill="var(--ink)">习惯</text>
      <rect x="18" y="80" width="96" height="52" rx="13" fill="var(--bg)" stroke="var(--line)" />
      <rect x="30" y="92" width="22" height="22" rx="8" fill="var(--accent-soft)" />
      <rect x="40" y="98" width="12" height="10" rx="2" fill="var(--accent)" />
      <text x="62" y="107" fontSize="11" fontWeight="700" fill="var(--ink)">目标</text>
      <rect x="126" y="80" width="96" height="52" rx="13" fill="var(--bg)" stroke="var(--line)" />
      <rect x="138" y="92" width="22" height="22" rx="8" fill="var(--accent-soft)" />
      <path d="M145 103 h8 M145 99 l4 -3 4 3 M145 107 l4 3 4 -3" stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="170" y="107" fontSize="11" fontWeight="700" fill="var(--ink)">想法</text>
    </svg>
  )
}

function IlluToday(): JSX.Element {
  return (
    <svg viewBox="0 0 240 150" className={styles.illuSvg} aria-hidden="true">
      <rect x="30" y="22" width="180" height="20" rx="7" fill="var(--bg)" stroke="var(--line)" />
      <text x="42" y="36" fontSize="10" fill="var(--ink-3)">待办</text>
      <rect x="88" y="28" width="20" height="7" rx="3" fill="var(--ink-4)" />
      <text x="112" y="35" fontSize="9" fill="var(--ink-3)">写教案</text>
      <rect x="88" y="40" width="20" height="7" rx="3" fill="var(--accent-soft)" />
      <text x="112" y="47" fontSize="9" fill="var(--accent)">背申论</text>
      <rect x="168" y="26" width="22" height="13" rx="6" fill="var(--accent)" />
      <text x="179" y="36" fontSize="9" fontWeight="700" fill="var(--bg)" textAnchor="middle">顺延</text>
      <rect x="30" y="50" width="180" height="26" rx="9" fill="var(--bg)" stroke="var(--line)" />
      <text x="42" y="66" fontSize="10" fill="var(--ink-3)">今日习惯</text>
      <circle cx="100" cy="63" r="8" fill="var(--accent-soft)" />
      <path d="M96 63 l3 3 6 -6" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="128" cy="63" r="8" fill="var(--bg-hover)" stroke="var(--ink-4)" />
      <path d="M125 63 l2 2 4 -4" stroke="var(--ink-4)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <text x="144" y="67" fontSize="9" fill="var(--ink-3)">多喝水 · 每天</text>
      <rect x="30" y="84" width="180" height="26" rx="9" fill="var(--bg)" stroke="var(--line)" />
      <text x="42" y="100" fontSize="10" fill="var(--ink-3)">想法</text>
      <rect x="92" y="92" width="106" height="10" rx="5" fill="var(--bg-hover)" />
      <path d="M186 84 l8 6 -8 6" stroke="var(--accent)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}

function IlluWeekMonth(): JSX.Element {
  return (
    <svg viewBox="0 0 240 150" className={styles.illuSvg} aria-hidden="true">
      <rect x="16" y="16" width="94" height="96" rx="13" fill="var(--bg)" stroke="var(--line)" />
      <rect x="26" y="26" width="74" height="16" rx="7" fill="var(--bg-hover)" />
      <text x="36" y="37" fontSize="9.5" fontWeight="700" fill="var(--ink-3)">周视图</text>
      <rect x="26" y="50" width="74" height="9" rx="4.5" fill="var(--bg-subtle)" />
      <rect x="70" y="50" width="12" height="9" rx="4.5" fill="var(--accent)" fillOpacity=".8" />
      <rect x="26" y="66" width="74" height="9" rx="4.5" fill="var(--bg-subtle)" />
      <rect x="26" y="82" width="74" height="9" rx="4.5" fill="var(--bg-subtle)" />
      <rect x="40" y="82" width="16" height="9" rx="4.5" fill="var(--accent)" fillOpacity=".4" />
      <rect x="26" y="98" width="74" height="9" rx="4.5" fill="var(--bg-subtle)" />
      <rect x="130" y="16" width="94" height="96" rx="13" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.6" />
      <rect x="140" y="26" width="74" height="16" rx="7" fill="var(--accent-soft)" />
      <text x="150" y="37" fontSize="9.5" fontWeight="700" fill="var(--accent)">月视图</text>
      <g fill="var(--bg-subtle)">
        <rect x="140" y="50" width="12" height="10" rx="3" /><rect x="156" y="50" width="12" height="10" rx="3" /><rect x="172" y="50" width="12" height="10" rx="3" /><rect x="188" y="50" width="12" height="10" rx="3" /><rect x="204" y="50" width="12" height="10" rx="3" />
        <rect x="140" y="64" width="12" height="10" rx="3" /><rect x="156" y="64" width="12" height="10" rx="3" /><rect x="172" y="64" width="12" height="10" rx="3" /><rect x="188" y="64" width="12" height="10" rx="3" /><rect x="204" y="64" width="12" height="10" rx="3" />
        <rect x="140" y="78" width="12" height="10" rx="3" /><rect x="156" y="78" width="12" height="10" rx="3" /><rect x="172" y="78" width="12" height="10" rx="3" /><rect x="188" y="78" width="12" height="10" rx="3" /><rect x="204" y="78" width="12" height="10" rx="3" />
        <rect x="140" y="92" width="12" height="10" rx="3" /><rect x="156" y="92" width="12" height="10" rx="3" /><rect x="172" y="92" width="12" height="10" rx="3" /><rect x="188" y="92" width="12" height="10" rx="3" /><rect x="204" y="92" width="12" height="10" rx="3" />
      </g>
      <rect x="140" y="50" width="12" height="10" rx="3" fill="var(--accent)" />
      <rect x="156" y="64" width="12" height="10" rx="3" fill="var(--accent)" fillOpacity=".55" />
      <rect x="204" y="78" width="12" height="10" rx="3" fill="var(--accent)" fillOpacity=".35" />
    </svg>
  )
}

function IlluGoals(): JSX.Element {
  return (
    <svg viewBox="0 0 240 150" className={styles.illuSvg} aria-hidden="true">
      <defs>
        <linearGradient id="ob-g4" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-strong)" />
        </linearGradient>
      </defs>
      <rect x="20" y="16" width="122" height="94" rx="14" fill="var(--bg)" stroke="var(--line)" />
      <text x="34" y="36" fontSize="11" fontWeight="700" fill="var(--ink)">备考上岸</text>
      <rect x="34" y="44" width="94" height="6" rx="3" fill="var(--bg-subtle)" />
      <rect x="34" y="44" width="58" height="6" rx="3" fill="url(#ob-g4)" />
      <text x="132" y="43" fontSize="9" fill="var(--accent)" textAnchor="end">62%</text>
      <rect x="34" y="60" width="94" height="20" rx="7" fill="var(--bg-hover)" />
      <circle cx="44" cy="70" r="4" fill="var(--ink-3)" />
      <rect x="54" y="67" width="56" height="6" rx="3" fill="var(--ink-4)" />
      <rect x="34" y="86" width="94" height="20" rx="7" fill="var(--bg-hover)" />
      <circle cx="44" cy="96" r="4" fill="var(--accent)" />
      <rect x="54" y="93" width="42" height="6" rx="3" fill="var(--ink-4)" />
      <rect x="156" y="26" width="66" height="22" rx="11" fill="var(--accent-soft)" />
      <text x="189" y="41" fontSize="10" fontWeight="700" fill="var(--accent)" textAnchor="middle">阶段 · 3</text>
      <rect x="156" y="56" width="66" height="22" rx="11" fill="var(--bg)" stroke="var(--line)" />
      <text x="189" y="71" fontSize="10" fill="var(--ink-3)" textAnchor="middle">子任务 · 5</text>
      <rect x="156" y="86" width="66" height="22" rx="11" fill="var(--bg)" stroke="var(--line)" />
      <text x="189" y="101" fontSize="10" fill="var(--ink-3)" textAnchor="middle">进度 · 62%</text>
    </svg>
  )
}

function IlluAnniv(): JSX.Element {
  return (
    <svg viewBox="0 0 240 150" className={styles.illuSvg} aria-hidden="true">
      <rect x="16" y="16" width="208" height="22" rx="9" fill="var(--bg-hover)" />
      <text x="30" y="31" fontSize="10" fill="var(--ink-3)">2026 年 10 月</text>
      <g fontSize="9" fill="var(--ink-3)">
        <text x="44" y="62">日</text><text x="80" y="62">一</text><text x="116" y="62">二</text><text x="152" y="62">三</text><text x="188" y="62">四</text><text x="224" y="62">五</text><text x="44" y="98">六</text><text x="80" y="98">日</text><text x="116" y="98">一</text><text x="152" y="98">二</text><text x="188" y="98">三</text><text x="224" y="98">四</text>
      </g>
      <rect x="36" y="68" width="36" height="30" rx="8" fill="var(--bg)" stroke="var(--line)" />
      <text x="54" y="86" fontSize="11" fontWeight="700" fill="var(--ink)" textAnchor="middle">12</text>
      <rect x="38" y="90" width="32" height="12" rx="6" fill="#ffe9ea" />
      <text x="54" y="99" fontSize="8" fill="#e05a63" textAnchor="middle">♥ 纪念日</text>
      <rect x="84" y="68" width="36" height="30" rx="8" fill="var(--bg-subtle)" />
      <text x="102" y="86" fontSize="11" fill="var(--ink-3)" textAnchor="middle">13</text>
      <rect x="132" y="68" width="36" height="30" rx="8" fill="var(--bg-subtle)" />
      <text x="150" y="86" fontSize="11" fill="var(--ink-3)" textAnchor="middle">14</text>
      <rect x="180" y="68" width="36" height="30" rx="8" fill="var(--bg-subtle)" />
      <text x="198" y="86" fontSize="11" fill="var(--ink-3)" textAnchor="middle">15</text>
      <rect x="36" y="104" width="36" height="26" rx="8" fill="var(--bg-subtle)" />
      <text x="54" y="121" fontSize="11" fill="var(--ink-3)" textAnchor="middle">19</text>
    </svg>
  )
}

function IlluData(): JSX.Element {
  return (
    <svg viewBox="0 0 240 150" className={styles.illuSvg} aria-hidden="true">
      <defs>
        <linearGradient id="ob-g5" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-strong)" />
        </linearGradient>
      </defs>
      <rect x="16" y="34" width="66" height="52" rx="12" fill="var(--bg-hover)" />
      <rect x="24" y="44" width="24" height="14" rx="4" fill="var(--ink-4)" />
      <rect x="54" y="44" width="16" height="14" rx="4" fill="var(--accent)" fillOpacity=".55" />
      <rect x="158" y="34" width="66" height="52" rx="12" fill="var(--bg-hover)" />
      <rect x="166" y="44" width="24" height="14" rx="4" fill="var(--ink-4)" />
      <rect x="196" y="44" width="16" height="14" rx="4" fill="var(--accent)" fillOpacity=".55" />
      <path d="M92 60 q14 -12 28 0 q14 12 28 0" stroke="var(--ink-4)" fill="none" strokeWidth="2" strokeDasharray="3 3" />
      <circle cx="120" cy="24" r="17" fill="url(#ob-g5)" />
      <path d="M120 30 v9 M120 18 v3" stroke="var(--bg)" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M128 24 h9 M125 24 h3" stroke="var(--bg)" strokeWidth="2.4" strokeLinecap="round" />
      <rect x="30" y="102" width="180" height="22" rx="10" fill="var(--bg)" stroke="var(--line)" />
      <text x="44" y="116" fontSize="9.5" fill="var(--ink-3)">同步 · 备份 · 导入导出 · 主屏幕</text>
    </svg>
  )
}

/** 每屏文案（用户多轮确认口径） */
const PAGES: { title: string; sub: string; points?: string[]; illu: () => JSX.Element }[] = [
  {
    title: '欢迎使用 DayCell',
    sub: '以「一天」为格子的个人管理工具：待办、想法、习惯、目标，每日一页',
    illu: IlluOverview,
  },
  {
    title: '今日视图',
    sub: '待办 / 习惯 / 想法，分区块呈现',
    points: ['待办完成自动沉底', '习惯每日纯勾选打卡', '想法随手记录不打断'],
    illu: IlluToday,
  },
  {
    title: '周 / 月视图',
    sub: '周看内容，月看密度',
    points: ['周视图：一周内容一览', '月视图：全月密度一览', '底部导航一键切换'],
    illu: IlluWeekMonth,
  },
  {
    title: '目标管理',
    sub: '长期目标不进每日待办',
    points: ['一个目标一个阶段推进', '子任务 + 进度 + 描述', '与每日待办互不干扰'],
    illu: IlluGoals,
  },
  {
    title: '纪念日',
    sub: '重要日子，自动提醒',
    points: ['每周 / 每月 / 每年', '月视图格内徽章展示', '自定义名称与日期'],
    illu: IlluAnniv,
  },
  {
    title: '数据在你手里',
    sub: '本地存储，多端同步，随时备份',
    points: ['数据存本机，离线可用', '电脑手机多端同步', '一键备份 / 导入 / 导出'],
    illu: IlluData,
  },
]

export function OnboardingView(): JSX.Element {
  const closeOnboarding = useApp((s) => s.closeOnboarding)
  const [step, setStep] = useState(0)

  const last = step === STEPS - 1
  const page = PAGES[step]

  const goNext = (): void => {
    if (last) closeOnboarding()
    else setStep(step + 1)
  }

  return (
    <div className={styles.overlay} data-testid="onboarding">
      <div className={styles.page}>
        <div className={styles.top}>
          <span />
          <button className={styles.skip} onClick={closeOnboarding}>
            跳过
          </button>
        </div>

        <div className={styles.body} key={step}>
          <div className={styles.illu}>{step === 0 ? <img className={styles.logo} src={LOGO_URL} alt="DayCell" /> : <page.illu />}</div>
          <h1 className={styles.title}>{page.title}</h1>
          <p className={styles.sub}>{page.sub}</p>

          {step === 0 ? (
            <div className={styles.grid}>
              <div className={styles.hlRow}>
                {HIGHLIGHTS.map((h) => (
                  <div className={styles.gc} key={h.label}>
                    <span className={styles.gcIcon}>{h.icon}</span>
                    <b>{h.label}</b>
                  </div>
                ))}
              </div>
              <div className={styles.tipWrap}>
                <span className={styles.plus}>+</span>
                添加到主屏幕，获取 APP 使用体验
              </div>
            </div>
          ) : (
            <div className={styles.pts}>
              {page.points?.map((p) => (
                <div className={styles.pt} key={p}>
                  <span className={styles.ptIcon}>✓</span>
                  {p}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.foot}>
          <div className={styles.track} role="tablist" aria-label="引导进度">
            {Array.from({ length: STEPS }, (_, i) => (
              <button
                key={i}
                className={i === step ? `${styles.seg} ${styles.segOn}` : styles.seg}
                aria-label={`第 ${i + 1} 屏`}
                aria-selected={i === step}
                onClick={() => setStep(i)}
              />
            ))}
          </div>
          <button className={last ? `${styles.next} ${styles.nextAcc}` : styles.next} onClick={goNext}>
            {last ? '开始使用' : '下一步'}
          </button>
          <button className={styles.prev} onClick={() => setStep(Math.max(0, step - 1))} hidden={step === 0}>
            上一步
          </button>
        </div>
      </div>
    </div>
  )
}
