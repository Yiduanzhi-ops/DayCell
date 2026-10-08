/**
 * 分享与手册页（v8.3）——推广与上手引导，全屏覆盖层，手机/桌面同构。
 *
 * 内容刻意极简（用户要求"尽量简洁"）：
 *  - 品牌 + 一句话定位
 *  - 网址 + 一键复制链接
 *  - 「添加到主屏幕」分平台指引（iOS / Android / 桌面）
 *  - 三步上手（写入 / 习惯与目标 / 菜单里的备份导出）
 *  - 多设备同步一句话（菜单 → 同步设置，填自己的 Gitee 私有仓库）
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import { BrandMark } from './BrandMark'
import styles from './ShareView.module.css'

const APP_URL = 'https://yiduanzhi-ops.github.io/DayCell/'

export function ShareView(): JSX.Element {
  const closeShare = useApp((s) => s.closeShare)
  const showToast = useApp((s) => s.showToast)
  const [copied, setCopied] = useState(false)

  const copyLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(APP_URL)
      setCopied(true)
      showToast('链接已复制')
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('复制失败，请长按网址手动复制')
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeShare}>
            ← 返回
          </button>
          <h1 className={styles.h1}>分享与手册</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          <div className={styles.brand}>
            <BrandMark />
            <div className={styles.brandText}>
              <div className={styles.appName}>DayCell</div>
              <div className={styles.tagline}>以「一天」为格子的个人记录本：待办、想法、习惯、目标，一天一页</div>
            </div>
          </div>

          <div className={styles.linkBox}>
            <span className={styles.url}>{APP_URL}</span>
            <button className={styles.copyBtn} onClick={() => void copyLink()}>
              {copied ? '已复制 ✓' : '复制链接'}
            </button>
          </div>

          <h2 className={styles.h2}>添加到主屏幕（推荐）</h2>
          <ul className={styles.rows}>
            <li className={styles.row}>
              <span className={styles.rowName}>iPhone / iPad</span>
              <span className={styles.rowDesc}>Safari 打开网址 → 底部「分享」按钮 → 添加到主屏幕</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowName}>安卓</span>
              <span className={styles.rowDesc}>Chrome 右上角「⋮」→ 添加到主屏幕 / 安装应用</span>
            </li>
            <li className={styles.row}>
              <span className={styles.rowName}>电脑</span>
              <span className={styles.rowDesc}>Chrome / Edge 地址栏右侧「安装」图标 → 安装 DayCell</span>
            </li>
          </ul>
          <p className={styles.note}>装好后像 App 一样独立打开、全屏显示，数据存在你的浏览器本地。</p>

          <h2 className={styles.h2}>三步上手</h2>
          <ol className={styles.steps}>
            <li>打开网页就能记：「今天」页直接写待办和想法，按 + 添加</li>
            <li>底部 tab 切「习惯」「目标」：每日打卡、阶段性目标单独管理</li>
            <li>右上角菜单：备份 / 导出 / 夜间模式 / 同步设置都在这里</li>
          </ol>

          <h2 className={styles.h2}>多设备同步</h2>
          <p className={styles.note}>
            手机、电脑想数据互通？右上角菜单 → 同步设置，填自己的 Gitee 私有仓库即可自动互相同步。
          </p>
        </div>
      </div>
    </div>
  )
}
