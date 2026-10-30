import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // base 用相对路径 './'（v9.3 修复）：
  //  - CloudBase 预览站：根路径部署 → ./assets/... 解析为 /assets/... ✓
  //  - GitHub Pages：子路径 /DayCell/ → ./assets/... 解析为 /DayCell/assets/... ✓
  //  - 此前默认 '/DayCell/' 绝对前缀，CloudBase 根路径下全部资源 404 → 加载动画后白屏
  //  - Tauri 桌面壳本地加载产物时由 beforeBuildCommand 注入 VITE_BASE=./（保持兼容）
  base: process.env.VITE_BASE || './',
  plugins: [
    react(),
    // PWA（ADR-0002，v7.1 接线；v9.3 改 injectManifest 自定义 SW）：
    //  - 预缓存全部构建产物（JS/CSS/HTML/图标，含懒加载的 lunar chunk）→ 首访后完整离线（US-11）
    //  - registerType 'autoUpdate'（v8.19 起）：新 SW 安装即 skipWaiting 激活（clientsClaim），
    //    下次导航/刷新即用新版——此前 'prompt' 策略让新 SW 永远 waiting，PWA 常驻用户
    //    （主屏幕图标打开）反复退出重进都收不到新版，实测卡在旧版本页；
    //    DayCell 无 runtime caching、纯 precache，激活不会中断已加载页面，风险可控（E20 豁免）
    //  - 不注册任何 runtime caching：v0 运行时零网络请求（PRD §5.4），没有可缓存的东西
    //  - devOptions 保持关闭：开发时 SW 缓存只会干扰调试（ADR-0002 后果节）
    //  - v9.3 改 strategies:'injectManifest'：src/sw.ts 自定义 SW（Web Push 的
    //    push/notificationclick 监听 + 导航回退），manifest 相对化（./ 前缀）——
    //    CloudBase 预览站是根路径部署，GitHub Pages 是 /DayCell/ 子路径，
    //    绝对前缀只兼容其一，相对路径对两者都正确（manifest/SW 均随站点根解析）
    VitePWA({
      // Tauri 桌面壳（VITE_TAURI=1）不生成/注入 PWA 产物：壳从本地加载，SW 无用且
      // 自定义协议下注册易出问题；GitHub Pages 构建保持完整 PWA 能力。
      disable: !!process.env.VITE_TAURI,
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 注册由 src/main.tsx 手动做（挂载后、window load 时）——不让插件再往 HTML 注入
      // registerSW.js，否则同一个 sw.js 被注册两条路径，行为虽幂等但归属不清
      injectRegister: null,
      // 图标不写 includeAssets：它们已被 injectManifest.globPatterns 的 *.png 捕获，
      // 两处都写会在 precache 清单里出现重复条目（实测 18 条里 5 条重复）
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
      },
      manifest: {
        name: 'DayCell',
        short_name: 'DayCell', // v7.6 用户拍板：应用名统一 DayCell
        description: '以「一天」为容器的记录本：待办、习惯、目标、想法。作者：以端枳。',
        lang: 'zh-CN',
        // v9.3 相对化：start_url/scope/icons 均相对 manifest 自身解析
        //（CloudBase 根路径 → ./ 即站点根；GitHub Pages /DayCell/ → ./ 即 /DayCell/）
        start_url: './?source=pwa', // ADR-0002：标记启动来源，不做埋点上报（PRD §5.4）
        scope: './',
        display: 'standalone',
        background_color: '#FFFFFF',
        theme_color: '#FFFFFF',
        icons: [
          { src: './pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: './pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: './maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
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
    host: '0.0.0.0',
    port: 5188,
    strictPort: true,
    // v9.5 本地调试：dev 下前端以同源 /daycell-api 访问后端，
    // 由 Vite 代理转发到 CloudBase 网关，绕开安全域名（CORS）白名单限制
    proxy: {
      '/daycell-api': {
        target: 'https://coding-daycell-d3g1vgq8g521cb2a6.service.tcloudbase.com',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
