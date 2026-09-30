import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/** core 层禁止引入的模块（ADR-0006 铁律 1） */
const CORE_FORBIDDEN_IMPORTS = {
  patterns: [
    {
      group: ['react', 'react/*', 'react-dom', 'react-dom/*', '*.css', 'zustand', 'zustand/*'],
      message: 'core 层禁止依赖 React / 状态库 / 样式（ADR-0006 铁律 1）',
    },
    {
      group: ['../ui/*', '../app/*', '../../ui/*', '../../app/*', '@/ui/*', '@/app/*'],
      message: 'core 层不得反向依赖 ui / app（ADR-0006）',
    },
    {
      group: ['dayjs', 'date-fns', 'luxon', 'moment', 'lodash', 'lodash/*', 'uuid'],
      message: '禁止引入日期/工具库，见 ADR-0008（自写 core/date）与 CORE-API §1.3 依赖白名单',
    },
  ],
}

/** core 层禁止访问的全局（ADR-0006 铁律 2） */
const domGlobal = (name, extra = '') => ({
  name,
  message: `core 层禁止访问 ${name}，改用依赖注入${extra}（ADR-0006 铁律 2）`,
})

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prototype/**', 'dev-dist/**', '*.cjs', 'scripts/**'],
  },

  // ---------- 基础 ----------
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ---------- src 通用 ----------
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },

  // ---------- ADR-0006：core 层隔离（测试文件除外，测试需要 fake-indexeddb 等） ----------
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    languageOptions: {
      // 只给 ES 全局，不给 browser 全局；no-restricted-globals 再兜一层
      globals: {},
    },
    rules: {
      'no-restricted-imports': ['error', CORE_FORBIDDEN_IMPORTS],
      'no-restricted-globals': [
        'error',
        domGlobal('window'),
        domGlobal('document'),
        domGlobal('localStorage'),
        domGlobal('sessionStorage'),
        domGlobal('navigator'),
        domGlobal('indexedDB', '，通过 createIdbStore(deps) 注入'),
        domGlobal('caches'),
        { name: 'Date', message: '仅 core/date.ts 与 core/id.ts 允许直接使用 Date（ADR-0008）；其他模块请接收 DateKey 或注入的 now()' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message: '用注入的 now()，不要 Date.now()（ADR-0006 铁律 3）',
        },
      ],
    },
  },

  // ADR-0008：core/date.ts 与 core/id.ts 是**唯一**允许直接使用 Date 的模块
  // （Date 被关在这两个文件里，其他模块只见 DateKey）
  {
    files: ['src/core/date.ts', 'src/core/id.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        domGlobal('window'),
        domGlobal('document'),
        domGlobal('localStorage'),
        domGlobal('sessionStorage'),
        domGlobal('navigator'),
        domGlobal('caches'),
        domGlobal('indexedDB', '，通过 createIdbStore(deps) 注入'),
      ],
    },
  },
  // ADR-0006 铁律 3 的另一处豁免：全项目的 Date.now() 只允许出现在 clock.ts 这一行
  {
    files: ['src/core/clock.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      'no-restricted-globals': ['error', domGlobal('window'), domGlobal('document')],
    },
  },
  // store / migrate：必须用注入的 now()，既禁 DOM 全局也禁 Date.now()
  {
    files: ['src/core/migrate/**/*.ts', 'src/core/store/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        domGlobal('window'),
        domGlobal('document'),
        domGlobal('localStorage'),
        domGlobal('sessionStorage'),
        domGlobal('navigator'),
        domGlobal('caches'),
        { name: 'Date', message: 'store/migrate 请接收注入的 now()，默认值用 core/clock.ts 的 systemClock（ADR-0006 铁律 3）' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message: '用注入的 now()，不要 Date.now()；默认值请 import { systemClock }（ADR-0006 铁律 3）',
        },
      ],
    },
  },

  // ---------- ADR-0004：农历库只能通过 core/lunar.ts 动态加载 ----------
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/core/lunar.ts', 'src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...CORE_FORBIDDEN_IMPORTS,
          paths: [
            { name: 'lunar-typescript', message: '农历库必须经 core/lunar.ts 的 loadLunar() 动态加载（ADR-0004）' },
            { name: 'lunar-javascript', message: '统一用 lunar-typescript，且必须经 core/lunar.ts 动态加载（ADR-0004）' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/lunar.ts'],
    rules: {
      // lunar.ts 内部允许 import 农历库，但仍禁止 React / DOM
      'no-restricted-imports': ['error', CORE_FORBIDDEN_IMPORTS],
    },
  },

  // ---------- ADR-0006：core 的唯一出口 ----------
  {
    files: ['src/ui/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@core/*/*', '../core/*/*', '../../core/*/*'],
              message: 'UI/app 只能从 core 的唯一出口 @core（core/index.ts）导入，不得深入子模块（CORE-API 附录）',
            },
          ],
        },
      ],
    },
  },

  // ---------- React ----------
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ---------- 测试文件放宽 ----------
  {
    files: ['src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-globals': 'off',
      'no-restricted-syntax': 'off',
    },
  },
)
