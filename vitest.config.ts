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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'cloudbase/functions/**/*.test.js'],
    exclude: ['node_modules', 'dist', 'prototype', 'coverage'],
    restoreMocks: true,
    // 后端函数测试（cloudbase/functions/**/*.test.js）：
    // CJS 顶层 require 不走 vi.mock/alias，改用 cloudbase/functions/node_modules/ 下的测试专用替身包
    // （main 指向 __mocks__/*.cjs，见 README「后端测试」；node_modules 已 gitignore，不随部署上传）
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      exclude: ['src/core/**/*.test.ts', 'src/core/index.ts'],
      // PRD §10：core 覆盖率 ≥ 80%
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
})
