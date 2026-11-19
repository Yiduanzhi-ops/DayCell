/**
 * 设置页（v8.62 + v9.3）——全屏覆盖层，手机/桌面同构。
 *
 * 用户偏好开关的长期容器：后续所有「由用户自选的显示/行为开关」都放这里。
 *  - 周视图显示习惯打卡（默认关 = v8.41 现状；开则每周日行列出该日应打卡的
 *    习惯 + 打卡态，仿待办预览，整周统一不特殊化今天）。
 * 通知设置（v9.3）为同级独立页，入口在主菜单「通知设置」，不在此页内。
 *
 * 存储：repos.settings（localStorage 持久化），切换即时生效（无需重启）。
 */
import type { JSX } from 'react'
import { useApp } from '@/app/context'
import styles from './SettingsView.module.css'

export function SettingsView(): JSX.Element {
  const closeSettings = useApp((s) => s.closeSettings)

  // ---- v8.62：周视图显示习惯 ----
  const weekViewHabits = useApp((s) => s.weekViewHabits)
  const setWeekViewHabits = useApp((s) => s.setWeekViewHabits)

  // ---- v9.65：今日视图模块显隐（默认全显）----
  const showTodo = useApp((s) => s.showTodo)
  const showProgress = useApp((s) => s.showProgress)
  const showHabits = useApp((s) => s.showHabits)
  const showNotes = useApp((s) => s.showNotes)
  const showReview = useApp((s) => s.showReview)
  const setSectionVisible = useApp((s) => s.setSectionVisible)

  const sections: { key: 'todo' | 'progress' | 'habits' | 'notes' | 'review'; title: string; desc: string; on: boolean }[] = [
    { key: 'todo', title: '待办', desc: '今天要做的事、截止与提醒', on: showTodo },
    { key: 'progress', title: '目标推进', desc: '从目标里挑进来的子任务，每天打一次卡', on: showProgress },
    { key: 'habits', title: '习惯', desc: '每日打卡的习惯清单', on: showHabits },
    { key: 'notes', title: '想法', desc: '随手记的碎片与灵感', on: showNotes },
    { key: 'review', title: '复盘', desc: '今天做了什么、哪里可以更好', on: showReview },
  ]

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
          <div className={styles.groupTitle}>周视图</div>
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

          <div className={styles.groupTitle}>今日视图模块</div>
          <div className={styles.group}>
            {sections.map((it) => (
              <div className={styles.row} key={it.key}>
                <div className={styles.rowText}>
                  <div className={styles.rowTitle}>{it.title}</div>
                  <div className={styles.rowDesc}>{it.desc}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={it.on}
                  aria-label={`显示${it.title}`}
                  className={it.on ? `${styles.switch} ${styles.switchOn}` : styles.switch}
                  onClick={() => void setSectionVisible(it.key, !it.on)}
                >
                  <span className={styles.knob} />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.hint}>关掉的模块只是不在今日视图显示，内容不会删除；想看时随时打开</div>
        </div>
      </div>
    </div>
  )
}
