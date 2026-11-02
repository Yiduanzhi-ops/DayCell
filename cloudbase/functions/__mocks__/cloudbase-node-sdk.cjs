/**
 * @cloudbase/node-sdk 测试替身（vitest alias / 测试专用 node_modules 注入）。
 * rdb() 返回 globalThis.__daycell_test_db（测试文件 beforeEach 注入的链式 mock db）。
 * 同时兼容两种取法：
 *  - 原生 require('@cloudbase/node-sdk') → module.exports（函数，挂 init/SYMBOL_CURRENT_ENV 属性）
 *  - vite ESM interop → namespace.default 与 named exports（default 与 init 都可用）
 */
'use strict'

const init = () => ({ rdb: () => globalThis.__daycell_test_db })
init.SYMBOL_CURRENT_ENV = 'test'

module.exports = init
module.exports.init = init
module.exports.default = module.exports
