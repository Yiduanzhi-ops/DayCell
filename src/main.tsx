/**
 * 生产入口：装配 core → 建 app store → 首次数据加载 → 挂载 React。
 *
 * 启动顺序是刻意的（PRD §5.1 首屏关键路径）：
 *  1. initCore 里 IndexedDB 打开 + 分类播种是同步等待的（没数据没法渲染）
 *  2. 农历库经 loadLunar **动态 import**，失败按 E4 降级为 null，不阻塞也不炸
 *  3. 首帧渲染的是日视图（今天）——aggregateDayDetail 只查 [昨天, 今天] 两天
 *
 * v8.1/v8.2 云同步（v8.2 现行通道：Gitee 私有仓库文件——坚果云 WebDAV 不支持浏览器
 * CORS、LeanCloud 已停服，均实测不可用，见 ADR-0009）：
 *  - initCore 传 wrapStore：让 repo 全部写操作都经过包装层，写后触发防抖推送
 *  - 引擎先于 store 创建，status 回调经闭包 sink 接到 store（设置页展示）
 *  - 有配置则 buildTransport 并 setTransport；首帧渲染**之后**后台 pull 一次（失败静默，不打扰）
 *
 * 启动页（#splash，v7.1）在 index.html 里自管生命周期：**固定显示 1.5s** 后淡出，
 * 与本文件的挂载时机无关（用户拍板要完整展示 branding）。应用通常在 1.5s 内已就绪，
 * 在 splash 底下完成首帧；即使启动抛错，splash 也会按时退场，不会卡死白屏。
 */
import { createRoot } from 'react-dom/client'
import { createSyncEngine, today, type SyncEngine, type SyncStatus } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore, readOnboardingSeen } from '@/app/store'
import { buildTransport, readSyncConfig, wrapStoreForSync } from '@/app/sync'
import { buildCloudTransport } from '@/app/cloudSync'
import { isCloudLoggedIn } from '@/ui/cloudbase'
import { App } from '@/ui/App'
import { init as tapGuardInit } from '@/ui/tapGuard'
import '@/ui/tokens.css'

async function main(): Promise<void> {
  // engine 先于 store 创建：wrapStore 的写回调与 onStatus 都经闭包引用它
  let syncEngine: SyncEngine | null = null
  let statusSink: ((s: SyncStatus) => void) | null = null

  const bundle = await initCore({
    wrapStore: (s) => wrapStoreForSync(s, () => syncEngine),
  })

  syncEngine = createSyncEngine({
    store: bundle.store,
    onStatus: (s) => statusSink?.(s),
  })

  // v9.1：CloudBase 登录态优先（auth 会话持久在 localStorage，刷新后仍在）；
  // 其次回落 Gitee 配置（老通道不受影响）；都没有 → 无自动同步（引擎静默跳过）
  const cloudLoggedIn = isCloudLoggedIn()
  const cfg = readSyncConfig()
  if (cloudLoggedIn) {
    syncEngine.setTransport(buildCloudTransport())
  } else if (cfg) {
    syncEngine.setTransport(buildTransport(cfg))
  }

  const store = createAppStore(bundle, {
    today: today(),
    sync: syncEngine,
    onSyncStatus: (fn) => {
      statusSink = fn
    },
  })
  await store.getState().init()

  // v8.22：首次使用引导——未看过本地标记则在首帧渲染前打开（仅首次自动出现；
  // 关闭/跳过写入标记，之后可从使用手册重看）。检测放 main 而非 App 组件内，
  // 让组件测试不受"自动弹出"影响。
  if (!readOnboardingSeen()) store.getState().openOnboarding()

  const el = document.getElementById('root')
  if (!el) throw new Error('#root 不存在')
  // v8.51：iOS 点击兜底——全局 capture click 监听（tapGuard 内部惰性注册一次）
  tapGuardInit()
  createRoot(el).render(<App store={store} />)

  // v8.1：启动后台拉取——不在首屏关键路径；失败静默（本地照常用，下次打开重试）
  if (cloudLoggedIn || cfg) void syncEngine.pull().catch(() => {})

  // SW 注册放在首帧之后——注册与预缓存安装都不该占首屏关键路径（PRD §5.1）。
  // 策略见 ADR-0002（v8.19 起 autoUpdate）：新 SW 安装即 skipWaiting 激活（由 vite-plugin-pwa
  // 生成的 sw.js 自带），下次导航/刷新即用新版，PWA 常驻用户不再卡旧版；纯 precache 无
  // runtime caching，激活不中断已加载页面。注册失败静默忽略（离线是增强，不是前提）。
  // v8.38 修复：此前误用绝对路径 register('/sw.js')——GitHub Pages 子路径部署（base=/DayCell/）
  // 下请求的是站点根目录的 sw.js（404），手机 PWA 注册静默失败、根本没有 SW，autoUpdate
  // 完全没生效，主屏 PWA 一直吃浏览器缓存旧版；改相对路径 'sw.js'（→ /DayCell/sw.js）+
  // updateViaCache:'none'（SW 脚本每次打开绕过 HTTP 缓存检查更新）+ waiting 主动 SKIP_WAITING 双保险。
  // Tauri 桌面壳（VITE_TAURI=1）由壳加载本地产物，无需 SW。
  if ('serviceWorker' in navigator && !import.meta.env.VITE_TAURI) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('sw.js', { updateViaCache: 'none' })
        .then((reg) => {
          // v9.9.1 主动更新检查 + 接管后自动刷新：
          // iOS Safari 主屏 PWA 只在被动周期/导航时检查新 SW（常 ≥24h），主屏刷新仍旧版
          // （无痕无旧 SW 所以直接新版）。这里显式 reg.update()（updateViaCache:none 已绕
          // HTTP 缓存），发现新版本 → 新 SW 安装即 skipWaiting 接管 → controllerchange →
          // 自动 reload 一次拿新版。无新版本时 update() 无副作用、不会触发 reload。
          void reg.update()
          let refreshing = false
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return
            refreshing = true
            window.location.reload()
          })
          // autoUpdate 生成的 sw.js 自带 install 时 skipWaiting，这里再兜一层：若出现 waiting
          // 状态的新 SW（极端时序），主动让它接管，保证下次导航即新版
          reg.waiting?.postMessage({ type: 'SKIP_WAITING' })
        })
        .catch(() => {})
    })
  }
}

void main()
