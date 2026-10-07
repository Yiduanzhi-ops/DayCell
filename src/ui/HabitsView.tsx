/**
 * 习惯设置页（v8.0）：全屏覆盖层，右上角菜单「习惯设置」进入。
 *
 * 用户拍板口径（prototype/habits.html 验收）：
 *  - 列表 = 全部习惯（含暂停的）：名称 + 频率徽标 + 暂停开关 + 删除
 *  - 新建 = 名称 + 频率（每天 / 每周选星期几 chips）
 *  - 暂停后不出现在「今日习惯」（列表仍可见，可恢复）
 */
import { useState } from 'react'
import type { JSX } from 'react'
import type { HabitFreq } from '@core'
import { useApp } from '@/app/context'
import { freqLabel } from './HabitSection'
import styles from './HabitsView.module.css'

const DOW_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

export function HabitsView(): JSX.Element {
  const habitList = useApp((s) => s.habitList)
  const closeHabits = useApp((s) => s.closeHabits)
  const deleteHabit = useApp((s) => s.deleteHabit)
  const updateHabit = useApp((s) => s.updateHabit)
  const [adding, setAdding] = useState(false)

  return (
    <div className={styles.overlay} role="dialog" aria-label="习惯设置">
      <div className={styles.page}>
        <header className={styles.head}>
          <button className={styles.back} onClick={closeHabits} aria-label="返回">
            ← 返回
          </button>
          <h1 className={styles.h1}>习惯设置</h1>
          <button className={styles.addBtn} onClick={() => setAdding(true)} disabled={adding}>
            ＋ 新建习惯
          </button>
        </header>

        <ul className={styles.list}>
          {habitList.length === 0 && (
            <li className={styles.empty}>
              还没有习惯。点右上角「＋ 新建习惯」添加，比如「多喝水」「运动 30 分钟」。
            </li>
          )}
          {habitList.map((h) => (
            <li key={h.id} className={h.paused ? `${styles.item} ${styles.paused}` : styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.itemTitle}>{h.name}</span>
                <span className={styles.itemDesc}>{freqLabel(h.freq)}</span>
              </div>
              <button
                role="switch"
                aria-checked={!h.paused}
                aria-label={`${h.paused ? '恢复' : '暂停'}习惯：${h.name}`}
                className={h.paused ? styles.switch : `${styles.switch} ${styles.switchOn}`}
                onClick={() => void updateHabit(h.id, { paused: !h.paused })}
              >
                <span className={styles.knob} />
              </button>
              <button
                className={styles.delBtn}
                aria-label={`删除习惯：${h.name}`}
                onClick={() => {
                  if (window.confirm(`删除习惯「${h.name}」？打卡记录一并删除。`)) void deleteHabit(h.id)
                }}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      </div>

      {adding && <HabitForm onClose={() => setAdding(false)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 新建习惯弹层（prototype 的底部 sheet）
// ---------------------------------------------------------------------------

function HabitForm({ onClose }: { onClose: () => void }): JSX.Element {
  const createHabit = useApp((s) => s.createHabit)
  const [name, setName] = useState('')
  const [freq, setFreq] = useState<HabitFreq>({ kind: 'daily' })
  const [days, setDays] = useState<number[]>([])

  const toggleDay = (d: number): void => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  }

  const canSave = name.trim().length > 0 && (freq.kind === 'daily' || days.length > 0)

  const submit = async (): Promise<void> => {
    if (!canSave) return
    const finalFreq: HabitFreq = freq.kind === 'weekly' ? { kind: 'weekly', weekdays: days } : { kind: 'daily' }
    const ok = await createHabit({ name: name.trim(), freq: finalFreq })
    if (ok) onClose()
  }

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.sheet} role="dialog" aria-label="新建习惯">
        <div className={styles.grab} />
        <h3>新建习惯</h3>
        <div className={styles.field}>
          <label>习惯名称</label>
          <input
            type="text"
            placeholder="如：多喝水 / 运动 30 分钟"
            value={name}
            maxLength={30}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
        </div>
        <div className={styles.field}>
          <label>频率</label>
          <div className={styles.seg}>
            <button
              className={freq.kind === 'daily' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
              onClick={() => setFreq({ kind: 'daily' })}
            >
              每天
            </button>
            <button
              className={freq.kind === 'weekly' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
              onClick={() => setFreq({ kind: 'weekly', weekdays: days })}
            >
              每周
            </button>
          </div>
          {freq.kind === 'weekly' && (
            <div className={styles.dowRow}>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <button
                  key={d}
                  className={days.includes(d) ? `${styles.dowBtn} ${styles.dowOn}` : styles.dowBtn}
                  onClick={() => toggleDay(d)}
                  aria-pressed={days.includes(d)}
                >
                  {DOW_FULL[d]}
                </button>
              ))}
            </div>
          )}
          <p className={styles.hint}>
            {freq.kind === 'daily'
              ? '习惯每天都会出现在「今日习惯」里。'
              : '习惯只在选中的星期几出现在「今日习惯」里。'}
          </p>
        </div>
        <div className={styles.act}>
          <button className={styles.btnSoft} onClick={onClose}>取消</button>
          <button className={styles.btnPrimary} disabled={!canSave} onClick={() => void submit()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
