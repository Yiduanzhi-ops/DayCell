/**
 * 账号与同步页（v9.5）——全屏覆盖层，主菜单「账号与同步」进入。
 *
 * 两级能力：
 *  1. 账号区：邮箱免密登录（输邮箱 → 邮件验证码 → 登录）；已登录显示账号卡片 + 退出
 *  2. 同步区（登录后）：立即上传 / 从云端恢复（v9 自动同步：启动拉取 + 变更推送）
 *
 * 复用 cloudbase.ts 的 API 与 CloudSyncPanel 的状态机（去掉调试元素：健康检查、/me JSON）。
 * 旧版 Gitee 同步保留为兼容入口（底部「旧版同步」跳转 SyncSettings）。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { BackupFile } from '@core'
import { useApp } from '@/app/context'
import {
  downloadSnapshot,
  getAccessToken,
  getCloudApp,
  uploadSnapshot,
} from './cloudbase'
import styles from './SettingsView.module.css'

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

export function AccountSettingsView(): JSX.Element {
  const closeAccount = useApp((s) => s.closeAccount)
  const openSync = useApp((s) => s.openSync)
  const exportSnapshotObject = useApp((s) => s.exportSnapshotObject)
  const restoreSnapshot = useApp((s) => s.restoreSnapshot)
  const setCloudSyncEnabled = useApp((s) => s.setCloudSyncEnabled)

  const [login, setLogin] = useState<LoginState>({ phase: 'idle' })
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpData, setOtpData] = useState<OtpData | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [sync, setSync] = useState<SyncState>({ phase: 'idle' })

  // v9.1：刷新后恢复登录态（auth 会话持久在 localStorage）；已登录则激活自动同步。
  // v9.2：getLoginState() 可能残留 uid 但 accessToken 已失效，须异步验证 token 真实可拿才显示「已恢复」。
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

  const onSendOtp = async (): Promise<void> => {
    const addr = email.trim()
    if (!addr || login.phase === 'sending') return
    setLogin({ phase: 'sending' })
    try {
      const auth = getCloudApp().auth()
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
      setCloudSyncEnabled(true)
    } catch (e) {
      setLogin({ phase: 'error', message: cleanErr(e instanceof Error ? e.message : String(e)) })
    } finally {
      setVerifying(false)
    }
  }

  const onUpload = async (): Promise<void> => {
    setSync({ phase: 'busy', action: 'upload' })
    const token = await getAccessToken()
    if (!token) {
      setSync({ phase: 'fail', action: 'upload', error: '登录状态失效，请重新登录' })
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
        ? { phase: 'ok', action: 'upload', info: r.id != null ? `已上传到云端（快照 id=${r.id}）` : '已上传到云端' }
        : { phase: 'fail', action: 'upload', error: r.error ?? '上传失败' },
    )
  }

  const onDownload = async (): Promise<void> => {
    setSync({ phase: 'busy', action: 'download' })
    const token = await getAccessToken()
    if (!token) {
      setSync({ phase: 'fail', action: 'download', error: '登录状态失效，请重新登录' })
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
    setCloudSyncEnabled(false)
    setLogin({ phase: 'idle' })
    setOtp('')
    setOtpData(null)
    setSync({ phase: 'idle' })
  }

  const onReset = (): void => {
    setLogin({ phase: 'idle' })
    setOtp('')
    setOtpData(null)
  }

  const onGitee = (): void => {
    closeAccount()
    openSync()
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeAccount}>
            ← 返回
          </button>
          <h1 className={styles.h1}>账号与同步</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          {/* —— 账号区 —— */}
          <div className={styles.groupTitle}>账号</div>
          <div className={styles.group}>
            {login.phase === 'done' ? (
              <div className={styles.accountCard}>
                <div className={styles.okLine}>✓ 已登录</div>
                <div className={styles.accountMail}>{login.email}</div>
                {login.uid && <div className={styles.accountUid}>uid {login.uid.slice(0, 10)}…</div>}
                <div className={styles.btnRow}>
                  <button
                    className={styles.btnDanger}
                    onClick={() => void onSignOut()}
                  >
                    退出登录
                  </button>
                </div>
              </div>
            ) : login.phase === 'sent' ? (
              <div className={styles.accountForm}>
                <div className={styles.okLine}>✓ 验证码已发送到 {login.email}</div>
                <p className={styles.rowDesc}>请查收邮件，把 6 位验证码填到下面（有效期较短，尽快输入）。</p>
                <input
                  className={styles.input}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="邮件中的验证码"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
                <div className={styles.btnRow}>
                  <button
                    className={styles.btnPrimary}
                    disabled={otp.trim() === '' || verifying}
                    onClick={() => void onVerify()}
                  >
                    {verifying ? '登录中…' : '验证并登录'}
                  </button>
                  <button className={styles.btnGhost} onClick={onReset}>
                    重发 / 换邮箱
                  </button>
                </div>
              </div>
            ) : (
              <div className={styles.accountForm}>
                {login.phase === 'error' && (
                  <div className={styles.errLine}>✗ {login.message}</div>
                )}
                <p className={styles.rowDesc}>
                  登录后可跨设备云同步、使用 AI 智能导入与通知推送。不登录也能正常记账，数据仅保存在本机。
                </p>
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
                <div className={styles.btnRow}>
                  <button
                    className={styles.btnPrimary}
                    disabled={email.trim() === '' || login.phase === 'sending'}
                    onClick={() => void onSendOtp()}
                  >
                    {login.phase === 'sending' ? '发送中…' : '发送验证码邮件'}
                  </button>
                </div>
                <p className={styles.rowDesc}>无需设置密码，换设备只需再次验证邮箱。</p>
              </div>
            )}
          </div>

          {/* —— 同步区（登录后） —— */}
          {login.phase === 'done' && (
            <>
              <div className={styles.groupTitle}>同步</div>
              <div className={styles.group}>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>云端同步</div>
                    <div className={styles.rowDesc}>打开 App 自动拉取，改动后自动推送；也可手动操作。</div>
                  </div>
                </div>
                <div className={styles.btnRowPadded}>
                  <button
                    className={styles.btnPrimary}
                    disabled={sync.phase === 'busy'}
                    onClick={() => void onUpload()}
                  >
                    {sync.phase === 'busy' && sync.action === 'upload' ? '上传中…' : '立即上传到云端'}
                  </button>
                  <button
                    className={styles.btnGhost}
                    disabled={sync.phase === 'busy'}
                    onClick={() => void onDownload()}
                  >
                    {sync.phase === 'busy' && sync.action === 'download' ? '恢复中…' : '从云端恢复'}
                  </button>
                </div>
                {sync.phase === 'ok' && <div className={styles.okLine}>✓ {sync.info}</div>}
                {sync.phase === 'fail' && <div className={styles.errLine}>✗ {sync.error}</div>}
              </div>
            </>
          )}

          {/* —— 兼容区 —— */}
          <div className={styles.groupTitle}>其他</div>
          <div className={styles.group}>
            <button className={styles.row} role="menuitem" onClick={onGitee}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>旧版同步（Gitee 仓库）</div>
                <div className={styles.rowDesc}>v8 时代的 Gitee 配置方式，仅老用户兼容使用</div>
              </div>
              <span className={styles.chevron}>›</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
