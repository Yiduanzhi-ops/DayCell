/**
 * 安装引导开屏栏（v8.56）：手机端未安装 PWA 时，在今日视图顶部提示如何装到主屏幕。
 *
 * 显示规则（PRD 口径）：
 *  - 仅移动端（iOS / Android UA）显示；桌面浏览器不显示
 *  - 已安装（standalone 模式启动 / iOS navigator.standalone）不显示
 *  - 点 × 关闭后本地记住，不再打扰
 *  - 平台自适应：识别 iOS / 安卓显示对应文案；「查看步骤」展开对应平台的 3 步
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import styles from './InstallBanner.module.css'

const KEY = 'daycell-install-banner-dismissed'

type Platform = 'ios' | 'android' | null

/** 检测当前环境是否需要引导（返回平台；不需要返回 null）。失败静默降级为 null。 */
function detect(): Platform {
  try {
    // 已安装：standalone 启动 / iOS 专有 navigator.standalone → 不需要引导
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return null
    if ((navigator as { standalone?: boolean }).standalone) return null
    const ua = navigator.userAgent
    // iPadOS 桌面 UA（MacIntel + 触摸屏）也视为 iPad
    const isIOS =
      /iPhone|iPad|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
    const isAndroid = /Android/.test(ua)
    if (isIOS) return 'ios'
    if (isAndroid) return 'android'
    return null // 桌面浏览器
  } catch {
    return null
  }
}

export function InstallBanner(): JSX.Element | null {
  const [platform, setPlatform] = useState<Platform>(null)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY)) {
        setDismissed(true)
        return
      }
    } catch {
      /* 隐私模式等：继续检测，未关闭仍可显示 */
    }
    setPlatform(detect())
  }, [])

  if (dismissed || !platform) return null

  const dismiss = (): void => {
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  const steps =
    platform === 'android' ? (
      <>
        <div className={styles.plat}>安卓（Chrome / Edge）</div>
        <ol className={styles.list}>
          <li>
            用 <b>Chrome 或 Edge</b> 打开 DayCell
          </li>
          <li>
            点右上角 <b>⋮ 菜单</b>
          </li>
          <li>
            选 <b>「安装应用」</b>，桌面出现图标
          </li>
        </ol>
      </>
    ) : (
      <>
        <div className={styles.plat}>苹果（Safari）</div>
        <ol className={styles.list}>
          <li>
            用 <b>Safari</b> 打开 DayCell
          </li>
          <li>
            点底部 <b>分享 ↥</b> 按钮
          </li>
          <li>
            选 <b>「添加到主屏幕」→ 添加</b>
          </li>
        </ol>
      </>
    )

  return (
    <div className={styles.banner}>
      <div className={styles.ic} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="7" y="3" width="10" height="18" rx="2.5" />
          <path d="M12 7.5v6M9.5 10h5" />
          <path d="M11 17.5h2" />
        </svg>
      </div>
      <div className={styles.txt}>
        <div className={styles.t1}>把 DayCell 装到桌面</div>
        <div className={styles.t2}>
          {platform === 'android' ? (
            <div>
              <b>安卓</b>　Chrome / Edge 打开 → 菜单 ⋮ → 安装应用
            </div>
          ) : (
            <div>
              <b>苹果</b>　Safari 打开 → 分享 ↥ → 添加到主屏幕
            </div>
          )}
        </div>
        {open && <div className={styles.steps}>{steps}</div>}
      </div>
      <button
        className={styles.more}
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? '收起步骤' : '查看步骤'}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <button className={styles.x} type="button" aria-label="关闭安装提示" onClick={dismiss}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
