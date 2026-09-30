import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
    },
  },
  test: {
    // ADR-0006 铁律：默认 environment 是 **node**，不是 jsdom。
    // core 层若在模块顶层访问 window/document，加载时就会抛 ReferenceError。
    // 需要 DOM 的 UI 测试在文件首行写：  // @vitest-environment jsdom
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'dist', 'prototype', 'coverage'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/index.ts'],
      // PRD §10：core 覆盖率 ≥ 80%
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
