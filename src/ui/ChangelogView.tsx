/**
 * 版本更新页（v8.4）——全屏覆盖层，手机/桌面同构，风格对齐 ShareView/SyncSettings。
 *
 * 数据硬编码在下方 CHANGELOG（每次发版在头部加一条），倒序展示（最新在上）。
 * 每版只列 1–3 条用户可感知的要点（"尽量简洁"），页首显示当前版本号。
 */
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './ChangelogView.module.css'

const CURRENT_VERSION = 'v8.4'

/** 版本要点（倒序：最新在最前）。维护约定：发版时在数组头部插入新条目。 */
const CHANGELOG: { version: string; date: string; items: string[] }[] = [
  {
    version: 'v8.4',
    date: '2026-10-08',
    items: [
      '新增「版本更新」页，每版要点倒序展示',
      '右上角菜单按钮改为更明显的汉堡按钮',
      '移除「关于」占位项；周/月视图不再显示支出汇总',
    ],
  },
  {
    version: 'v8.3',
    date: '2026-10-08',
    items: ['新增「分享与手册」页：一键复制网址、添加到主屏幕指引、三步上手'],
  },
  {
    version: 'v8.2',
    date: '2026-10-08',
    items: ['跨设备同步改走 Gitee 私有仓库：配置一次自动同步，同步即异地备份'],
  },
  {
    version: 'v8.1',
    date: '2026-10-08',
    items: ['新增跨设备同步（坚果云通道）'],
  },
  {
    version: 'v8.0',
    date: '2026-10-08',
    items: [
      '新增习惯模块：今日视图习惯打卡、习惯设置（频率自选）',
      '今日视图移除支出区块（记账走 iCost）',
    ],
  },
  {
    version: 'v7.9',
    date: '2026-10-07',
    items: ['新增「目标」模块：阶段性目标 + 阶段列表 + 阐述总结，底部 tab 进入'],
  },
  {
    version: 'v7.8',
    date: '2026-10-03',
    items: ['logo 高清化重制：更清晰、符合应用图标形状'],
  },
  {
    version: 'v7.7',
    date: '2026-10-01',
    items: ['更换 logo 为用户提供的图标'],
  },
  {
    version: 'v7.6',
    date: '2026-10-01',
    items: [
      '「花费」改为「支出」，添加支出无需指定分类',
      '待办完成后自动移到列表最下方',
      '导出文件时提示保存位置',
      '应用名改为 DayCell',
    ],
  },
  {
    version: 'v7.5',
    date: '2026-10-01',
    items: ['新增右上角菜单：备份导出 / 合并导入 / 一键导出 MD / 纪念日设置 / 夜间模式'],
  },
  {
    version: 'v7.4',
    date: '2026-10-01',
    items: ['录入改为手动弹窗，不再自动弹出', '今日顶栏移除日期与周几（内容区保留）'],
  },
  {
    version: 'v7.3',
    date: '2026-10-01',
    items: ['应用名定为 DayCell，底部新增「今天 / 周 / 月」视图切换器'],
  },
  {
    version: 'v7.2',
    date: '2026-10-01',
    items: ['手机端录入体验打磨：去掉回车保存字样、录入不放大页面'],
  },
  {
    version: 'v7.1',
    date: '2026-09-30',
    items: ['月视图改为三行格布局，新增启动页'],
  },
  {
    version: 'v6.1',
    date: '2026-09-29',
    items: ['今日视图上线，移除顶部重复录入行'],
  },
]

export function ChangelogView(): JSX.Element {
  const closeChangelog = useApp((s) => s.closeChangelog)

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeChangelog}>
            ← 返回
          </button>
          <h1 className={styles.h1}>版本更新</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          <div className={styles.current}>
            <span className={styles.currentBadge}>当前版本 {CURRENT_VERSION}</span>
          </div>
          <ul className={styles.list}>
            {CHANGELOG.map((entry) => (
              <li key={entry.version} className={styles.item}>
                <div className={styles.itemHead}>
                  <span className={styles.ver}>{entry.version}</span>
                  <span className={styles.date}>{entry.date}</span>
                </div>
                <ul className={styles.items}>
                  {entry.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
