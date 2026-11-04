/**
 * 通知设置页（v9.3）——全屏覆盖层，手机/桌面同构。
 *
 * 早间日报 / 晚间日报：开关 + 半小时档位。
 * 改动流程：本地状态 → syncPushPrefs（授权订阅 + 云端上报）→ 成功后写 repos.settings。
 * 云端只认已登录用户；未登录先引导去同步设置。
 *
 * 存储：repos.settings（localStorage 持久化），切换即时生效（无需重启）。
 * 样式与偏好设置页共用 SettingsView.module.css，保持一致视觉。
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import { fetchMember, getAccessToken, isCloudLoggedIn, type PushPrefs } from './cloudbase'
import {
  EVENING_SLOTS,
  getPushSupport,
  MORNING_SLOTS,
  syncPushPrefs,
  WEEKLY_SLOTS,
} from './pushService'
import styles from './SettingsView.module.css'

/** 平台提示文案（真实约束，非营销话术） */
function platformNote(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return 'iOS 上需先「添加到主屏幕」，之后从主屏图标打开本应用，通知才会生效（Safari 16.4+）。'
  }
  if (/Android/i.test(ua)) {
    return 'Android 上需「添加到主屏幕/安装应用」后通知才稳定（Chrome 对未安装站点隐藏权限）。'
  }
  return '通知需要浏览器权限；请保持 HTTPS 访问。'
}

export function NotificationSettingsView(): JSX.Element {
  const closeNotificationSettings = useApp((s) => s.closeNotificationSettings)
  const showToast = useApp((s) => s.showToast)

  // ---- v9.3：通知偏好 ----
  const pushMorningEnabled = useApp((s) => s.pushMorningEnabled)
  const pushMorningTime = useApp((s) => s.pushMorningTime)
  const pushEveningEnabled = useApp((s) => s.pushEveningEnabled)
  const pushEveningTime = useApp((s) => s.pushEveningTime)
  const pushWeeklyEnabled = useApp((s) => s.pushWeeklyEnabled)
  const pushWeeklyTime = useApp((s) => s.pushWeeklyTime)
  const setPushPrefs = useApp((s) => s.setPushPrefs)

  const [pushError, setPushError] = useState<string | null>(null)
  const pushSupport = getPushSupport()
  const cloudLoggedIn = isCloudLoggedIn()

  // v9.12 周报=会员项：已登录时查会员状态，非会员开关置灰（worker 侧仍会二次校验）
  const [isMember, setIsMember] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!cloudLoggedIn) {
      setIsMember(null)
      return
    }
    void (async () => {
      const token = await getAccessToken()
      if (!token) return
      const m = await fetchMember(token)
      if (!cancelled) setIsMember(!!(m.ok && m.member))
    })()
    return () => {
      cancelled = true
    }
  }, [cloudLoggedIn])

  /** 待同步的最新意图（快速连点时只保留最后一次，避免请求乱序） */
  const pendingRef = useRef<PushPrefs | null>(null)
  const syncingRef = useRef(false)

  /**
   * 应用早/晚/周报偏好变更：先乐观更新本地（点击立即生效），再同步云端。
   * 云端失败回滚到点击前状态并按原因给引导文案。
   * patch 为部分更新：缺省字段沿用当前 store 值。
   */
  const applyPushPrefs = async (patch: {
    morning?: { enabled?: boolean; time?: string | null }
    evening?: { enabled?: boolean; time?: string | null }
    weekly?: { enabled?: boolean; time?: string | null }
  }) => {
    const prev: PushPrefs = {
      morning: { enabled: pushMorningEnabled, time: pushMorningTime },
      evening: { enabled: pushEveningEnabled, time: pushEveningTime },
      weekly: { enabled: pushWeeklyEnabled, time: pushWeeklyTime },
    }
    const next: PushPrefs = {
      morning: {
        enabled: patch.morning?.enabled ?? prev.morning.enabled,
        time: patch.morning?.time !== undefined ? patch.morning.time : prev.morning.time,
      },
      evening: {
        enabled: patch.evening?.enabled ?? prev.evening.enabled,
        time: patch.evening?.time !== undefined ? patch.evening.time : prev.evening.time,
      },
      weekly: {
        enabled: patch.weekly?.enabled ?? prev.weekly.enabled,
        time: patch.weekly?.time !== undefined ? patch.weekly.time : prev.weekly.time,
      },
    }
    // 1) 乐观更新：本地立即反映选中/开关（不等云端，点击即有反馈）
    setPushError(null)
    await setPushPrefs(next)
    // 2) 记录最新意图；若已有同步在跑，循环结束后会用这份最新值续传
    pendingRef.current = next
    if (syncingRef.current) return
    syncingRef.current = true
    try {
      while (pendingRef.current) {
        const target = pendingRef.current
        pendingRef.current = null
        const res = await syncPushPrefs(target)
        if (!res.ok) {
          // 云端失败：回滚到点击前状态
          await setPushPrefs(prev)
          if (res.loginRequired) {
            setPushError('需先登录才能开启通知：主菜单 → 账号与同步，用邮箱登录')
          } else if (res.permissionDenied) {
            setPushError('通知权限被拒绝，请在浏览器设置中允许本网站的通知后重试')
          } else {
            setPushError(res.error ?? '通知设置保存失败')
          }
          return
        }
      }
      showToast('通知设置已保存')
    } finally {
      syncingRef.current = false
    }
  }

  const toggleMorning = () =>
    void applyPushPrefs({
      morning: {
        enabled: !pushMorningEnabled,
        time: !pushMorningEnabled ? (pushMorningTime ?? '08:00') : pushMorningTime,
      },
    })
  const toggleEvening = () =>
    void applyPushPrefs({
      evening: {
        enabled: !pushEveningEnabled,
        time: !pushEveningEnabled ? (pushEveningTime ?? '21:00') : pushEveningTime,
      },
    })
  const pickMorningTime = (t: string) => void applyPushPrefs({ morning: { time: t } })
  const pickEveningTime = (t: string) => void applyPushPrefs({ evening: { time: t } })
  // v9.12 周报=会员项：非会员开关置灰（不触发）；开启时默认沿用晚间日报时间
  const weeklyLocked = cloudLoggedIn && isMember === false
  const toggleWeekly = () => {
    if (weeklyLocked) {
      setPushError('周日周报是 DayCell 会员专属功能，升级会员后即可开启')
      return
    }
    void applyPushPrefs({
      weekly: {
        enabled: !pushWeeklyEnabled,
        time: !pushWeeklyEnabled ? (pushWeeklyTime ?? pushEveningTime ?? '21:00') : pushWeeklyTime,
      },
    })
  }
  const pickWeeklyTime = (t: string) => void applyPushPrefs({ weekly: { time: t } })

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeNotificationSettings}>
            ← 返回
          </button>
          <h1 className={styles.h1}>通知设置</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          {!cloudLoggedIn && (
            <div className={styles.pushStatus} role="alert">
              通知需要登录后才能开启：请先到「主菜单 → 账号与同步」用邮箱登录
            </div>
          )}
          {pushError && (
            <div className={`${styles.pushStatus} ${styles.pushStatusErr}`} role="alert">
              {pushError}
            </div>
          )}
          <div className={styles.group}>
            {/* 早间日报 */}
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>早间日报</div>
                <div className={styles.rowDesc}>每天定时推送今日概览：待办、习惯、特殊日与今日截止</div>
              </div>
              <button
                role="switch"
                aria-checked={pushMorningEnabled}
                aria-label="早间日报"
                className={pushMorningEnabled ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                onClick={toggleMorning}
              >
                <span className={styles.knob} />
              </button>
            </div>
            {pushMorningEnabled && (
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>推送时间</div>
                  <div className={styles.rowDesc}>可选半小时档位</div>
                </div>
                <div className={styles.chips} role="radiogroup" aria-label="早间推送时间">
                  {MORNING_SLOTS.map((t) => (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={pushMorningTime === t}
                      className={pushMorningTime === t ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                      onClick={() => pickMorningTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 晚间日报 */}
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>晚间日报</div>
                <div className={styles.rowDesc}>每天定时推送今日完成情况与未完成提醒</div>
              </div>
              <button
                role="switch"
                aria-checked={pushEveningEnabled}
                aria-label="晚间日报"
                className={pushEveningEnabled ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                onClick={toggleEvening}
              >
                <span className={styles.knob} />
              </button>
            </div>
            {pushEveningEnabled && (
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>推送时间</div>
                  <div className={styles.rowDesc}>可选半小时档位</div>
                </div>
                <div className={styles.chips} role="radiogroup" aria-label="晚间推送时间">
                  {EVENING_SLOTS.map((t) => (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={pushEveningTime === t}
                      className={pushEveningTime === t ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                      onClick={() => pickEveningTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* v9.12 周日周报（会员项）；v9.19 金色「会员专属」徽标统一会员语言 */}
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>
                  周日周报
                  {weeklyLocked && (
                    <span className={styles.vipTag} data-testid="weekly-vip-tag">
                      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 3.2l2 4.1 4.6.7-3.3 3.2.8 4.6L12 13.7l-4.1 2.1.8-4.6-3.3-3.2 4.6-.7z" fill="currentColor" />
                      </svg>
                      会员专属
                    </span>
                  )}
                </div>
                <div className={styles.rowDesc}>
                  每周日晚上推送本周汇总：待办完成、习惯打卡与目标进展
                  {weeklyLocked ? '' : ' · 时间默认跟随晚间日报'}
                </div>
              </div>
              <button
                role="switch"
                aria-checked={pushWeeklyEnabled}
                aria-label="周日周报"
                disabled={weeklyLocked}
                className={
                  pushWeeklyEnabled
                    ? `${styles.switch} ${styles.switchOn}`
                    : weeklyLocked
                      ? `${styles.switch} ${styles.switchDisabled}`
                      : styles.switch
                }
                onClick={toggleWeekly}
              >
                <span className={styles.knob} />
              </button>
            </div>
            {pushWeeklyEnabled && !weeklyLocked && (
              <div className={styles.row}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>推送时间</div>
                  <div className={styles.rowDesc}>默认与晚间日报一致，可单独调整</div>
                </div>
                <div className={styles.chips} role="radiogroup" aria-label="周报推送时间">
                  {WEEKLY_SLOTS.map((t) => (
                    <button
                      key={t}
                      role="radio"
                      aria-checked={(pushWeeklyTime ?? pushEveningTime) === t}
                      className={
                        (pushWeeklyTime ?? pushEveningTime) === t
                          ? `${styles.chip} ${styles.chipOn}`
                          : styles.chip
                      }
                      onClick={() => pickWeeklyTime(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className={styles.hint}>
            {pushSupport === 'supported'
              ? platformNote()
              : '当前浏览器/环境不支持网页推送（需 HTTPS 与 Service Worker）。'}
          </div>
        </div>
      </div>
    </div>
  )
}
