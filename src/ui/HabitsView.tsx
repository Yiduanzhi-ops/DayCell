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
/** v9.38 拖拽换序：只有左侧 ⠿ 柄可拖（按下即激活），行文字与空白处不再响应 */

export function HabitsView(): JSX.Element {
  const habitList = useApp((s) => s.habitList)
  const closeHabits = useApp((s) => s.closeHabits)
  const deleteHabit = useApp((s) => s.deleteHabit)
  const updateHabit = useApp((s) => s.updateHabit)
  const reorderHabits = useApp((s) => s.reorderHabits)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<HabitRecord | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  /** 拖拽中的实时预览顺序；null = 未拖拽 */
  const [preview, setPreview] = useState<HabitRecord[] | null>(null)
  /** dragId / preview 的同步镜像：拖拽判定与松手提交一律走 ref，
   *  避免 React 18 批处理异步 commit 导致快速拖动时 state 还是旧值（v9.26 修复「拖太快=没排序」） */
  const dragIdRef = useRef<string | null>(null)
  const previewRef = useRef<HabitRecord[] | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const dragging = useRef(false)
  /** habitList 的最新镜像：rAF 自动滚动回调读不到渲染闭包里的旧 habitList */
  const habitListRef = useRef(habitList)
  habitListRef.current = habitList
  /** 上一次的插入位：插入位没变就不重渲染，避免指针微动整表重排造成闪烁 */
  const lastIdxRef = useRef(-1)
  /** 边缘自动滚动：rAF 句柄 + 最新指针纵坐标（指针停在边缘不动也要继续滚） */
  const rafRef = useRef<number | null>(null)
  const lastYRef = useRef(0)

  const list = preview ?? habitList

  function baseList(): HabitRecord[] {
    return previewRef.current ?? habitListRef.current
  }

  function resetDrag(): void {
    dragging.current = false
    dragIdRef.current = null
    previewRef.current = null
    lastIdxRef.current = -1
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    setDragId(null)
    setPreview(null)
    // 拖拽期间禁了文本选择，松手时清掉任何残留选区
    window.getSelection()?.removeAllRanges()
  }

  /** 指针落在哪一行之间：返回**去掉拖拽行之后**的插入位（0..rest.length）。
   *  v9.37：拖拽行必须不计数——它本来就占了 DOM 一行，若也计入序号，插入位会偏后一格：
   *  跨过 ≥2 行时直接甩过头，且行位置一变下次重算又得到另一个值 → 行在两点间反复跳（用户看到的「一直闪」）。 */
  function targetIndex(clientY: number, draggingId: string): number {
    const lis = listRef.current?.querySelectorAll('li[data-hid]') ?? []
    let i = 0
    for (const li of lis) {
      if (li.getAttribute('data-hid') === draggingId) continue
      const r = li.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
      i++
    }
    return i
  }

  /** 按指针位置算插入位并刷新预览（拖拽移动与自动滚动共用） */
  function applyPreview(clientY: number): void {
    const draggingId = dragIdRef.current
    if (draggingId === null) return
    const base = baseList()
    const cur = base.find((x) => x.id === draggingId)
    if (!cur) return
    const rest = base.filter((x) => x.id !== draggingId)
    const idx = Math.max(0, Math.min(targetIndex(clientY, draggingId), rest.length))
    if (previewRef.current !== null && idx === lastIdxRef.current) return
    lastIdxRef.current = idx
    rest.splice(idx, 0, cur)
    // 同步镜像 + 状态：镜像保证松手提交用最新顺序（React 批次内 state 可能未追上）
    previewRef.current = rest
    setPreview(rest)
  }

  /** 拖到列表上下边缘时持续滚动（每帧一次，越靠边越快）；滚动后行位置变了，重算插入位 */
  function autoScrollStep(): void {
    rafRef.current = null
    if (!dragging.current) return
    const el = listRef.current
    const y = lastYRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const EDGE = 56
      let delta = 0
      if (y < r.top + EDGE) delta = -Math.ceil(((r.top + EDGE - y) / EDGE) * 14)
      else if (y > r.bottom - EDGE) delta = Math.ceil(((y - (r.bottom - EDGE)) / EDGE) * 14)
      if (delta !== 0) {
        const before = el.scrollTop
        el.scrollTop = before + delta
        if (el.scrollTop !== before) applyPreview(y)
      }
    }
    rafRef.current = requestAnimationFrame(autoScrollStep)
  }

  function startAutoScroll(): void {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(autoScrollStep)
  }

  /** 真正进入拖拽态：状态 + 镜像 + 起点插入位 + 自动滚动 */
  function beginDrag(id: string, clientY: number): void {
    dragging.current = true
    dragIdRef.current = id
    previewRef.current = habitListRef.current
    lastIdxRef.current = habitListRef.current.findIndex((x) => x.id === id)
    lastYRef.current = clientY
    setDragId(id)
    setPreview(habitListRef.current)
    startAutoScroll()
  }

  /** v9.38 拖拽柄：按下立即激活拖拽（行文字与行空白处不再响应拖动，避免与列表滚动抢手势） */
  function onHandlePointerDown(h: HabitRecord, e: React.PointerEvent<HTMLButtonElement>): void {
    e.preventDefault() // 防文本选择 / iOS 手势抢占
    const li = e.currentTarget.closest('li')
    if (!li) return
    beginDrag(h.id, e.clientY)
    // 指针捕获让指针移出柄/行之后仍能收到 move/up；部分环境（合成事件、已释放指针）会抛错，忽略即可
    try {
      li.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
  }

  /** 拖拽中指针移动：只有已进入拖拽态才重算插入位 */
  function onPointerMove(e: React.PointerEvent<HTMLLIElement>): void {
    lastYRef.current = e.clientY
    if (!dragging.current) return
    applyPreview(e.clientY)
  }

  function onPointerUp(): void {
    const ids = dragging.current && previewRef.current ? previewRef.current.map((x) => x.id) : null
    // 先提交（reorderHabits 内部第一句乐观改内存顺序，同步生效）再清预览，
    // 否则预览清空时 habitList 还是旧顺序，列表会先弹回旧序再跳成新序（v9.37 修「松手闪一下」）
    if (ids) void reorderHabits(ids)
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
          <p className={styles.dragHint}>
            按住每行左侧 ⠿ 拖动排序，松手即保存
          </p>
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
                (h.id === dragId ? ` ${styles.dragging}` : '')
              }
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={resetDrag}
            >
              <button
                className={styles.dragHandle}
                aria-label={`拖动排序：${h.name}`}
                onPointerDown={(e) => onHandlePointerDown(h, e)}
                onPointerUp={onPointerUp}
                onPointerCancel={resetDrag}
              >
                <svg width="13" height="15" viewBox="0 0 13 15" aria-hidden="true">
                  <path
                    d="M3 2.5h7M3 7.5h7M3 12.5h7"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
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
