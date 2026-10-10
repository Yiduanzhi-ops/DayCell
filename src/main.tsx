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
import { App } from '@/ui/App'
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

  const cfg = readSyncConfig()
  if (cfg) syncEngine.setTransport(buildTransport(cfg))

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
  createRoot(el).render(<App store={store} />)

  // v8.1：启动后台拉取——不在首屏关键路径；失败静默（本地照常用，下次打开重试）
  if (cfg) void syncEngine.pull().catch(() => {})

  // SW 注册放在首帧之后——注册与预缓存安装都不该占首屏关键路径（PRD §5.1）。
  // 策略见 ADR-0002（v8.19 起 autoUpdate）：新 SW 安装即 skipWaiting 激活（由 vite-plugin-pwa
  // 生成的 sw.js 自带），下次导航/刷新即用新版，PWA 常驻用户不再卡旧版；纯 precache 无
  // runtime caching，激活不中断已加载页面。注册失败静默忽略（离线是增强，不是前提）。
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    })
  }
}

void main()
