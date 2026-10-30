/**
 * 账号与同步页（v9.5）——全屏覆盖层，主菜单「账号与同步」进入。
 *
 * 两级能力：
 *  1. 账号区：邮箱免密登录（输邮箱 → 邮件验证码 → 登录）；已登录显示账号卡片 + 退出
 *  2. 同步区（登录后）：立即上传 / 从云端恢复（v9 自动同步：启动拉取 + 变更推送）
 *
 * v9.5 独立登录页：未登录 = 白净全屏登录页（产品 Logo + 大标题 + 自动多端同步卖点 + 六格验证码），
 * 登录后 = 分组管理页。复用 cloudbase.ts 的 API 与 CloudSyncPanel 的状态机（去掉调试元素）。
 * 旧版 Gitee 同步保留为兼容入口（底部「旧版同步」跳转 SyncSettings）。
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { BackupFile } from '@core'
import { useApp } from '@/app/context'
import {
  downloadSnapshot,
  ensureSession,
  fetchMember,
  fetchSyncStatus,
  getAccessToken,
  getCloudApp,
  redeemCode,
  type CloudSyncStatus,
  uploadSnapshot,
} from './cloudbase'
import styles from './SettingsView.module.css'

const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`

type LoginState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; email: string }
  | { phase: 'anon' }
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
  // v9.6：会话恢复只尝试一次（组件挂载时）。否则匿名页点「升级为邮箱登录」切到 idle 会再次
  // 触发自动匿名登录，把用户弹回匿名页，永远进不了邮箱登录页。
  const restoredRef = useRef(false)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [verifyErr, setVerifyErr] = useState('')
  const [otpData, setOtpData] = useState<OtpData | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [sync, setSync] = useState<SyncState>({ phase: 'idle' })
  // v9.6 云端备份状态（上次同步/记录数/设备数）：登录后拉取，「数据不会丢」可见性
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus | null>(null)
  const [statusErr, setStatusErr] = useState('')
  // v9.7 第 3 步：会员状态（member / 到期时间 / 设备上限）+ 兑换码
  const [memberInfo, setMemberInfo] = useState<{
    member: boolean
    memberExpiresAt: string | null
    deviceLimit: number
  } | null>(null)
  const [redeemCodeVal, setRedeemCodeVal] = useState('')
  const [redeemState, setRedeemState] = useState<{ phase: 'idle' | 'busy' | 'ok' | 'fail'; msg?: string }>({
    phase: 'idle',
  })
  const otpRefs = useRef<Array<HTMLInputElement | null>>([])

  // v9.7 第 3 步：拉云端备份状态 + 会员状态（两处复用：恢复会话 / 登录成功）
  const refreshCloudState = async (token: string): Promise<void> => {
    const s = await fetchSyncStatus(token)
    if (s.ok && s.status) {
      setCloudStatus(s.status)
    } else if (s.error) {
      setStatusErr(s.error)
    }
    const m = await fetchMember(token)
    if (m.ok) {
      setMemberInfo({
        member: m.member ?? false,
        memberExpiresAt: m.memberExpiresAt ?? null,
        deviceLimit: m.deviceLimit ?? 1,
      })
    }
  }

  // v9.1：刷新后恢复登录态（auth 会话持久在 localStorage）；已登录则激活自动同步。
  // v9.2：getLoginState() 可能残留 uid 但 accessToken 已失效，须异步验证 token 真实可拿才显示「已恢复」。
  // v9.6：区分邮箱（done）与匿名（anon）会话；无会话则尝试匿名登录（A2）。
  useEffect(() => {
    if (login.phase !== 'idle') return
    if (restoredRef.current) return
    restoredRef.current = true
    let alive = true
    void (async () => {
      const type = await ensureSession()
      if (!alive) return
      if (type === 'email') {
        const token = await getAccessToken()
        if (token) {
          setLogin({ phase: 'done', email: '（会话已恢复）' })
          setCloudSyncEnabled(true)
          // 拉云端备份状态（失败不阻塞，展示区会显示缺省文案）
          await refreshCloudState(token)
        }
      } else if (type === 'anonymous') {
        // 历史匿名会话（v9.6 及以前创建）：归入本地体验态展示，不创建新匿名会话
        setLogin({ phase: 'anon' })
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
      setVerifyErr('')
      setLogin({ phase: 'sent', email: addr })
    } catch (e) {
      setLogin({ phase: 'error', message: cleanErr(e instanceof Error ? e.message : String(e)) })
    }
  }

  const onVerify = async (): Promise<void> => {
    const token = otp.trim()
    if (token.length < 6 || verifying) return
    setVerifying(true)
    setVerifyErr('')
    try {
      if (!otpData?.verifyOtp) {
        setVerifyErr('验证回调缺失，请重新发送邮件')
        return
      }
      const r = (await otpData.verifyOtp({ token })) as { error?: { message?: string } }
      if (r.error) {
        setVerifyErr(cleanErr(r.error.message ?? '验证失败'))
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
      // v9.9.1 登录成功自动回到今天视图（不再停在账号模块）；云端状态与会员信息继续后台刷新
      closeAccount()
      // v9.7 第 3 步：登录成功同样拉云端状态与会员（否则会员区一直「获取中」）
      const tk = await getAccessToken()
      if (tk) await refreshCloudState(tk)
    } catch (e) {
      setVerifyErr(cleanErr(e instanceof Error ? e.message : String(e)))
    } finally {
      setVerifying(false)
    }
  }

  const onOtpChange = (i: number, raw: string): void => {
    const v = raw.replace(/\D/g, '').slice(-1)
    setOtp((prev) => {
      const arr = prev.split('')
      arr[i] = v
      const next = arr.join('')
      if (v && i < 5) otpRefs.current[i + 1]?.focus()
      return next
    })
  }

  const onOtpKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Backspace' && otp[i] === '' && i > 0) {
      otpRefs.current[i - 1]?.focus()
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
        : r.error === 'device_limit'
          ? {
              phase: 'fail',
              action: 'upload',
              error: `免费档仅支持 1 台设备云同步，第二台设备需升级会员（即将上线）`,
            }
          : { phase: 'fail', action: 'upload', error: r.error ?? '上传失败' },
    )
    // 上传成功后刷新备份状态（设备登记可能变化）
    if (r.ok) {
      const s = await fetchSyncStatus(token)
      if (s.ok && s.status) setCloudStatus(s.status)
    }
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

  // v9.7 第 3 步：兑换码核销（成功 → 刷新会员状态）
  const onRedeem = async (): Promise<void> => {
    const code = redeemCodeVal.trim()
    if (!code || redeemState.phase === 'busy') return
    setRedeemState({ phase: 'busy' })
    const token = await getAccessToken()
    if (!token) {
      setRedeemState({ phase: 'fail', msg: '登录状态失效，请重新登录' })
      return
    }
    const r = await redeemCode(token, code)
    if (!r.ok) {
      setRedeemState({
        phase: 'fail',
        msg:
          r.error === 'invalid_code'
            ? '兑换码不存在，请检查后重试'
            : r.error === 'code_used'
              ? '该兑换码已被使用'
              : (r.error ?? '兑换失败，请稍后重试'),
      })
      return
    }
    setRedeemState({ phase: 'ok', msg: `会员已开通 ${r.days ?? 30} 天` })
    setRedeemCodeVal('')
    const m = await fetchMember(token)
    if (m.ok) {
      setMemberInfo({
        member: m.member ?? true,
        memberExpiresAt: m.memberExpiresAt ?? null,
        deviceLimit: m.deviceLimit ?? 5,
      })
    }
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
    setVerifyErr('')
    setSync({ phase: 'idle' })
  }

  const onReset = (): void => {
    setLogin({ phase: 'idle' })
    setOtp('')
    setOtpData(null)
    setVerifyErr('')
  }

  const onGitee = (): void => {
    closeAccount()
    openSync()
  }

  /* —— 已登录：分组管理页 —— */
  if (login.phase === 'done') {
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
            <div className={styles.groupTitle}>账号</div>
            <div className={styles.group}>
              <div className={styles.accountCard}>
                <div className={styles.okLine}>✓ 已登录</div>
                <div className={styles.accountMail}>{login.email}</div>
                {login.uid && <div className={styles.accountUid}>uid {login.uid.slice(0, 10)}…</div>}
                <div className={styles.btnRow}>
                  <button className={styles.btnDanger} onClick={() => void onSignOut()}>
                    退出登录
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.groupTitle}>会员</div>
            <div className={styles.group}>
              {memberInfo === null ? (
                <div className={styles.memberCard}>
                  <div className={styles.cloudStatusDesc}>会员状态加载中…</div>
                </div>
              ) : memberInfo.member ? (
                <div className={styles.memberCard}>
                  <div className={styles.okLine}>✓ 会员生效中</div>
                  <div className={styles.cloudStatusDesc}>
                    到期{' '}
                    {memberInfo.memberExpiresAt
                      ? new Date(memberInfo.memberExpiresAt).toLocaleDateString('zh-CN')
                      : '—'}
                  </div>
                  <div className={styles.cloudStatusDesc}>云同步 {memberInfo.deviceLimit} 台 · AI 每日 100 次 · 推送</div>
                </div>
              ) : (
                <div className={styles.memberCard}>
                  <div className={styles.cloudStatusHint}>当前为免费版</div>
                  <div className={styles.cloudStatusDesc}>
                    云同步 {memberInfo.deviceLimit} 台设备 · AI 试用 5 次 · 推送为会员专属
                  </div>
                  <div className={styles.redeemRow}>
                    <input
                      className={styles.redeemInput}
                      value={redeemCodeVal}
                      onChange={(e) => setRedeemCodeVal(e.target.value.toUpperCase())}
                      placeholder="输入兑换码"
                      data-testid="redeem-input"
                    />
                    <button
                      className={styles.redeemBtn}
                      disabled={redeemState.phase === 'busy' || !redeemCodeVal.trim()}
                      onClick={() => void onRedeem()}
                      data-testid="redeem-btn"
                    >
                      {redeemState.phase === 'busy' ? '兑换中…' : '兑换'}
                    </button>
                  </div>
                  {redeemState.phase === 'ok' && <div className={styles.okLine}>✓ {redeemState.msg}</div>}
                  {redeemState.phase === 'fail' && <div className={styles.errLine}>✗ {redeemState.msg}</div>}
                </div>
              )}
            </div>

            <div className={styles.groupTitle}>同步</div>
            <div className={styles.group}>
              {/* v9.6 云备份状态：「数据不会丢」可见性 */}
              {cloudStatus && (
                <div className={styles.cloudStatusCard}>
                  <div className={styles.okLine}>
                    ✓ 云端已备份
                    {cloudStatus.recordCount > 0 ? ` · 共 ${cloudStatus.recordCount} 条记录` : ''}
                  </div>
                  <div className={styles.cloudStatusDesc}>
                    {cloudStatus.lastSyncAt
                      ? `上次同步 ${new Date(cloudStatus.lastSyncAt).toLocaleString('zh-CN', { hour12: false })}`
                      : '尚未上传过快照'}
                    {cloudStatus.devices.length > 0
                      ? ` · 已登记设备 ${cloudStatus.devices.length}/${cloudStatus.deviceLimit}`
                      : ''}
                    {cloudStatus.devices.length >= cloudStatus.deviceLimit && cloudStatus.deviceLimit > 1
                      ? ''
                      : ''}
                  </div>
                  {cloudStatus.devices.length >= cloudStatus.deviceLimit && (
                    <div className={styles.cloudStatusHint}>
                      免费档支持 {cloudStatus.deviceLimit} 台设备同步，更多设备需升级会员
                    </div>
                  )}
                </div>
              )}
              {statusErr && <div className={styles.errLine}>✗ 备份状态读取失败：{statusErr}</div>}
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

  /* —— 本地体验中：白净页 + 登录入口（历史匿名会话与本地模式统一展示） —— */
  if (login.phase === 'anon') {
    return (
      <div className={styles.overlay}>
        <div className={styles.authPage}>
          <button className={styles.authBack} onClick={closeAccount}>
            ← 返回
          </button>
          <div className={styles.authInner}>
            <div className={styles.authLogo}>
              <img src={LOGO_URL} alt="" aria-hidden="true" />
            </div>
            <h1 className={styles.authTitle}>本地体验中</h1>
            <p className={styles.authSub}>
              数据仅保存在本机，未开启云备份。登录邮箱后自动开启云同步，数据备份到云端、换设备不丢。
            </p>
            <button className={styles.authPrimary} onClick={() => setLogin({ phase: 'idle' })}>
              登录邮箱
            </button>
            <p className={styles.authHint}>
              邮箱登录免费，解锁云同步、AI 智能导入与通知推送。
            </p>
          </div>
        </div>
      </div>
    )
  }

  /* —— 未登录：独立登录页 —— */
  const sending = login.phase === 'sending'

  return (
    <div className={styles.overlay}>
      <div className={styles.authPage}>
        <button className={styles.authBack} onClick={closeAccount}>
          ← 返回
        </button>

        {login.phase === 'sent' ? (
          /* —— 验证码页 —— */
          <div className={styles.authInner}>
            <div className={styles.authLogo}>
              <img src={LOGO_URL} alt="" aria-hidden="true" />
            </div>
            <h1 className={styles.authTitle}>输入验证码</h1>
            <p className={styles.authSub}>
              验证码已发送至
              <br />
              <b>{login.email}</b>
            </p>
            {verifyErr && <div className={styles.authErr}>{verifyErr}</div>}
            <div className={styles.otpRow}>
              {Array.from({ length: 6 }, (_, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el
                  }}
                  className={styles.otpCell}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  value={otp[i] ?? ''}
                  onChange={(e) => onOtpChange(i, e.target.value)}
                  onKeyDown={(e) => onOtpKeyDown(i, e)}
                />
              ))}
            </div>
            <button
              className={styles.authPrimary}
              disabled={otp.length < 6 || verifying}
              onClick={() => void onVerify()}
            >
              {verifying ? '登录中…' : '登录'}
            </button>
            <p className={styles.otpActions}>
              没收到？
              <button
                onClick={() => {
                  setEmail(login.email)
                  void onSendOtp()
                }}
                disabled={sending}
              >
                {sending ? '重新发送中…' : '重新发送'}
              </button>
            </p>
            <p className={styles.otpBack}>
              <button onClick={onReset}>换一个邮箱</button>
            </p>
            <p className={styles.authPrivacy}>验证码 10 分钟内有效 · 登录后自动多端同步</p>
          </div>
        ) : (
          /* —— 邮箱登录页 —— */
          <div className={styles.authInner}>
            <div className={styles.authLogo}>
              <img src={LOGO_URL} alt="" aria-hidden="true" />
            </div>
            <h1 className={styles.authTitle}>登录 DayCell</h1>
            <p className={styles.authSub}>
              登录后自动多端同步，换设备数据不丢
            </p>
            {login.phase === 'error' && <div className={styles.authErr}>{login.message}</div>}
            <label className={styles.authField}>
              <input
                type="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email.trim() !== '' && !sending) void onSendOtp()
                }}
              />
            </label>
            <button
              className={styles.authPrimary}
              disabled={email.trim() === '' || sending}
              onClick={() => void onSendOtp()}
            >
              {sending ? '发送中…' : '获取验证码'}
            </button>
            <button
              type="button"
              className={styles.devFill}
              onClick={() => setEmail('18804475608@163.com')}
            >
              开发者测试：一键填入账号 18804475608@163.com
            </button>
            <p className={styles.authHint}>
              验证码会发送到你的邮箱，<b>10 分钟内有效</b>。
            </p>
            <p className={styles.authPrivacy}>
              数据同步与存储由腾讯云 CloudBase 提供
              <br />
              你的数据仅用于 DayCell 账号服务
            </p>
            <button
              className={styles.localEntry}
              onClick={() => {
                try {
                  // v9.7：记时间戳而非 '1'——30 天到期后重新引导登录
                  localStorage.setItem('daycell_skip_login', String(Date.now()))
                } catch {
                  // 隐私模式下写入失败不影响：仅下次启动会再次显示登录引导
                }
                closeAccount()
              }}
            >
              先本地体验 ›
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
