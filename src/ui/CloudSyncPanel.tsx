/**
 * v9 云同步面板（正式入口，v9.3 移除 ?dev=1 门控）。
 *
 * 两块能力：
 *  1. 后端连接检查 —— fetch daycell-api /health，验证前端→云函数全链路
 *  2. 邮箱免密登录 —— 输邮箱 → 收邮件验证码 → 登录（无密码，方案 X）
 *
 * 登录后启用自动同步（启动拉取 + 变更推送）；AI 导入与通知订阅也依赖此登录态。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { BackupFile } from '@core'
import { useApp } from '@/app/context'
import {
  API_BASE,
  CLOUD_ENV,
  checkBackend,
  downloadSnapshot,
  fetchMe,
  getAccessToken,
  getCloudApp,
  uploadSnapshot,
} from './cloudbase'
import styles from './CloudSyncPanel.module.css'

type HealthState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; info: string }
  | { phase: 'fail'; error: string }

type MeState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; data: { uid?: string; eventKeys?: string[]; eventSummary?: Record<string, unknown> } }
  | { phase: 'fail'; error: string }

type LoginState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; email: string }
  | { phase: 'done'; email: string; uid?: string }
  | { phase: 'error'; message: string }

type SyncState =
  | { phase: 'idle' }
  | { phase: 'busy'; action: 'upload' | 'download' }
  | { phase: 'ok'; action: 'upload' | 'download'; info: string }
  | { phase: 'fail'; action: 'upload' | 'download'; error: string }

interface OtpData {
  verifyOtp?: (p: { token: string }) => Promise<{ error?: { message?: string } }>
}

/** 清洗服务端/Go 格式化的错误串，只留人能看懂的部分 */
function cleanErr(m: string): string {
  const cut = m.indexOf('%!(EXTRA')
  const base = cut >= 0 ? m.slice(0, cut) : m
  const t = base.trim()
  if (t === '') return '验证码无效或已过期，请重新发送'
  if (t.includes('verification code does not match')) return '验证码不正确或已过期，请用最新邮件里的验证码重试'
  return t
}

export function CloudSyncPanel(): JSX.Element {
  const [health, setHealth] = useState<HealthState>({ phase: 'idle' })
  const [me, setMe] = useState<MeState>({ phase: 'idle' })
  const [login, setLogin] = useState<LoginState>({ phase: 'idle' })
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpData, setOtpData] = useState<OtpData | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [sync, setSync] = useState<SyncState>({ phase: 'idle' })
  const exportSnapshotObject = useApp((s) => s.exportSnapshotObject)
  const restoreSnapshot = useApp((s) => s.restoreSnapshot)
  const setCloudSyncEnabled = useApp((s) => s.setCloudSyncEnabled)

  // v9.1：刷新后恢复登录态显示（auth 会话持久在 localStorage）；已登录则激活自动同步。
  // 仅 idle 时执行一次——避免每次打开设置页都重复激活/同步。
  // v9.2 修复：getLoginState() 可能残留 uid 但 accessToken 已失效（登录态误判），
  // 必须异步验证 token 真实可拿才显示「已恢复」；否则停留 idle 露出登录表单，允许重新登录。
  useEffect(() => {
    if (login.phase !== 'idle') return
    let alive = true
    void (async () => {
      const token = await getAccessToken()
      if (token && alive) {
        setLogin({ phase: 'done', email: '（会话已恢复）' })
        setCloudSyncEnabled(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [login.phase, setCloudSyncEnabled])

  const onHealth = async (): Promise<void> => {
    setHealth({ phase: 'checking' })
    const r = await checkBackend()
    setHealth(
      r.ok
        ? { phase: 'ok', info: r.info ?? 'connected' }
        : { phase: 'fail', error: r.error ?? 'unknown' },
    )
  }

  const onSendOtp = async (): Promise<void> => {
    const addr = email.trim()
    if (!addr || login.phase === 'sending') return
    setLogin({ phase: 'sending' })
    try {
      const auth = getCloudApp().auth()
      // 免密：只发邮件，不发密码；返回 data 持有 verifyOtp 回调
      const res = (await auth.signInWithOtp({ email: addr })) as {
        data: OtpData | null
        error?: { message?: string }
      }
      if (res.error) {
        setLogin({ phase: 'error', message: cleanErr(res.error.message ?? '发送失败') })
        return
      }
      setOtpData(res.data)
      setLogin({ phase: 'sent', email: addr })
    } catch (e) {
      setLogin({ phase: 'error', message: cleanErr(e instanceof Error ? e.message : String(e)) })
    }
  }

  const onVerify = async (): Promise<void> => {
    const token = otp.trim()
    if (!token || verifying) return
    setVerifying(true)
    try {
      if (!otpData?.verifyOtp) {
        setLogin({ phase: 'error', message: '验证回调缺失，请重新发送邮件' })
        return
      }
      const r = (await otpData.verifyOtp({ token })) as { error?: { message?: string } }
      if (r.error) {
        setLogin({ phase: 'error', message: cleanErr(r.error.message ?? '验证失败') })
        return
      }
      const auth = getCloudApp().auth()
      const state = auth.getLoginState?.()
      setLogin({
        phase: 'done',
        email: email.trim(),
        uid: typeof state === 'string' ? state : (state as { uid?: string })?.uid,
      })
      // v9.1：登录成功 → 激活 CloudBase 自动同步（引擎 + 传输层）
      setCloudSyncEnabled(true)
    } catch (e) {
      setLogin({ phase: 'error', message: cleanErr(e instanceof Error ? e.message : String(e)) })
    } finally {
      setVerifying(false)
    }
  }

  const onMe = async (): Promise<void> => {
    setMe({ phase: 'checking' })
    const token = await getAccessToken()
    if (!token) {
      setMe({ phase: 'fail', error: '未取到 accessToken，请重新登录' })
      return
    }
    const r = await fetchMe(token)
    setMe(
      r.ok && r.data
        ? { phase: 'ok', data: r.data as MeState extends { phase: 'ok' } ? { uid?: string; eventKeys?: string[]; eventSummary?: Record<string, unknown> } : never }
        : { phase: 'fail', error: r.error ?? 'unknown' },
    )
  }

  const onUpload = async (): Promise<void> => {
    setSync({ phase: 'busy', action: 'upload' })
    const token = await getAccessToken()
    if (!token) {
      setSync({ phase: 'fail', action: 'upload', error: '未取到 accessToken，请重新登录' })
      return
    }
    const snap = await exportSnapshotObject()
    if (!snap) {
      setSync({ phase: 'fail', action: 'upload', error: '本地快照生成失败（详见提示）' })
      return
    }
    const r = await uploadSnapshot(token, snap, `v9-${Date.now()}`)
    setSync(
      r.ok
        ? {
            phase: 'ok',
            action: 'upload',
            info: r.id != null ? `已上传到云端（快照 id=${r.id}）` : '已上传到云端',
          }
        : { phase: 'fail', action: 'upload', error: r.error ?? '上传失败' },
    )
  }

  const onDownload = async (): Promise<void> => {
    setSync({ phase: 'busy', action: 'download' })
    const token = await getAccessToken()
    if (!token) {
      setSync({ phase: 'fail', action: 'download', error: '未取到 accessToken，请重新登录' })
      return
    }
    const r = await downloadSnapshot(token)
    if (!r.ok || !r.snapshot) {
      setSync({ phase: 'fail', action: 'download', error: r.error ?? '下载失败（云端尚无快照？）' })
      return
    }
    const ok = await restoreSnapshot(r.snapshot as BackupFile)
    setSync(
      ok
        ? {
            phase: 'ok',
            action: 'download',
            info: `已恢复云端快照${r.version ? `（版本 ${r.version}` : ''}${r.savedAt ? ` · 保存于 ${r.savedAt}` : ''}${r.version || r.savedAt ? '）' : ''}`,
          }
        : { phase: 'fail', action: 'download', error: '恢复失败（详见提示）' },
    )
  }

  const onSignOut = async (): Promise<void> => {
    try {
      await getCloudApp().auth().signOut()
    } catch {
      // 忽略登出异常，UI 一律回到 idle
    }
    // v9.1：登出 → 回落 Gitee 配置或停用自动同步
    setCloudSyncEnabled(false)
    setLogin({ phase: 'idle' })
    setMe({ phase: 'idle' })
    setOtp('')
    setOtpData(null)
  }

  const onReset = (): void => {
    setLogin({ phase: 'idle' })
    setOtp('')
    setOtpData(null)
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>v9 云端同步</span>
      </div>

      {/* —— 后端连接检查 —— */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>① 后端连接检查</div>
        <p className={styles.hint}>验证前端 → 云函数全链路（环境 {CLOUD_ENV}）。</p>
        <div className={styles.row}>
          <button
            className={styles.btn}
            disabled={health.phase === 'checking'}
            onClick={() => void onHealth()}
          >
            {health.phase === 'checking' ? '检查中…' : '检查连接'}
          </button>
          {health.phase === 'ok' && <span className={styles.ok}>✓ 已连接 {health.info}</span>}
          {health.phase === 'fail' && <span className={styles.err}>✗ {health.error}</span>}
        </div>
        <code className={styles.code}>{API_BASE}/health</code>
      </div>

      {/* —— 邮箱免密登录 —— */}
      <div className={styles.block}>
        <div className={styles.blockTitle}>② 邮箱免密登录（方案 X）</div>
        <p className={styles.hint}>
          只输邮箱 → 收邮件里的验证码 → 登录。全程无密码，换设备也不用记。
        </p>

        {login.phase === 'done' ? (
          <div className={styles.doneBox}>
            <div className={styles.ok}>✓ 已登录</div>
            <div className={styles.row}>
              <span className={styles.mono}>{login.email}</span>
              {login.uid && <span className={styles.dim}>uid {login.uid.slice(0, 8)}…</span>}
            </div>
            <div className={styles.row}>
              <button
                className={styles.btn}
                disabled={me.phase === 'checking'}
                onClick={() => void onMe()}
              >
                {me.phase === 'checking' ? '验证中…' : '③ 验证网关身份（/me）'}
              </button>
              <button className={styles.btn} onClick={() => void onSignOut()}>
                退出登录
              </button>
            </div>
            {me.phase === 'ok' && (
              <div className={styles.meBox}>
                <div className={styles.ok}>✓ 网关注入 uid: {me.data.uid ?? '（未取到）'}</div>
                <code className={styles.code}>
                  eventKeys: {JSON.stringify(me.data.eventKeys ?? [])}
                </code>
                <code className={styles.code}>
                  userInfo: {JSON.stringify(me.data.eventSummary?.userInfo ?? null)}
                </code>
                <code className={styles.code}>
                  auth: {JSON.stringify(me.data.eventSummary?.auth ?? null)}
                </code>
              </div>
            )}
            {me.phase === 'fail' && <div className={styles.errLine}>✗ /me {me.error}</div>}

            {/* —— v9 云同步：按钮版 —— */}
            <div className={styles.block}>
              <div className={styles.blockTitle}>④ 云同步（按钮版）</div>
              <p className={styles.hint}>
                上传 = 把本地整包快照存到云端；下载 = 用云端快照恢复（按 id 合并，不覆盖本地更新的数据）。
              </p>
              <div className={styles.row}>
                <button
                  className={`${styles.btn} ${styles.primary}`}
                  disabled={sync.phase === 'busy'}
                  onClick={() => void onUpload()}
                >
                  {sync.phase === 'busy' && sync.action === 'upload'
                    ? '上传中…'
                    : '上传到云端'}
                </button>
                <button
                  className={styles.btn}
                  disabled={sync.phase === 'busy'}
                  onClick={() => void onDownload()}
                >
                  {sync.phase === 'busy' && sync.action === 'download'
                    ? '恢复中…'
                    : '从云端恢复'}
                </button>
              </div>
              {sync.phase === 'ok' && <div className={styles.ok}>✓ {sync.info}</div>}
              {sync.phase === 'fail' && <div className={styles.errLine}>✗ {sync.error}</div>}
              <code className={styles.code}>POST /sync/upload · GET /sync/download</code>
            </div>
          </div>
        ) : login.phase === 'sent' ? (
          <div className={styles.sentBox}>
            <div className={styles.ok}>✓ 验证码已发送到 {login.email}</div>
            <p className={styles.hint}>请查收邮件，把验证码填到下面（有效期较短，尽快输入）。</p>
            <input
              className={styles.input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="邮件中的验证码"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
            />
            <div className={styles.row}>
              <button
                className={`${styles.btn} ${styles.primary}`}
                disabled={otp.trim() === '' || verifying}
                onClick={() => void onVerify()}
              >
                {verifying ? '登录中…' : '验证并登录'}
              </button>
              <button className={styles.btn} onClick={onReset}>
                重发 / 换邮箱
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.formBox}>
            {login.phase === 'error' && (
              <div className={styles.errLine}>✗ {login.message}</div>
            )}
            <input
              className={styles.input}
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="你的邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button
              className={`${styles.btn} ${styles.primary}`}
              disabled={email.trim() === '' || login.phase === 'sending'}
              onClick={() => void onSendOtp()}
            >
              {login.phase === 'sending' ? '发送中…' : '发送验证码邮件'}
            </button>
          </div>
        )}
      </div>

      <p className={styles.foot}>
        登录后数据自动同步到云端；同一账号多设备间共享。
      </p>
    </section>
  )
}
