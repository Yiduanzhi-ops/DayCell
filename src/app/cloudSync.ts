/**
 * app/cloudSync —— v9 云同步（CloudBase）浏览器侧传输层。
 *
 * 实现 core 的 SyncTransport 接口，同步引擎（engine.ts）原样复用：
 *  - fetchFile → GET /sync/download（只返回当前登录用户自己的快照；无快照/未登录 → null）
 *  - putFile   → POST /sync/upload（整包覆盖云端；云函数强制 user_id=网关身份）
 *
 * 登录态由 CloudBase auth 管理（邮箱免密 OTP），token 经 getAccessToken() 获取。
 * 未登录时**不应** setTransport——引擎在无 transport 时 pull/push 直接静默跳过，
 * 这样没登录的用户完全不受影响。
 *
 * 引擎的 pull 会用 mergeTables（id 级 last-write-wins）合并，push 用 serializeBackup
 * 整包覆盖——与 Gitee 版完全一致，双向不丢数据。
 */
import type { SyncTransport } from '@core'
import { downloadSnapshot, getAccessToken, uploadSnapshot } from '@/ui/cloudbase'

export function buildCloudTransport(): SyncTransport {
  return {
    /** 下载云端快照。云端还没有 / 未登录 → null（引擎按"云端无内容"处理） */
    async fetchFile() {
      const token = await getAccessToken()
      if (!token) return null
      const r = await downloadSnapshot(token)
      if (!r.ok) throw new Error(r.error ?? '云端拉取失败')
      if (!r.snapshot) return null
      return JSON.stringify(r.snapshot)
    },

    /** 整包覆盖上传。失败抛错，引擎记入同步状态（设置页可见） */
    async putFile(text) {
      const token = await getAccessToken()
      if (!token) throw new Error('未登录云同步账号')
      let snapshot: unknown
      try {
        snapshot = JSON.parse(text) as unknown
      } catch {
        throw new Error('本地快照序列化失败')
      }
      const r = await uploadSnapshot(token, snapshot, `v9-${Date.now()}`)
      if (!r.ok) throw new Error(r.error ?? '云端上传失败')
    },
  }
}
