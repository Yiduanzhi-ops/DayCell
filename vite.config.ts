import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// PWA 插件（ADR-0002）留到 PWA 里程碑再接入，避免与 Vite 8 的兼容性未验证时就污染基础配置。
export default defineConfig({
  plugins: [react()],
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
        // 农历库不需要在这里处理——ADR-0004 要求它经动态 import，Vite 会自动切成独立 chunk。
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
