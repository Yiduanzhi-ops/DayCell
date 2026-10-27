/**
 * v9 云同步开发面板（Feature Flag 锁死：仅 ?dev=1 可见）。
 *
 * 两块能力：
 *  1. 后端连接检查 —— fetch daycell-api /health，验证前端→云函数全链路
 *  2. 邮箱免密登录 —— 输邮箱 → 收邮件验证码 → 登录（无密码，方案 X）
 *
 * 仅自测用途，默认用户不可见；上线前移除 devflag 门并接入正式入口。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { API_BASE, CLOUD_ENV, checkBackend, getCloudApp } from './cloudbase'
import styles from './CloudSyncPanel.module.css'

type HealthState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'ok'; info: string }
  | { phase: 'fail'; error: string }

type LoginState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; email: string }
  | { phase: 'done'; email: string; uid?: string }
  | { phase: 'error'; message: string }

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
  const [login, setLogin] = useState<LoginState>({ phase: 'idle' })
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [otpData, setOtpData] = useState<OtpData | null>(null)
  const [verifying, setVerifying] = useState(false)

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
    } catch (e) {
      setLogin({ phase: 'error', message: cleanErr(e instanceof Error ? e.message : String(e)) })
    } finally {
      setVerifying(false)
    }
  }

  const onSignOut = async (): Promise<void> => {
    try {
      await getCloudApp().auth().signOut()
    } catch {
      // 忽略登出异常，UI 一律回到 idle
    }
    setLogin({ phase: 'idle' })
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
        <span className={styles.title}>v9 云端（开发面板）</span>
        <span className={styles.badge}>仅 ?dev=1 可见 · 不影响线上</span>
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
            <button className={styles.btn} onClick={() => void onSignOut()}>
              退出登录
            </button>
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
        说明：本面板默认锁死，线上用户不可见。自测请在网址后加 <code>?dev=1</code>。
      </p>
    </section>
  )
}
