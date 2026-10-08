/**
 * core 层的**唯一对外出口**（CORE-API 附录）。
 *
 * UI（`src/ui`）与装配层（`src/app`）只允许 `import ... from '@core'`，
 * 深入子模块路径（`@core/repo` 等）会被 ESLint 阻断。
 * 这样 core 内部的文件组织可以自由重构，只要这个出口不变。
 *
 * ⚠️ 新增子模块时记得在这里登记；导出名冲突时编译器会报错，
 *    此时优先改名而不是 `export *` 换成手动挑选来掩盖冲突。
 */

// ---- 基础 ----
export * from './types'
export * from './errors'
export * from './clock'
export * from './id'
export * from './date'
export * from './validate'

// ---- 农历与标签 ----
export * from './lunar'
export * from './label'

// ---- 存储 ----
// store/types.ts 里重复定义了 ContentStoreName 并 re-export 了 ../types 的一批类型，
// 不能 `export *`（会与 ./types 的同名**不同声明**冲突），只挑独有的。
export { sortDated, sortCategories, emptyContent } from './store/types'
export type {
  RecordStore,
  PutOptions,
  ByUpdatedOptions,
  UsageEstimate,
  StoreDeps,
} from './store/types'
export { createMemoryStore } from './store/memory'
export type { MemoryStoreOptions } from './store/memory'
export { createIdbStore, hasIndexedDB } from './store/idb'
export type { IdbDeps } from './store/idb'

// ---- 领域与聚合 ----
export * from './repo/index'
export * from './aggregate/index'

// ---- 备份（导出 / 合并导入 / Markdown，PRD M14/M15） ----
export * from './backup/index'

// ---- 云同步（WebDAV / 坚果云，v8.1） ----
export * from './sync/webdav'
export * from './sync/merge'
export * from './sync/engine'

// ---- 迁移与环境探测 ----
export * from './migrate/index'
export * from './diagnose'
