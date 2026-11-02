/**
 * tencentcloud-sdk-nodejs 测试替身（vitest alias 注入）。
 * daycell-api 只用 tencentcloud.asr.v20190614.Client 构造 ASR 客户端；测试不触发识别。
 */
'use strict'

module.exports = {
  asr: {
    v20190614: {
      Client: class {},
    },
  },
}
