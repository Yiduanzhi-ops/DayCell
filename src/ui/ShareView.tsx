/**
 * 使用手册页（v8.3 分享与手册 → v8.6 更名「使用手册」）——推广与上手引导，全屏覆盖层。
 *
 * 内容（用户口径"尽量简洁"）：
 *  - 品牌 + 一句话定位
 *  - 网址 + 一键复制链接
 *  - 「添加到主屏幕」分平台指引（iOS / Android / 桌面）
 *  - 三步上手（写入 / 习惯与目标 / 菜单里的备份导出）
 *  - 多设备同步一句话（菜单 → 同步设置，填自己的 Gitee 私有仓库）
 *  - v8.6：GitHub 仓库链接、GitHub Issues 反馈入口、数据安全一句话
 *  - v8.6：一键生成分享图——原生 canvas 品牌海报（logo + 品牌名 + 一句话 +
 *    卖点：多端同步 / 数据安全 / App 体验 / 产品功能 + 网址 + 二维码 + 版本号），
 *    二维码用轻量 qrcode 库**动态加载**（独立 chunk，不拖首屏）；
 *    生成后弹全屏预览：手机长按保存、桌面点下载
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import { BrandMark } from './BrandMark'
import { CURRENT_VERSION } from './ChangelogView'
import styles from './ShareView.module.css'

const APP_URL = 'https://yiduanzhi-ops.github.io/DayCell/'
const REPO_URL = 'https://github.com/Yiduanzhi-ops/DayCell'
const ISSUES_URL = 'https://github.com/Yiduanzhi-ops/DayCell/issues'

// 分享图卖点（用户拍板）：多端同步 / 数据安全 / App 体验 / 产品功能
const SELL_POINTS: { title: string; desc: string }[] = [
  { title: '多端同步', desc: '手机电脑数据自动互通' },
  { title: '数据安全', desc: '存于浏览器本地，同步即异地备份' },
  { title: 'App 体验', desc: '添加到主屏幕，像原生应用' },
  { title: '产品功能', desc: '待办 · 想法 · 习惯 · 目标，一天一页' },
]

/** 手写圆角矩形（不依赖 ctx.roundRect，兼容性最稳） */
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/** 画品牌 logo（accent 圆角方块 + 白色田字格线 + 右上实心格，与 BrandMark 同构） */
function drawLogo(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, accent: string): void {
  const r = size * 0.22
  rr(ctx, cx - size / 2, cy - size / 2, size, size, r)
  ctx.fillStyle = accent
  ctx.fill()
  // 白色田字格线（中心十字）
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = Math.max(2, size * 0.05)
  ctx.beginPath()
  ctx.moveTo(cx, cy - size / 2 + r * 0.4)
  ctx.lineTo(cx, cy + size / 2 - r * 0.4)
  ctx.moveTo(cx - size / 2 + r * 0.4, cy)
  ctx.lineTo(cx + size / 2 - r * 0.4, cy)
  ctx.stroke()
  // 右上实心小格
  const cell = size * 0.28
  rr(ctx, cx + size / 2 - cell * 1.15, cy - size / 2 + cell * 0.15, cell, cell, cell * 0.22)
  ctx.fillStyle = '#fff'
  ctx.fill()
}

export function ShareView(): JSX.Element {
  const closeShare = useApp((s) => s.closeShare)
  const openOnboarding = useApp((s) => s.openOnboarding)
  const showToast = useApp((s) => s.showToast)
  const [copied, setCopied] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [poster, setPoster] = useState<string | null>(null)

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

  const openExternal = (url: string): void => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  /** 生成品牌海报（1080×1440，3:4）：原生 canvas，二维码动态加载 */
  const generatePoster = async (): Promise<void> => {
    if (generating) return
    setGenerating(true)
    try {
      const QRCode = (await import('qrcode')).default
      const W = 1080
      const H = 1440
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        showToast('当前环境不支持生成分享图')
        return
      }
      const accent = '#3478F6'
      const ink = '#1F2329'
      const ink2 = '#4E5969'
      const ink3 = '#86909C'
      const cardBg = '#F7F8FA'
      const line = '#E5E6EB'

      // 背景：白底 + 顶部浅色格子（呼应「人生小格」）
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, W, H)
      ctx.strokeStyle = '#EDEFF2'
      ctx.lineWidth = 1
      for (let x = 0; x < W; x += 108) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, 360)
        ctx.stroke()
      }
      for (let y = 0; y < 360; y += 108) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(W, y)
        ctx.stroke()
      }

      // 品牌区
      drawLogo(ctx, W / 2, 150, 128, accent)
      ctx.textAlign = 'center'
      ctx.fillStyle = ink
      ctx.font = '700 92px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText('DayCell', W / 2, 360)
      ctx.fillStyle = ink2
      ctx.font = '600 38px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText('人生小格', W / 2, 425)
      ctx.fillStyle = ink2
      ctx.font = '400 30px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText('以「一天」为格子的个人记录本：待办、想法、习惯、目标，一天一页', W / 2, 490)

      // 卖点
      ctx.fillStyle = ink
      ctx.font = '600 34px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText('为什么用它', W / 2, 575)
      const cardW = 470
      const cardH = 172
      const gap = 30
      const x0 = (W - cardW * 2 - gap) / 2
      const y0 = 620
      SELL_POINTS.forEach((p, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const x = x0 + col * (cardW + gap)
        const y = y0 + row * (cardH + gap)
        rr(ctx, x, y, cardW, cardH, 18)
        ctx.fillStyle = cardBg
        ctx.fill()
        ctx.strokeStyle = line
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = accent
        ctx.font = '650 32px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(p.title, x + 28, y + 62)
        ctx.fillStyle = ink2
        ctx.font = '400 27px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
        ctx.fillText(p.desc, x + 28, y + 112)
        ctx.textAlign = 'center'
      })

      // 网址
      ctx.fillStyle = ink
      ctx.font = '500 32px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText(APP_URL, W / 2, 1030)

      // 二维码（qrcode 动态加载后绘制）
      const qrSize = 260
      const qr = await QRCode.toDataURL(APP_URL, { width: qrSize, margin: 1 })
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('二维码加载失败'))
        img.src = qr
      })
      ctx.drawImage(img, (W - qrSize) / 2, 1085, qrSize, qrSize)

      // 版本号
      ctx.fillStyle = ink3
      ctx.font = '400 28px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif'
      ctx.fillText(`${CURRENT_VERSION} · DayCell 使用手册`, W / 2, 1390)

      setPoster(canvas.toDataURL('image/png'))
    } catch (e) {
      showToast(e instanceof Error ? e.message : '生成分享图失败，请重试')
    } finally {
      setGenerating(false)
    }
  }

  const downloadPoster = (): void => {
    if (!poster) return
    const a = document.createElement('a')
    a.href = poster
    a.download = 'DayCell-分享图.png'
    a.click()
    showToast('分享图已保存')
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeShare}>
            ← 返回
          </button>
          <h1 className={styles.h1}>使用手册</h1>
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

          <h2 className={styles.h2}>首次使用引导</h2>
          <button className={styles.posterBtn} onClick={openOnboarding}>
            重新观看引导
          </button>
          <p className={styles.note}>想再看一遍 DayCell 的功能总览？随时回到这里重看，不影响使用。</p>

          <h2 className={styles.h2}>多设备同步</h2>
          <p className={styles.note}>
            手机、电脑想数据互通？右上角菜单 → 同步设置，填自己的 Gitee 私有仓库即可自动互相同步。
          </p>

          <h2 className={styles.h2}>分享 DayCell</h2>
          <button className={styles.posterBtn} disabled={generating} onClick={() => void generatePoster()}>
            {generating ? '生成中…' : '一键生成分享图'}
          </button>
          <p className={styles.note}>生成品牌分享图（含网址二维码），手机长按保存、桌面可下载，直接发给朋友。</p>

          <h2 className={styles.h2}>项目与反馈</h2>
          <div className={styles.rows}>
            <button className={styles.linkRow} onClick={() => openExternal(REPO_URL)}>
              <span className={styles.rowName}>GitHub 仓库</span>
              <span className={styles.rowDesc}>查看源码 · 更新记录 · 给 DayCell 点个 Star →</span>
            </button>
            <button className={styles.linkRow} onClick={() => openExternal(ISSUES_URL)}>
              <span className={styles.rowName}>问题反馈</span>
              <span className={styles.rowDesc}>遇到问题或想要新功能？去 GitHub 提 issue →</span>
            </button>
          </div>
          <p className={styles.note}>
            数据安全：你的数据只存在自己的浏览器里；配好 Gitee 同步后，同步即异地备份。换设备 / 清缓存前请先导出备份。
          </p>
        </div>
      </div>

      {/* 分享图预览（手机长按保存 / 桌面下载） */}
      {poster && (
        <div className={styles.preview} onClick={() => setPoster(null)}>
          <div className={styles.previewCard} onClick={(e) => e.stopPropagation()}>
            <img src={poster} alt="DayCell 分享图（长按保存）" />
            <div className={styles.previewActions}>
              <button className={styles.btnGhost} onClick={() => setPoster(null)}>关闭</button>
              <button className={styles.btnPrimary} onClick={downloadPoster}>下载图片</button>
            </div>
            <p className={styles.previewHint}>手机端可长按图片直接保存</p>
          </div>
        </div>
      )}
    </div>
  )
}
