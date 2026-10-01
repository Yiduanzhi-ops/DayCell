import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // GitHub Pages 项目页部署在 https://Yiduanzhi-ops.github.io/DayCell/ 子路径下，
  // 必须显式设置 base，否则构建产物的 /assets/... 绝对路径会指向站点根目录而 404
  base: '/DayCell/',
  plugins: [
    react(),
    // PWA（ADR-0002，v7.1 接线）：
    //  - 预缓存全部构建产物（JS/CSS/HTML/图标，含懒加载的 lunar chunk）→ 首访后完整离线（US-11）
    //  - registerType 'prompt' = skipWaiting/clientsClaim 均 false：**不在运行中偷换资源**（E20），
    //    所有页签关闭后新 SW 自然激活；"有新版本"提示 v0 不做 UI，留给 S1/S2 里程碑
    //  - 不注册任何 runtime caching：v0 运行时零网络请求（PRD §5.4），没有可缓存的东西
    //  - devOptions 保持关闭：开发时 SW 缓存只会干扰调试（ADR-0002 后果节）
    VitePWA({
      registerType: 'prompt',
      // 注册由 src/main.tsx 手动做（挂载后、window load 时）——不让插件再往 HTML 注入
      // registerSW.js，否则同一个 sw.js 被注册两条路径，行为虽幂等但归属不清
      injectRegister: null,
      // 图标不写 includeAssets：它们已被 workbox.globPatterns 的 *.png 捕获，
      // 两处都写会在 precache 清单里出现重复条目（实测 18 条里 5 条重复）
      manifest: {
        name: 'DayCell',
        short_name: 'DayCell', // v7.6 用户拍板：应用名统一 DayCell
        description: '以「一天」为容器的记录本：待办、想法、花费。作者：以端枳。',
        lang: 'zh-CN',
        start_url: '/DayCell/?source=pwa', // ADR-0002：标记启动来源，不做埋点上报（PRD §5.4）；前缀与 base 保持一致
        scope: '/DayCell/',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        icons: [
          { src: '/DayCell/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/DayCell/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/DayCell/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        navigateFallback: '/DayCell/index.html', // 任意路径断网可打开（ADR-0002）；前缀与 base 保持一致
        // 42 格月视图 + 10 年数据的首屏与 lunar chunk 都远小于此默认上限，无需调
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  css: {
    // ADR-0007：用 Lightning CSS 压缩与降级，比默认 PostCSS 快且产物更小
    transformer: 'lightningcss',
    lightningcss: {
      // 目标浏览器与 PRD §5.3 一致：iOS Safari 16.4+、Chrome/Edge 最近两版
      targets: { ios_saf: (16 << 16) | (4 << 8), chrome: 112 << 16, firefox: 115 << 16 },
    },
  },
  build: {
    cssMinify: 'lightningcss',
    rollupOptions: {
      output: {
        // Vite 8 用 Rolldown，manualChunks 只接受函数形式（对象形式已不支持）。
        // 农历库不需要在这里处理——ADR-0004 要求它经动态 import，Vite 会自动切成独立 chunk，
        // 并由 Workbox 一并预缓存（构建产物，不是 runtime caching）。
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom')) return 'react-dom'
          if (id.includes('node_modules/react')) return 'react'
          if (id.includes('node_modules/lunar-typescript')) return 'lunar'
          return undefined
        },
      },
    },
    // PRD §5.1 首屏预算 ≤ 80 KB gzip；超了由 scripts/report-size.mjs 报错，这里不设硬限以免开发期频繁失败
    chunkSizeWarningLimit: 300,
  },
  server: {
    host: '127.0.0.1',
    port: 5188,
    strictPort: true,
  },
})
