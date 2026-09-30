# ADR-0006 core 层禁止依赖 React 与 DOM

- **状态**：已接受
- **日期**：2026-09-29
- **相关**：SPEC §2「小程序可能性」、PRD §5.6、CORE-API §1.2、ADR-0008

## 背景

DayCell v0 是纯 Web App / PWA。但 SPEC §2 里留了一条：**将来可能出微信小程序**（当时评估过小程序，因为"需要 AppID + 审核 + ICP 备案域名"而暂缓，但没有永久排除）。

小程序不是 Web。它没有 DOM、没有 `window`、不能用 React DOM 渲染。如果业务逻辑和 React/DOM 缠在一起，出小程序就等于**重写整个应用**。

现在划一条边界，成本是几行 ESLint 配置；将来再划，成本是重写存储层、日期运算、农历换算、汇总逻辑、导入导出——也就是这个项目里**最容易写错、最需要测试覆盖**的那部分。

## 决策

### 目录隔离

```
src/
  core/   ← 纯 TypeScript。禁止 import React，禁止访问 DOM/window
  ui/     ← React 组件 + CSS Modules
  app/    ← 装配层：Zustand store、路由、把 core 接到 ui
```

### 三条铁律（CORE-API §1.2）

1. 禁止 `import` React、任何 UI 库、任何 CSS
2. 禁止访问 `window` / `document` / `localStorage` / `navigator`
3. 禁止隐式当前时间——需要"今天"的函数一律显式接收 `today: DateKey` 参数

### 唯一出口

UI 只能 `import` `core/index.ts`。直接引用子模块路径（如 `core/store/idb`）视为违规。

### 全局对象一律注入

铁律 2 有两个文件天然做不到——`core/store/idb.ts` 需要 `indexedDB`，`core/diagnose.ts` 需要探测浏览器能力。解法是**依赖注入**：

```ts
function createIdbStore(deps: { indexedDB: IDBFactory; ... }): RecordStore;
function diagnose(deps: { indexedDB?: unknown; navigator?: unknown; ... }): Promise<Diagnosis>;
```

生产代码传真实全局对象，测试传 fake。这样源码里**一个 `window.` 都不出现**。

## 理由

**为什么是"禁止"而不是"尽量避免"**：靠自觉的边界一定会被突破。某个组件里图省事直接调 `idb` 而不是走 repo，三个月后就有十处这样的调用，边界名存实亡。**必须用工具强制**：

```js
// eslint.config.js
{
  files: ['src/core/**/*.ts'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: ['react', 'react-dom', '*.css', 'zustand', '../ui/*', '../app/*']
    }],
    'no-restricted-globals': ['error', 'window', 'document', 'localStorage',
                                     'sessionStorage', 'navigator', 'indexedDB'],
    'no-restricted-syntax': ['error', {
      selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
      message: '用注入的 now() 而不是 Date.now()'
    }]
  }
}
```

**为什么还要加第二道验证**：ESLint 规则可能被 `eslint-disable` 绕过，也可能配错。所以再加一个**在纯 Node 环境（`environment: 'node'`，不是 jsdom）里 import 全部 core 模块**的测试。Node 环境里 `window` 是 `undefined`，任何直接访问都会在加载时抛 `ReferenceError`。

这两道检查合起来才可信：静态规则 + 运行时验证。

**铁律 3（禁止隐式当前时间）是顺带的红利**：它跟小程序无关，但它让所有涉及"今天"的逻辑都变成**可复现的纯函数**。顺延横幅、"今天"高亮、备份提醒——这些在测试里都不需要 mock 时钟。原型阶段就有过因为"今天"不确定而写错断言的经历。

## 考虑过的替代方案

| 方案 | 为什么否掉 |
|---|---|
| 不做隔离，全部写在一起 | 出小程序时重写 100%。而且 core 逻辑混在组件里，单元测试必须挂 jsdom，慢且脆 |
| 一开始就做 monorepo（`packages/core` + `packages/web`） | 物理隔离更彻底，但 v0 只有一个人、一个应用，monorepo 的构建/版本/依赖管理成本纯亏。**目录隔离 + ESLint 已经够用**；真要出小程序时再把 `core` 抽成包，是半天的事 |
| 直接用 Taro 写，一套代码出 H5 + 小程序 | Taro 的 H5 产物在 PWA 支持上有限制（Service Worker、manifest 需要额外配置），且 React 语法子集有约束。为了一个"可能"的小程序，牺牲 v0 的主战场（Web/PWA）不划算 |
| 用 TypeScript 的 `project references` 做隔离 | 编译器层面的隔离更硬，但配置复杂、与 Vite 的集成有摩擦。ESLint + Node 环境测试已达到同等效果 |

## 后果

**正面**
- 出小程序时只需重写 `ui/`（约 30% 工作量），`core/` 整体复用
- **core 的单元测试跑在纯 Node 里，比 jsdom 快一个数量级**，且不受 DOM API 兼容性影响
- 换存储后端（IndexedDB → 云）时只换 `RecordStore` 实现，repo 以上零改动（ADR-0001）
- 强制的显式时间注入让所有日期逻辑可复现

**负面**
- 多一层抽象。UI 不能"顺手"直接查 IndexedDB，必须走 repo。**这正是目的**，但初期会觉得啰嗦
- 依赖注入让函数签名变长（`createIdbStore(deps)` 而不是 `createIdbStore()`）。缓解：提供带默认值的生产入口，只有测试才显式传 deps
- ESLint 规则需要维护，新增依赖时要更新 `no-restricted-imports` 白名单

## 实施要点

- **CI 必须阻断**：ESLint 报错 = 构建失败，不允许 warning 通过
- 那个"纯 Node 加载全部 core"的测试要**遍历目录**自动发现模块，而不是手写清单——否则新增模块时忘记加进清单，检查就有漏洞：

```ts
// core/__tests__/isolation.test.ts   environment: node
import { globSync } from 'node:fs';
const files = globSync('src/core/**/*.ts').filter(f => !f.includes('.test.'));
test.each(files)('%s 可在无 DOM 环境加载', async (f) => {
  await expect(import(f)).resolves.toBeDefined();
});
```

- `core/index.ts` 要**显式列出**导出，不用 `export *`——这样公开面是可控的，内部重构不会意外破坏 UI
- 覆盖率要求 **core ≥ 80%**（PRD §10），UI 层不设硬指标
- 如果 v1 决定出小程序，届时把 `core/` 提升为 `packages/core` 并加 `exports` 字段即可，**不需要改任何 core 代码**——这是本决策成功的验收标准
