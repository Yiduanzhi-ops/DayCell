/**
 * 原型 ↔ core 平价检验。
 *
 * 为什么要有这个文件：`prototype/index.html` 是给人看的设计产物，但它里面的
 * `toCents()` 是把金额转成整数「分」的**真实算法演示**，必须和 `core/validate.ts`
 * 的 `parseAmount()` 逐位一致。两边各写一份就一定会漂移——写这个测试的当天就抓到
 * 两处：原型自作主张吃掉了 `¥` 前缀和内部空格，而 core 两者都拒绝。
 *
 * 放在 `src/` 根而不是 `src/core/`：它不是 core 单元测试，且必须躲开
 * `isolation.test.ts` 的 `./**\/*.ts` 源码扫描（ADR-0006 的 core 纯净性铁律）。
 *
 * ⚠️ 生命周期：`prototype/` 是过渡产物。真 UI 落地、原型删除时，**这个文件一起删**。
 */
import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { parseAmount } from './core/validate'

/* 用 Vite 原生的 ?raw glob 读原型，**不用 node:fs**：
   src/ 归 tsconfig.app.json 管，types 只有 ["vite/client"]，是浏览器侧工程，
   里面出现 node 内置模块会直接编译不过（也违背 ADR-0006 的分层意图）。
   jsdom 本身是已声明的 devDependency，装 @types/jsdom 只是补上缺失的类型。 */
const RAW = import.meta.glob('../prototype/index.html', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const html = RAW['../prototype/index.html']
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
})
const proto = (r: string): number | null =>
  dom.window.eval('toCents(' + JSON.stringify(r) + ')') as number | null

/** 覆盖：round half up 边界、全角归一化、千分位、科学计数法、上限、各种非法输入 */
const INPUTS = [
  '1.005', '1.004', '1.0049', '45', '28.5', '0.07', '0.1', '28.555', '100.999',
  '1,280', '1，280', '４５．５', '45。5', '０．０７',
  '1e3', '2E2', '0', '00', '-5', '+5', '5.', '.5', '  45  ',
  '¥45', '￥45', '1 200', '一杯咖啡', 'abc', '', '   ', 'NaN', 'Infinity',
  '99999999.99', '100000000', '99999999999999999999', '0.001', '0.004', '0.005',
]

describe('原型 toCents ↔ core parseAmount 平价', () => {
  it('确实读到了原型源码（防止 glob 失效导致整个文件假绿）', () => {
    expect(typeof html).toBe('string')
    expect(html.length).toBeGreaterThan(20000)
    expect(html).toContain('function toCents')
  })

  it('原型里确实存在 toCents', () => {
    expect(typeof dom.window.eval('toCents')).toBe('function')
    expect(INPUTS.length).toBeGreaterThanOrEqual(30)
  })

  it.each(INPUTS)('金额输入 %j 两边结论一致', (raw) => {
    const core = parseAmount(raw)
    expect(proto(raw)).toBe(core.ok ? core.value : null)
  })

  it('汇总：全部输入零分歧', () => {
    const diff = INPUTS.filter((r) => {
      const c = parseAmount(r)
      return proto(r) !== (c.ok ? c.value : null)
    })
    expect(diff).toEqual([])
  })
})
