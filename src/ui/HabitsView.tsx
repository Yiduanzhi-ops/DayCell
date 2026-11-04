/**
 * 习惯设置页（v8.0）：全屏覆盖层，右上角菜单「习惯设置」进入。
 *
 * 用户拍板口径（prototype/habits.html 验收）：
 *  - 列表 = 全部习惯（含暂停的）：名称 + 频率徽标 + 暂停开关 + 删除
 *  - 新建 = 名称 + 频率（每天 / 每周选星期几 chips）
 *  - 暂停后不出现在「今日习惯」（列表仍可见，可恢复）
 */
import { useRef, useState } from 'react'
import type { JSX } from 'react'
import type { HabitFreq, HabitRecord } from '@core'
import { useApp } from '@/app/context'
import { freqLabel } from './HabitSection'
import styles from './HabitsView.module.css'

const DOW_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
/** v9.23 拖拽换序：长按（移动端）/ 按住（桌面）220ms 激活，指针落点决定插入位 */
const LONG_PRESS_MS = 180

export function HabitsView(): JSX.Element {
  const habitList = useApp((s) => s.habitList)
  const closeHabits = useApp((s) => s.closeHabits)
  const deleteHabit = useApp((s) => s.deleteHabit)
  const updateHabit = useApp((s) => s.updateHabit)
  const reorderHabits = useApp((s) => s.reorderHabits)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<HabitRecord | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [pressingId, setPressingId] = useState<string | null>(null)
  /** 拖拽中的实时预览顺序；null = 未拖拽 */
  const [preview, setPreview] = useState<HabitRecord[] | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const downPoint = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  const dragging = useRef(false)

  const list = preview ?? habitList

  function resetDrag(): void {
    dragging.current = false
    if (longPress.current) clearTimeout(longPress.current)
    longPress.current = null
    downPoint.current = null
    setDragId(null)
    setPressingId(null)
    setPreview(null)
    // 拖拽期间禁了文本选择，松手时清掉任何残留选区
    window.getSelection()?.removeAllRanges()
  }

  /** 指针落在哪一行之间：返回应插入的 index（0..length） */
  function targetIndex(clientY: number): number {
    const lis = listRef.current?.querySelectorAll('li[data-hid]') ?? []
    let idx = 0
    for (const li of lis) {
      if (li.getAttribute('data-hid') === dragId) continue
      const r = li.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return idx
      idx++
    }
    return idx
  }

  function onRowPointerDown(h: HabitRecord, e: React.PointerEvent<HTMLLIElement>): void {
    if ((e.target as HTMLElement).closest('button')) return // 行内按钮不触发拖拽
    // 阻止浏览器默认行为（文本选择 / iOS 长按手势 / 触摸抢占），让指针序列完全归拖拽逻辑管
    e.preventDefault()
    setPressingId(h.id) // 立即反馈：按住即行变淡，提示「按住可拖动」
    // React 合成事件在异步回调中 currentTarget 会被置 null → 同步缓存 li 与 pointerId
    const li = e.currentTarget
    downPoint.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    longPress.current = setTimeout(() => {
      longPress.current = null
      dragging.current = true
      setDragId(h.id)
      setPreview(habitList)
      li.setPointerCapture(downPoint.current!.pointerId)
    }, LONG_PRESS_MS)
  }

  function onRowPointerMove(e: React.PointerEvent<HTMLLIElement>): void {
    if (!dragging.current) {
      // 未激活：移动超阈值则取消长按（让位给滚动）
      if (longPress.current && downPoint.current) {
        const dx = e.clientX - downPoint.current.x
        const dy = e.clientY - downPoint.current.y
        if (Math.abs(dx) + Math.abs(dy) > 12) {
          clearTimeout(longPress.current)
          longPress.current = null
        }
      }
      return
    }
    if (dragId === null) return
    const idx = targetIndex(e.clientY)
    setPreview((prev) => {
      if (!prev) return prev
      const cur = prev.find((x) => x.id === dragId)
      const rest = prev.filter((x) => x.id !== dragId)
      rest.splice(Math.max(0, Math.min(idx, rest.length)), 0, cur!)
      return rest
    })
  }

  function onRowPointerUp(): void {
    if (dragging.current && dragId && preview) {
      void reorderHabits(preview.map((x) => x.id))
    }
    resetDrag()
  }

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
        {habitList.length > 1 && (
          <p className={styles.dragHint}>长按 / 按住列表项拖动可调整顺序，松手保存</p>
        )}

        <ul className={`${styles.list}${dragId ? ` ${styles.draggingList}` : ''}`} ref={listRef}>
          {list.length === 0 && (
            <li className={styles.empty}>
              还没有习惯。点右上角「＋ 新建习惯」添加，比如「多喝水」「运动 30 分钟」。
            </li>
          )}
          {list.map((h) => (
            <li
              key={h.id}
              data-hid={h.id}
              className={
                (h.paused ? `${styles.item} ${styles.paused}` : styles.item) +
                (h.id === pressingId && h.id !== dragId ? ` ${styles.pressing}` : '') +
                (h.id === dragId ? ` ${styles.dragging}` : '')
              }
              onPointerDown={(e) => onRowPointerDown(h, e)}
              onPointerMove={onRowPointerMove}
              onPointerUp={onRowPointerUp}
              onPointerCancel={resetDrag}
            >
              <div className={styles.itemMain}>
                <span className={styles.itemTitle}>{h.name}</span>
                <span className={styles.itemDesc}>{freqLabel(h.freq)}</span>
              </div>
              <button
                className={styles.editBtn}
                aria-label={`编辑习惯：${h.name}`}
                onClick={() => setEditing(h)}
              >
                编辑
              </button>
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
      {!adding && editing && <HabitForm initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 新建/编辑习惯弹层（prototype 的底部 sheet；v9.22 支持编辑预填复用）
// ---------------------------------------------------------------------------

function HabitForm({ initial, onClose }: { initial?: HabitRecord; onClose: () => void }): JSX.Element {
  const createHabit = useApp((s) => s.createHabit)
  const updateHabit = useApp((s) => s.updateHabit)
  const [name, setName] = useState(initial?.name ?? '')
  const [freq, setFreq] = useState<HabitFreq>(initial?.freq ?? { kind: 'daily' })
  const [days, setDays] = useState<number[]>(
    initial?.freq.kind === 'weekly' ? [...(initial.freq.weekdays ?? [])] : [],
  )

  const toggleDay = (d: number): void => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()))
  }

  const canSave = name.trim().length > 0 && (freq.kind === 'daily' || days.length > 0)

  const submit = async (): Promise<void> => {
    if (!canSave) return
    const finalFreq: HabitFreq = freq.kind === 'weekly' ? { kind: 'weekly', weekdays: days } : { kind: 'daily' }
    const ok = initial
      ? await updateHabit(initial.id, { name: name.trim(), freq: finalFreq })
      : await createHabit({ name: name.trim(), freq: finalFreq })
    if (ok) onClose()
  }

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={styles.sheet} role="dialog" aria-label={initial ? '编辑习惯' : '新建习惯'}>
        <div className={styles.grab} />
        <h3>{initial ? '编辑习惯' : '新建习惯'}</h3>
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
