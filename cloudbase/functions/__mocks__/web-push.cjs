/**
 * web-push 测试替身（vitest alias 注入）。
 * sendNotification 记录到 globalThis.__daycell_sent；可经 globalThis.__daycell_send_error 注入 410/404。
 */
'use strict'

const impl = {
  setVapidDetails: () => {},
  sendNotification: async (sub, payload) => {
    const err = globalThis.__daycell_send_error
    if (err) {
      globalThis.__daycell_send_error = null
      throw err
    }
    // payload 为 JSON 字符串；测试里通过 __daycell_sent 断言标题/正文
    globalThis.__daycell_sent = globalThis.__daycell_sent || []
    globalThis.__daycell_sent.push({ sub, payload: JSON.parse(payload) })
  },
}

module.exports = impl
