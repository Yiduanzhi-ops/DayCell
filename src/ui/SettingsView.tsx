/**
 * 设置页（v8.62 + v9.3）——全屏覆盖层，手机/桌面同构。
 *
 * 用户偏好开关的长期容器：后续所有「由用户自选的显示/行为开关」都放这里。
 *  - 周视图显示习惯打卡（默认关 = v8.41 现状；开则每周日行列出该日应打卡的
 *    习惯 + 打卡态，仿待办预览，整周统一不特殊化今天）。
 *  - 通知（v9.3）：早间日报 / 晚间日报 开关 + 档位（半小时粒度）。
 *    改动流程：本地状态 → syncPushPrefs（授权订阅 + 云端上报）→ 成功后写 repos.settings。
 *    云端只认已登录用户；未登录先引导去同步设置。
 *
 * 存储：repos.settings（localStorage 持久化），切换即时生效（无需重启）。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import { isCloudLoggedIn, type PushPrefs } from './cloudbase'
import {
  EVENING_SLOTS,
  getPushSupport,
  MORNING_SLOTS,
  syncPushPrefs,
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

export function SettingsView(): JSX.Element {
  const closeSettings = useApp((s) => s.closeSettings)
  const showToast = useApp((s) => s.showToast)

  // ---- v8.62：周视图显示习惯 ----
  const weekViewHabits = useApp((s) => s.weekViewHabits)
  const setWeekViewHabits = useApp((s) => s.setWeekViewHabits)

  // ---- v9.3：通知偏好 ----
  const pushMorningEnabled = useApp((s) => s.pushMorningEnabled)
  const pushMorningTime = useApp((s) => s.pushMorningTime)
  const pushEveningEnabled = useApp((s) => s.pushEveningEnabled)
  const pushEveningTime = useApp((s) => s.pushEveningTime)
  const setPushPrefs = useApp((s) => s.setPushPrefs)

  const [busy, setBusy] = useState(false)
  const [pushError, setPushError] = useState<string | null>(null)
  const pushSupport = getPushSupport()
  const cloudLoggedIn = isCloudLoggedIn()

  /**
   * 应用早/晚偏好变更：先同步云端（授权+上报），成功后写本地。
   * 云端失败不改本地（开关回弹），并按原因给引导文案。
   * patch 为部分更新：缺省字段沿用当前 store 值。
   */
  const applyPushPrefs = async (patch: {
    morning?: { enabled?: boolean; time?: string | null }
    evening?: { enabled?: boolean; time?: string | null }
  }) => {
    if (busy) return
    setBusy(true)
    try {
      const next: PushPrefs = {
        morning: {
          enabled: patch.morning?.enabled ?? pushMorningEnabled,
          time: patch.morning?.time !== undefined ? patch.morning.time : pushMorningTime,
        },
        evening: {
          enabled: patch.evening?.enabled ?? pushEveningEnabled,
          time: patch.evening?.time !== undefined ? patch.evening.time : pushEveningTime,
        },
      }
      const res = await syncPushPrefs(next)
      if (!res.ok) {
        if (res.loginRequired) {
          setPushError('需先登录云同步才能开启通知：设置 → 同步设置，用邮箱登录')
        } else if (res.permissionDenied) {
          setPushError('通知权限被拒绝，请在浏览器设置中允许本网站的通知后重试')
        } else {
          setPushError(res.error ?? '通知设置保存失败')
        }
        return
      }
      setPushError(null)
      await setPushPrefs({
        morning: { enabled: next.morning.enabled, time: next.morning.time },
        evening: { enabled: next.evening.enabled, time: next.evening.time },
      })
      showToast(next.morning.enabled || next.evening.enabled ? '通知已开启' : '通知已关闭')
    } finally {
      setBusy(false)
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

  return (
    <div className={styles.overlay}>
      <div className={styles.page}>
        <div className={styles.head}>
          <button className={styles.back} onClick={closeSettings}>
            ← 返回
          </button>
          <h1 className={styles.h1}>偏好设置</h1>
          <span className={styles.headSpacer} />
        </div>

        <div className={styles.body}>
          <div className={styles.group}>
            <div className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowTitle}>周视图显示习惯</div>
                <div className={styles.rowDesc}>周视图每日列出该日应打卡的习惯与完成状态（默认关）</div>
              </div>
              <button
                role="switch"
                aria-checked={weekViewHabits}
                aria-label="周视图显示习惯"
                className={weekViewHabits ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                onClick={() => void setWeekViewHabits(!weekViewHabits)}
              >
                <span className={styles.knob} />
              </button>
            </div>
          </div>

          <div className={styles.groupTitle}>通知</div>
          {!cloudLoggedIn && (
            <div className={styles.pushStatus} role="alert">
              通知需要登录云同步后才能开启：请先到「设置 → 同步设置」用邮箱登录
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
          </div>

          <div className={styles.hint}>
            {pushSupport === 'supported'
              ? platformNote()
              : '当前浏览器/环境不支持网页推送（需 HTTPS 与 Service Worker）。'}
          </div>
          <div className={styles.hint}>更多偏好开关会陆续加在这里</div>
        </div>
      </div>
    </div>
  )
}
