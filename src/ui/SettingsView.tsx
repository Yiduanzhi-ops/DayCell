/**
 * 设置页（v8.62）——全屏覆盖层，手机/桌面同构。
 *
 * 用户偏好开关的长期容器：后续所有「由用户自选的显示/行为开关」都放这里。
 * 当前第一项：周视图显示习惯打卡（默认关 = v8.41 现状；开则每周日行列出
 * 该日应打卡的习惯 + 打卡态，仿待办预览，整周统一不特殊化今天）。
 *
 * 存储：repos.settings（localStorage 持久化），切换即时生效（无需重启）。
 */
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './SettingsView.module.css'

export function SettingsView(): JSX.Element {
  const closeSettings = useApp((s) => s.closeSettings)
  const weekViewHabits = useApp((s) => s.weekViewHabits)
  const setWeekViewHabits = useApp((s) => s.setWeekViewHabits)

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

          <div className={styles.hint}>更多偏好开关会陆续加在这里</div>
        </div>
      </div>
    </div>
  )
}
