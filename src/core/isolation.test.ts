/**
 * ADR-0006 铁律的第二道验证。
 *
 * ESLint 的 no-restricted-globals 是静态检查，可能被 eslint-disable 绕过、也可能配错。
 * 这个测试是**运行时验证**：本文件的 vitest environment 是默认的 `node`（见 vitest.config.ts），
 * 那里没有 window / document / localStorage。任何 core 模块在顶层访问它们，
 * import 时就会抛 ReferenceError，测试直接红。
 *
 * ⚠️ 模块清单由 `import.meta.glob` 在**转换期**自动发现，不是手写列表——
 * 否则新增模块时忘记加进来，这道防线就有漏洞。
 *
 * 这里刻意不用 node:fs：core 的测试必须能在纯浏览器兼容的类型环境下编译。
 */
import { describe, it, expect } from 'vitest'

/** 懒加载：每个模块一个 () => Promise，import 时才真正执行顶层代码 */
const modules = import.meta.glob('./**/*.ts')

/** 原始源码文本，用于静态兜底扫描 */
const sources = import.meta.glob('./**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const sourceFiles = Object.keys(modules)
  .filter((f) => !f.endsWith('.test.ts') && !f.endsWith('isolation.test.ts'))
  .sort()

describe('core 层隔离（ADR-0006）', () => {
  it('确实扫描到了 core 源文件（防止 glob 失效导致假绿）', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(4)
    expect(sourceFiles.some((f) => f.endsWith('date.ts'))).toBe(true)
    expect(sourceFiles.some((f) => f.endsWith('validate.ts'))).toBe(true)
    expect(sourceFiles.some((f) => f.endsWith('types.ts'))).toBe(true)
  })

  it('测试环境里确实没有 DOM 全局（否则这道验证没有意义）', () => {
    expect(typeof globalThis.window).toBe('undefined')
    expect(typeof globalThis.document).toBe('undefined')
    expect(typeof globalThis.localStorage).toBe('undefined')
  })

  it.each(sourceFiles)('%s 可在无 DOM 环境加载', async (file) => {
    // 模块顶层若有 window.xxx，会在这里抛 ReferenceError
    const mod = await modules[file]!()
    expect(mod).toBeDefined()
  })

  it('源码文本里不出现 DOM 全局的直接访问（静态兜底）', () => {
    const banned: Array<[RegExp, string]> = [
      [/\bwindow\./, 'window'],
      [/\bdocument\./, 'document'],
      [/\blocalStorage\b/, 'localStorage'],
      [/\bsessionStorage\b/, 'sessionStorage'],
      [/\bnavigator\./, 'navigator'],
    ]
    const offenders: string[] = []

    for (const file of sourceFiles) {
      const src = sources[file] ?? ''
      src.split('\n').forEach((line, i) => {
        const t = line.trim()
        // 跳过注释行：文档里提到 window 是允许的
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
        for (const [re, name] of banned) {
          if (re.test(line)) offenders.push(`${file}:${i + 1}  用了 ${name}  →  ${t.slice(0, 60)}`)
        }
      })
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('没有 core 模块 import React / UI / 日期库（ADR-0006 + ADR-0008）', () => {
    const bannedImports = [
      /from\s+['"]react['"]/,
      /from\s+['"]react-dom['"]/,
      /from\s+['"]zustand['"]/,
      /from\s+['"]dayjs['"]/,
      /from\s+['"]date-fns['"]/,
      /from\s+['"]luxon['"]/,
      /from\s+['"]lodash/,
      /from\s+['"]uuid['"]/,
      /from\s+['"][^'"]*\.css['"]/,
      /from\s+['"]\.\.\/ui\//,
      /from\s+['"]\.\.\/app\//,
    ]
    const offenders: string[] = []
    for (const file of sourceFiles) {
      const src = sources[file] ?? ''
      for (const re of bannedImports) {
        if (re.test(src)) offenders.push(`${file}  匹配 ${re}`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('农历库只出现在 core/lunar.ts（ADR-0004：必须动态加载）', () => {
    const offenders = sourceFiles.filter(
      (f) => !f.endsWith('lunar.ts') && /lunar-(typescript|javascript)/.test(sources[f] ?? ''),
    )
    expect(offenders, offenders.join(', ')).toEqual([])
  })
})
