/**
 * 目标模块（v7.9；v8.5 加「阶段 | 子任务」双视图）：底部 tab 第 4 个「目标」。
 *
 * 交互（以 prototype/goals.html 为验收标准，用户已拍板）：
 *  - 列表页 = 全部目标：标题 + 「当前 · xx」徽标 + 进度 + 子任务数 + 阶段数（子任务在前）+ 阐述 2 行截断（v8.7）
 *  - 详情页 = **顶部主展示目标阐述**（大段可编辑文本），**下方才是列表**
 *  - v8.5 双视图：阐述下方、列表上方有「子任务 | 阶段」切换按钮（v8.6 换序）；**v8.7 默认打开子任务视图**；
 *    阶段是时间维度（现状不变），子任务是执行维度（标题 + 完成勾选 + 删除 + 点文字就地编辑），
 *    两者并存不替代、各自进度独立（目标卡片进度不受子任务影响）
 *  - 阶段 = 名称 + 百分比滑杆 + 备注 + 进行中/已完成 + 「当前」（同目标互斥）
 *  - 无子阶段、无每日打卡、不与待办/支出联动；账单总结 = 目标的一种用法（用户拍板）
 */
import { useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { parsePct } from '@core'
import type { FolderSummary, GoalRecord, ProgressField, StageInput, StageRecord, SubtaskRecord } from '@core'
import { useApp } from '@/app/context'
import styles from './GoalsView.module.css'

/** v9.14.3 全部视图「未分类」组折叠持久化 key（'1' = 折叠） */
const UNCAT_COLLAPSED_KEY = 'daycell.goalUncategorizedCollapsed'

// ---------------------------------------------------------------------------
// 弹层通用骨架（与 AnnivSettings 一致的 overlay/sheet 模式）
// ---------------------------------------------------------------------------

function Sheet({
  title,
  onCancel,
  children,
}: {
  title: string
  onCancel: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className={styles.sheet} role="dialog" aria-label={title}>
        <div className={styles.grab} />
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 新建目标弹层
// ---------------------------------------------------------------------------

function NewGoalSheet({
  defaultFolderId,
  onClose,
}: {
  defaultFolderId?: string | null
  onClose: () => void
}): JSX.Element {
  const createGoal = useApp((s) => s.createGoal)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  // v9.14 放入文件夹：null = 未分类（可跳过）。defaultFolderId = 从文件夹视图进入时自动归属
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId ?? null)

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    const ok = await createGoal(title.trim(), note.trim(), folderId)
    if (ok) onClose()
  }

  return (
    <Sheet title="新建目标" onCancel={onClose}>
      <div className={styles.field}>
        <label>目标名称</label>
        <input
          type="text"
          placeholder="如：复习考公"
          value={title}
          maxLength={50}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </div>
      <div className={styles.field}>
        <label>目标阐述（可选）</label>
        <textarea
          placeholder="这个阶段想做什么、为什么做、怎么衡量"
          value={note}
          maxLength={5000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {/* v9.14 放入文件夹：不选 = 未分类 */}
      <div className={styles.field}>
        <label>放入文件夹（可选）</label>
        <FolderPick value={folderId} onChange={setFolderId} />
      </div>
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button
          className={styles.btnPrimary}
          disabled={!title.trim()}
          onClick={() => void submit()}
        >
          创建
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.14 文件夹选择 chips（新建目标 / 移动到文件夹 共用）
// value: null = 未分类（清空 folderId）；includeNull 关闭时不出现「未分类」项
// ---------------------------------------------------------------------------

function FolderPick({
  value,
  onChange,
  includeNull = true,
}: {
  value: string | null
  onChange: (id: string | null) => void
  includeNull?: boolean
}): JSX.Element {
  const folderList = useApp((s) => s.folderList)
  return (
    <div className={styles.folderPick}>
      {includeNull && (
        <button
          type="button"
          className={value === null ? `${styles.folderPickChip} ${styles.folderPickOn}` : styles.folderPickChip}
          onClick={() => onChange(null)}
        >
          未分类
        </button>
      )}
      {folderList.map(({ folder }) => (
        <button
          type="button"
          key={folder.id}
          className={value === folder.id ? `${styles.folderPickChip} ${styles.folderPickOn}` : styles.folderPickChip}
          onClick={() => onChange(folder.id)}
        >
          {folder.favorite ? '★ ' : ''}{folder.name}
        </button>
      ))}
      {folderList.length === 0 && includeNull && (
        <span className={styles.folderPickEmpty}>还没有文件夹，目标会放在「未分类」，之后可在详情页移动到文件夹</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// v9.14 新建文件夹弹层
// ---------------------------------------------------------------------------

function NewFolderSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const createFolder = useApp((s) => s.createFolder)
  const [name, setName] = useState('')

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    const ok = await createFolder(name.trim())
    if (ok) onClose()
  }

  return (
    <Sheet title="新建文件夹" onCancel={onClose}>
      <div className={styles.field}>
        <label>文件夹名称</label>
        <input
          type="text"
          placeholder="如：2026 考证"
          value={name}
          maxLength={12}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <div className={styles.hint}>文件夹是一层扁平分类，不嵌套。目标不随文件夹删除。</div>
      </div>
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button className={styles.btnPrimary} disabled={!name.trim()} onClick={() => void submit()}>创建</button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.14 删除文件夹确认弹层（明示：目标自动移出到未分类，目标本身不删除）
// ---------------------------------------------------------------------------

function DeleteFolderConfirm({
  folder,
  onClose,
  onDeleted,
}: {
  folder: FolderSummary
  onClose: () => void
  onDeleted?: () => void
}): JSX.Element {
  const deleteFolder = useApp((s) => s.deleteFolder)
  return (
    <Sheet title="删除文件夹" onCancel={onClose}>
      <p className={styles.confirmText}>
        删除「{folder.folder.name}」后，文件夹里的 <b>{folder.count}</b> 个目标将自动移出到未分类，目标本身不会被删除。
      </p>
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button
          className={styles.btnDanger}
          onClick={() => {
            void deleteFolder(folder.folder.id).then((ok) => {
              if (ok) onDeleted?.()
              onClose()
            })
          }}
        >
          删除文件夹
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.14.3 删除目标确认弹层（明示：连带删除阶段/子任务，不可恢复）
// ---------------------------------------------------------------------------

function DeleteGoalConfirm({
  goal,
  onClose,
  onDeleted,
}: {
  goal: GoalRecord
  onClose: () => void
  onDeleted?: () => void
}): JSX.Element {
  const deleteGoal = useApp((s) => s.deleteGoal)
  return (
    <Sheet title="删除目标" onCancel={onClose}>
      <p className={styles.confirmText}>
        删除「{goal.title}」将同时删除它的全部阶段与子任务，此操作不可恢复。
      </p>
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button
          className={styles.btnDanger}
          onClick={() => {
            void deleteGoal(goal.id).then((ok) => {
              if (ok) onDeleted?.()
              onClose()
            })
          }}
        >
          删除目标
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.14 文件夹组头菜单（收藏/取消收藏、删除）
// ---------------------------------------------------------------------------

function FolderMenuSheet({
  folder,
  onClose,
  onDeleted,
}: {
  folder: FolderSummary
  onClose: () => void
  onDeleted?: () => void
}): JSX.Element {
  const toggleFolderFavorite = useApp((s) => s.toggleFolderFavorite)
  const [confirmDel, setConfirmDel] = useState(false)
  const fav = folder.folder.favorite ?? false
  return (
    <Sheet title={folder.folder.name} onCancel={onClose}>
      <div className={styles.menuList}>
        <button
          className={styles.menuItem}
          onClick={() => {
            void toggleFolderFavorite(folder.folder.id)
            onClose()
          }}
        >
          <span className={styles.menuIcon}>{fav ? '★' : '☆'}</span>
          {fav ? '取消收藏' : '收藏文件夹'}
        </button>
        <button className={`${styles.menuItem} ${styles.menuItemDanger}`} onClick={() => setConfirmDel(true)}>
          <span className={styles.menuIcon}>🗑</span>
          删除文件夹
        </button>
      </div>
      {confirmDel && <DeleteFolderConfirm folder={folder} onClose={onClose} onDeleted={onDeleted} />}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.14 移动到文件夹（详情页入口；保持详情页其余结构原样）
// ---------------------------------------------------------------------------

function MoveGoalSheet({ goal, onClose }: { goal: GoalRecord; onClose: () => void }): JSX.Element {
  const moveGoalToFolder = useApp((s) => s.moveGoalToFolder)
  const folderList = useApp((s) => s.folderList)
  const [pick, setPick] = useState<string | null>(goal.folderId ?? null)
  const current = folderList.find((x) => x.folder.id === goal.folderId)

  const submit = async (): Promise<void> => {
    const ok = await moveGoalToFolder(goal.id, pick)
    if (ok) onClose()
  }

  return (
    <Sheet title="移动到文件夹" onCancel={onClose}>
      {current && (
        <div className={styles.hint} style={{ marginBottom: 10 }}>
          当前在「{current.folder.name}」
        </div>
      )}
      <FolderPick value={pick} onChange={setPick} />
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button className={styles.btnPrimary} onClick={() => void submit()}>移动</button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// 添加/编辑阶段弹层（同一表单，editing 传入则为编辑模式）
// ---------------------------------------------------------------------------

function StageSheet({
  editing,
  onClose,
}: {
  /** null = 添加；非 null = 编辑该阶段 */
  editing: StageRecord | null
  onClose: () => void
}): JSX.Element {
  const goalDetail = useApp((s) => s.goalDetail)
  const createStage = useApp((s) => s.createStage)
  const updateStage = useApp((s) => s.updateStage)

  const [title, setTitle] = useState(editing?.title ?? '')
  const [pct, setPct] = useState<number | null>(editing?.pct ?? 0)
  const [note, setNote] = useState(editing?.note ?? '')

  const goalId = goalDetail?.goal.id ?? ''
  const submit = async (): Promise<void> => {
    if (!title.trim() || !goalId) return
    // 滑杆无「清空」语义：pct 是 number；编辑时如果原无 pct 且用户没动滑杆，仍按 0 保存
    const ok = editing
      ? await updateStage(editing.id, { title: title.trim(), pct: pct ?? undefined, note: note.trim() })
      : await createStage({ goalId, title: title.trim(), pct: pct ?? 0, note: note.trim() } as StageInput)
    if (ok) onClose()
  }

  return (
    <Sheet title={editing ? '编辑阶段' : '添加阶段'} onCancel={onClose}>
      <div className={styles.field}>
        <label>阶段名称</label>
        <input
          type="text"
          placeholder="如：刷题阶段"
          value={title}
          maxLength={50}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
      </div>
      <div className={styles.field}>
        <label>当前进度</label>
        <div className={styles.pctRow}>
          <input
            type="range"
            min={0}
            max={100}
            value={pct ?? 0}
            aria-label="进度百分比"
            onChange={(e) => setPct(Number(e.target.value))}
          />
          <span className={styles.pctVal}>{pct ?? 0}%</span>
        </div>
      </div>
      <div className={styles.field}>
        <label>备注（可选）</label>
        <textarea
          placeholder="这个阶段的具体安排、复盘记录"
          value={note}
          maxLength={1000}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      {!editing && (
        <p className={styles.hint}>
          第一个阶段会自动成为「当前」阶段；之后的新阶段默认为「未开始」，可在列表手动设为当前。
        </p>
      )}
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button
          className={styles.btnPrimary}
          disabled={!title.trim()}
          onClick={() => void submit()}
        >
          {editing ? '保存' : '添加'}
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// 子任务弹层（v8.5：单字段，最轻——只有标题）
// ---------------------------------------------------------------------------

function SubtaskSheet({ goalId, onClose }: { goalId: string; onClose: () => void }): JSX.Element {
  const createSubtask = useApp((s) => s.createSubtask)
  const [title, setTitle] = useState('')

  const submit = async (): Promise<void> => {
    const t = title.trim()
    if (!t) return
    const ok = await createSubtask({ goalId, title: t })
    if (ok) onClose()
  }

  return (
    <Sheet title="添加子任务" onCancel={onClose}>
      <div className={styles.field}>
        <label>子任务</label>
        <input
          type="text"
          placeholder="如：做完教案第 3 章"
          value={title}
          maxLength={50}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void submit()
            }
          }}
        />
      </div>
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button className={styles.btnPrimary} disabled={!title.trim()} onClick={() => void submit()}>
          添加
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// 阶段行
// ---------------------------------------------------------------------------

function StageRow({
  stage,
  onEdit,
  onDelete,
}: {
  stage: StageRecord
  onEdit: (s: StageRecord) => void
  onDelete: (s: StageRecord) => void
}): JSX.Element {
  const setCurrentStage = useApp((s) => s.setCurrentStage)
  const setStageDone = useApp((s) => s.setStageDone)
  const [expanded, setExpanded] = useState(false)

  const badge = stage.isCurrent
    ? <span className={`${styles.badge} ${styles.badgeCur}`}>当前</span>
    : stage.done
      ? <span className={`${styles.badge} ${styles.badgeDone}`}>已完成</span>
      : <span className={`${styles.badge} ${styles.badgePend}`}>未开始</span>

  const status = stage.isCurrent ? '进行中' : stage.done ? '已完成' : '未开始'

  const rowCls = [
    styles.stageRow,
    stage.isCurrent ? styles.current : '',
    stage.done ? styles.done : '',
  ].join(' ')

  return (
    <div
      className={rowCls}
      onClick={() => setExpanded((v) => !v)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setExpanded((v) => !v)
        }
      }}
    >
      <div className={styles.stageHead}>
        <span className={styles.stageName}>{stage.title}</span>
        {badge}
      </div>
      {/* v8.32 空条口径：无 pct 也显示 0% 空条；done 记 100 */}
      <div className={styles.bar}>
        <i style={{ width: `${stage.done ? 100 : (stage.pct ?? 0)}%` }} />
      </div>
      <div className={styles.stageFoot}>
        <span>进度 {stage.pct !== undefined ? `${stage.pct}%` : '—'}</span>
        <span className={styles.sp} />
        <span>{status}</span>
      </div>
      {stage.note && (
        <div className={styles.stageNote}>
          <b>备注：</b>{stage.note}
        </div>
      )}
      <div className={expanded ? `${styles.ops} ${styles.opsOn}` : styles.ops}>
        {!stage.isCurrent && (
          <button
            className={styles.opPrimary}
            onClick={(e) => {
              e.stopPropagation()
              void setCurrentStage(stage.id)
            }}
          >
            设为当前
          </button>
        )}
        {!stage.done && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void setStageDone(stage.id, true)
            }}
          >
            标记完成
          </button>
        )}
        {stage.done && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              void setStageDone(stage.id, false)
            }}
          >
            取消完成
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit(stage)
          }}
        >
          编辑
        </button>
        <button
          className={styles.opDanger}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(stage)
          }}
        >
          删除
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子任务行（v8.5）：勾选 + 点文字就地编辑 + 删除；完成后沉底（aggregate 排序）
// ---------------------------------------------------------------------------

function SubtaskRow({
  subtask,
  onDelete,
}: {
  subtask: SubtaskRecord
  onDelete: (s: SubtaskRecord) => void
}): JSX.Element {
  const setSubtaskDone = useApp((s) => s.setSubtaskDone)
  const updateSubtask = useApp((s) => s.updateSubtask)
  const toggleSubtaskWork = useApp((s) => s.toggleSubtaskWork)
  const addSubtaskToToday = useApp((s) => s.addSubtaskToToday)
  const removeSubtaskFromToday = useApp((s) => s.removeSubtaskFromToday)
  const subtaskTodayIds = useApp((s) => s.subtaskTodayIds)
  const today = useApp((s) => s.today)
  const showToast = useApp((s) => s.showToast)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(subtask.title)
  // v8.9：描述就地编辑（方案 A，常驻显示在标题下方）
  const [descEditing, setDescEditing] = useState(false)
  const [descDraft, setDescDraft] = useState(subtask.desc ?? '')
  // v8.10：当前进度（C 形态：文本 + 百分比，描述在上、进度在下）
  const [progEditing, setProgEditing] = useState(false)
  const [progPctDraft, setProgPctDraft] = useState(subtask.progress?.pct !== undefined ? String(subtask.progress.pct) : '')
  const [progNoteDraft, setProgNoteDraft] = useState(subtask.progress?.note ?? '')
  // v8.45 打卡：当天是否已打卡（跨天自动重置）
  const workedToday = Array.isArray(subtask.workDates) && subtask.workDates.includes(today)
  // v8.63 加入今日待办：今天是否已加入（按钮两态；跨天自动重置）
  const inToday = subtaskTodayIds.includes(subtask.id)

  const save = async (): Promise<void> => {
    const t = draft.trim()
    if (t && t !== subtask.title) await updateSubtask(subtask.id, { title: t })
    setEditing(false)
  }

  const saveDesc = async (): Promise<void> => {
    const d = descDraft.trim()
    const orig = subtask.desc ?? ''
    if (d !== orig) await updateSubtask(subtask.id, { desc: d })
    setDescEditing(false)
  }

  const saveProgress = async (): Promise<void> => {
    const { p, err: e } = draftToProgress(progPctDraft, progNoteDraft)
    if (e) {
      showToast(e)
      return
    }
    const origPct = subtask.progress?.pct
    const origNote = subtask.progress?.note ?? ''
    if ((p?.pct ?? undefined) !== origPct || (p?.note ?? '') !== origNote) {
      await updateSubtask(subtask.id, { progress: p })
    }
    setProgEditing(false)
  }

  return (
    <div className={[styles.subtaskRow, subtask.done ? styles.subtaskDone : ''].join(' ')}>
      <button
        className={subtask.done ? `${styles.subCheck} ${styles.subCheckOn}` : styles.subCheck}
        role="checkbox"
        aria-checked={subtask.done}
        aria-label={subtask.done ? `取消完成：${subtask.title}` : `标记完成：${subtask.title}`}
        onClick={() => void setSubtaskDone(subtask.id, !subtask.done)}
      >
        {subtask.done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <div className={styles.subBody}>
        {editing ? (
          <input
            className={styles.subInput}
            value={draft}
            maxLength={50}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') {
                setDraft(subtask.title)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className={styles.subTitle}
            title="点击编辑"
            onClick={() => {
              setDraft(subtask.title)
              setEditing(true)
            }}
          >
            {subtask.title}
          </span>
        )}
        {descEditing ? (
          <textarea
            className={styles.subDescInput}
            value={descDraft}
            maxLength={500}
            rows={2}
            placeholder="子任务描述"
            autoFocus
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={() => void saveDesc()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setDescDraft(subtask.desc ?? '')
                setDescEditing(false)
              }
            }}
          />
        ) : (
          <div
            className={[styles.subDesc, !subtask.desc ? styles.subDescEmpty : ''].join(' ')}
            title="点击编辑描述"
            onClick={() => {
              setDescDraft(subtask.desc ?? '')
              setDescEditing(true)
            }}
          >
            {subtask.desc || '＋ 添加描述'}
          </div>
        )}
        {/* v8.32 行内横向进度条：进度描述上面一行（描述之下）。口径：勾选完成 100 / 手填 pct / 0 空条 */}
        <div className={styles.subBarRow}>
          <div className={styles.subBarTrack}>
            <div
              className={styles.subBarFill}
              style={{ width: `${subtask.done ? 100 : (subtask.progress?.pct ?? 0)}%` }}
            />
          </div>
          <span className={styles.subBarPct}>{subtask.done ? 100 : (subtask.progress?.pct ?? 0)}%</span>
        </div>
        {/* v8.10 当前进度：与描述同级，描述在上、进度在下（C 形态：文本 + 百分比） */}
        {progEditing ? (
          // 容器级失焦保存（v8.10.1 修复）：焦点在编辑区内移动（百分比→描述）不保存，
          // 焦点完全离开编辑区才保存——避免点描述时百分比框失焦把整个编辑态关掉
          <div
            className={styles.subProgEdit}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) void saveProgress()
            }}
          >
            <input
              className={styles.subPctInput}
              type="text"
              inputMode="numeric"
              value={progPctDraft}
              placeholder="0-100"
              maxLength={3}
              autoFocus
              onChange={(e) => setProgPctDraft(e.target.value)}
            />
            <textarea
              className={styles.subProgNoteInput}
              value={progNoteDraft}
              maxLength={200}
              rows={2}
              placeholder="进度描述"
              onChange={(e) => setProgNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setProgPctDraft(subtask.progress?.pct !== undefined ? String(subtask.progress.pct) : '')
                  setProgNoteDraft(subtask.progress?.note ?? '')
                  setProgEditing(false)
                }
              }}
            />
          </div>
        ) : subtask.progress && (subtask.progress.pct !== undefined || subtask.progress.note) ? (
          <div
            className={styles.subProg}
            title="点击编辑当前进度"
            onClick={() => {
              setProgPctDraft(subtask.progress?.pct !== undefined ? String(subtask.progress.pct) : '')
              setProgNoteDraft(subtask.progress?.note ?? '')
              setProgEditing(true)
            }}
          >
            {subtask.progress.pct !== undefined && <span className={styles.subPct}>{subtask.progress.pct}%</span>}
            {subtask.progress.pct !== undefined && subtask.progress.note && <span className={styles.subProgSep}> · </span>}
            {subtask.progress.note && <span className={styles.subProgNote}>{subtask.progress.note}</span>}
          </div>
        ) : (
          <div
            className={[styles.subProg, styles.subProgEmpty].join(' ')}
            title="点击编辑当前进度"
            onClick={() => {
              setProgPctDraft('')
              setProgNoteDraft('')
              setProgEditing(true)
            }}
          >
            ＋ 添加进度
          </div>
        )}
        {/* v8.45 子任务打卡：累计进行天数 + 打卡按钮（记录今天，可取消）；v8.63 加「加入今日待办」 */}
        <div className={styles.subWorkRow}>
          <span className={styles.subWorkCount}>
            累计进行 <b>{Array.isArray(subtask.workDates) ? subtask.workDates.length : 0}</b> 天
          </span>
          <span style={{ flex: 1 }} />
          <button
            className={[styles.subCheckin, workedToday ? styles.subCheckinOn : ''].join(' ')}
            aria-label={workedToday ? `取消今天的打卡：${subtask.title}` : `打卡：${subtask.title}`}
            onClick={() => void toggleSubtaskWork(subtask.id)}
          >
            {workedToday ? '已打卡' : '打卡'}
          </button>
          {/* v8.63 加入今日待办：当天有效，明天要再点；已加入可再点取消 */}
          <button
            className={[styles.subToday, inToday ? styles.subTodayOn : ''].join(' ')}
            aria-label={inToday ? `移出今日待办：${subtask.title}` : `加入今日待办：${subtask.title}`}
            onClick={() => void (inToday ? removeSubtaskFromToday(subtask.id) : addSubtaskToToday(subtask.id))}
          >
            {inToday ? '已加入' : '＋ 加入今日待办'}
          </button>
        </div>
      </div>
      <button
        className={styles.subDel}
        aria-label={`删除子任务：${subtask.title}`}
        title="删除"
        onClick={() => onDelete(subtask)}
      >
        ✕
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 目标详情页：阐述为主展示，阶段列表在下方
// ---------------------------------------------------------------------------

/**
 * v8.10 把草稿（pct 文本 + note 文本）解析为 ProgressField。
 * pct 空 = 不填；非法 → 返回 { err }（调用方 toast 提示且不退出编辑）；
 * note 空 = 忽略。都空 → 空对象 {}（repo 层语义 = 清空进度）。
 */
const draftToProgress = (pctTxt: string, noteTxt: string): { p?: ProgressField; err?: string } => {
  const t = pctTxt.trim()
  let pct: number | undefined
  if (t) {
    const r = parsePct(t)
    if (!r.ok) return { err: r.message }
    pct = r.value
  }
  const note = noteTxt.trim()
  const p: ProgressField = {}
  if (pct !== undefined) p.pct = pct
  if (note) p.note = note
  return { p }
}

function GoalDetail({
  goal,
  stages,
  subtasks,
}: {
  goal: GoalRecord
  stages: StageRecord[]
  subtasks: SubtaskRecord[]
}): JSX.Element {
  const closeGoal = useApp((s) => s.closeGoal)
  const updateGoal = useApp((s) => s.updateGoal)
  const setGoalDone = useApp((s) => s.setGoalDone)
  const deleteStage = useApp((s) => s.deleteStage)
  const deleteSubtask = useApp((s) => s.deleteSubtask)
  const showToast = useApp((s) => s.showToast)

  const [noteEdit, setNoteEdit] = useState(false)
  const [noteDraft, setNoteDraft] = useState(goal.note)
  // v8.10 目标层级当前进度（与阐述同级，阐述上、进度下，独立手填）
  const [progEdit, setProgEdit] = useState(false)
  // v9.14.3 删除目标二次确认
  const [delOpen, setDelOpen] = useState(false)
  const [progPctDraft, setProgPctDraft] = useState(goal.progress?.pct !== undefined ? String(goal.progress.pct) : '')
  const [progNoteDraft, setProgNoteDraft] = useState(goal.progress?.note ?? '')
  const [stageSheet, setStageSheet] = useState<null | 'new' | StageRecord>(null)
  const [subtaskSheet, setSubtaskSheet] = useState(false)
  // v9.14 移动到文件夹（详情页唯一新增入口；其余结构保持原样）
  const [moveSheet, setMoveSheet] = useState(false)
  // v8.5 双视图：阶段（时间维度）| 子任务（执行维度），各自进度独立
  const [viewMode, setViewMode] = useState<'stages' | 'subtasks'>('subtasks') // v8.7 默认子任务视图

  const saveNote = async (): Promise<void> => {
    const ok = await updateGoal(goal.id, { note: noteDraft.trim() })
    if (ok) setNoteEdit(false)
  }

  const saveProg = async (): Promise<void> => {
    const { p, err: e } = draftToProgress(progPctDraft, progNoteDraft)
    if (e) {
      showToast(e)
      return
    }
    const origPct = goal.progress?.pct
    const origNote = goal.progress?.note ?? ''
    if ((p?.pct ?? undefined) !== origPct || (p?.note ?? '') !== origNote) {
      const ok = await updateGoal(goal.id, { progress: p })
      if (!ok) return
    }
    setProgEdit(false)
  }

  const removeGoal = (): void => {
    // v9.14.3 删除目标二次确认（连带删除全部阶段/子任务由 repo 单事务保证）
    setDelOpen(true)
  }

  const removeStage = (s: StageRecord): void => {
    void deleteStage(s.id)
  }

  const removeSubtask = (st: SubtaskRecord): void => {
    void deleteSubtask(st.id)
  }

  const doneSubtaskCount = subtasks.filter((x) => x.done).length

  // v8.60 已完成子任务沉底：未完成在前（原顺序）、已完成沉底（稳定排序保持彼此原顺序）
  const sortedSubtasks = useMemo(
    () => [...subtasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0)),
    [subtasks],
  )

  return (
    <div className={styles.detail}>
      <div className={styles.detailBar}>
        <button className={styles.back} onClick={closeGoal} aria-label="返回目标列表" title="返回">
          ←
        </button>
        <span className={styles.detailTitle}>{goal.title}</span>
        <button
          className={goal.done ? `${styles.doneGoalBtn} ${styles.doneGoalBtnOn}` : styles.doneGoalBtn}
          onClick={() => void setGoalDone(goal.id, !goal.done)}
          aria-label={goal.done ? '恢复进行中' : '标记完成'}
        >
          {goal.done ? '恢复进行中' : '标记完成'}
        </button>
        {/* v9.14 移动到文件夹：详情页唯一新增入口 */}
        <button className={styles.moveGoalBtn} onClick={() => setMoveSheet(true)} aria-label="移动到文件夹">
          移动到文件夹
        </button>
        <button className={styles.deleteGoal} onClick={removeGoal} aria-label="删除目标" title="删除目标">
          删除
        </button>
      </div>
      {moveSheet && <MoveGoalSheet goal={goal} onClose={() => setMoveSheet(false)} />}
      {delOpen && (
        <DeleteGoalConfirm goal={goal} onClose={() => setDelOpen(false)} onDeleted={closeGoal} />
      )}

      {/* 目标阐述：详情页顶部主展示 */}
      <div className={styles.noteBox}>
        <div className={styles.noteTag}>
          目标阐述
          {!noteEdit && (
            <button onClick={() => {
              setNoteDraft(goal.note)
              setNoteEdit(true)
            }}>
              编辑
            </button>
          )}
        </div>
        {!noteEdit ? (
          goal.note ? (
            <p>{goal.note}</p>
          ) : (
            <p className={styles.noteEmpty}>还没有写阐述。点「编辑」写下这个阶段想做什么、为什么做、怎么衡量。</p>
          )
        ) : (
          <div className={styles.noteEdit}>
            <textarea
              value={noteDraft}
              maxLength={5000}
              autoFocus
              onChange={(e) => setNoteDraft(e.target.value)}
            />
            <div className={styles.noteActions}>
              <button className={styles.btnGhost} onClick={() => setNoteEdit(false)}>取消</button>
              <button className={styles.btnPrimary} onClick={() => void saveNote()}>保存</button>
            </div>
          </div>
        )}

        {/* v8.10 目标层级当前进度：与阐述同级（阐述上、进度下），独立手填，不自动聚合 */}
        <div className={styles.progTag}>
          当前进度
          {!progEdit && (
            <button
              onClick={() => {
                setProgPctDraft(goal.progress?.pct !== undefined ? String(goal.progress.pct) : '')
                setProgNoteDraft(goal.progress?.note ?? '')
                setProgEdit(true)
              }}
            >
              编辑
            </button>
          )}
        </div>
        {!progEdit ? (
          goal.progress && (goal.progress.pct !== undefined || goal.progress.note) ? (
            <p>
              {goal.progress.pct !== undefined && <span className={styles.goalPct}>{goal.progress.pct}%</span>}
              {goal.progress.pct !== undefined && goal.progress.note && <span className={styles.progSep}> · </span>}
              {goal.progress.note}
            </p>
          ) : (
            <p className={styles.noteEmpty}>还没有写当前进度。点「编辑」记录现在做到哪一步。</p>
          )
        ) : (
          <div className={styles.progEdit}>
            <div className={styles.progEditRow}>
              <input
                className={styles.progPctInput}
                type="text"
                inputMode="numeric"
                value={progPctDraft}
                placeholder="0-100"
                maxLength={3}
                onChange={(e) => setProgPctDraft(e.target.value)}
              />
              <span className={styles.progPctSuffix}>%</span>
            </div>
            <textarea
              value={progNoteDraft}
              maxLength={200}
              rows={2}
              placeholder="进度描述（可空）"
              onChange={(e) => setProgNoteDraft(e.target.value)}
            />
            <div className={styles.noteActions}>
              <button className={styles.btnGhost} onClick={() => setProgEdit(false)}>取消</button>
              <button className={styles.btnPrimary} onClick={() => void saveProg()}>保存</button>
            </div>
          </div>
        )}
      </div>

      {/* v8.5 双视图切换：阐述之下、列表上方 */}
      <div className={styles.seg} role="tablist" aria-label="目标视图">
        <button
          role="tab"
          aria-selected={viewMode === 'subtasks'}
          className={viewMode === 'subtasks' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
          onClick={() => setViewMode('subtasks')}
        >
          子任务
        </button>
        <button
          role="tab"
          aria-selected={viewMode === 'stages'}
          className={viewMode === 'stages' ? `${styles.segBtn} ${styles.segOn}` : styles.segBtn}
          onClick={() => setViewMode('stages')}
        >
          阶段
        </button>
      </div>

      {viewMode === 'stages' ? (
        <>
          {/* 阶段列表（时间维度，现状不变） */}
          <div className={styles.stageTitle}>
            阶段列表
            <button
              className={styles.addStageBtn}
              onClick={() => setStageSheet('new')}
            >
              ＋ 添加阶段
            </button>
          </div>

          {stages.length === 0 ? (
            <div className={styles.stageEmpty}>
              还没有阶段。添加第一个阶段（自动设为「当前」），再按阶段推进。
            </div>
          ) : (
            stages.map((s) => (
              <StageRow
                key={s.id}
                stage={s}
                onEdit={(rec) => setStageSheet(rec)}
                onDelete={removeStage}
              />
            ))
          )}
        </>
      ) : (
        <>
          {/* 子任务列表（执行维度，v8.5） */}
          <div className={styles.stageTitle}>
            <span>子任务</span>
            {subtasks.length > 0 && (
              <span className={styles.subProgress}>已完成 {doneSubtaskCount}/{subtasks.length}</span>
            )}
            <button
              className={styles.addStageBtn}
              onClick={() => setSubtaskSheet(true)}
            >
              ＋ 添加子任务
            </button>
          </div>

          {subtasks.length === 0 ? (
            <div className={styles.stageEmpty}>
              还没有子任务。把要做的事拆成一条条子任务，逐条勾选完成。
            </div>
          ) : (
            sortedSubtasks.map((st) => (
              <SubtaskRow key={st.id} subtask={st} onDelete={removeSubtask} />
            ))
          )}
        </>
      )}

      {stageSheet !== null && (
        <StageSheet
          editing={stageSheet === 'new' ? null : stageSheet}
          onClose={() => setStageSheet(null)}
        />
      )}
      {subtaskSheet && (
        <SubtaskSheet goalId={goal.id} onClose={() => setSubtaskSheet(false)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 目标列表页
// ---------------------------------------------------------------------------

function GoalList(): JSX.Element {
  const goalList = useApp((s) => s.goalList)
  const folderList = useApp((s) => s.folderList)
  const openGoal = useApp((s) => s.openGoal)
  const setGoalDone = useApp((s) => s.setGoalDone)
  const toggleGoalFavorite = useApp((s) => s.toggleGoalFavorite)
  const setFolderCollapsed = useApp((s) => s.setFolderCollapsed)
  const [newOpen, setNewOpen] = useState(false)
  // v9.14.3 新建目标预设文件夹：分组视图每组按钮携带自身文件夹；空态/其他 = null
  const [newGoalFolder, setNewGoalFolder] = useState<string | null>(null)
  // v9.14.3 全部视图「未分类」组折叠（localStorage 持久化，与文件夹 collapsed 同语义）
  const [uncatCollapsed, setUncatCollapsedState] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(UNCAT_COLLAPSED_KEY) === '1',
  )
  const setUncatCollapsed = (v: boolean): void => {
    setUncatCollapsedState(v)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(UNCAT_COLLAPSED_KEY, v ? '1' : '0')
    }
  }
  // v9.14 文件夹区：'all' = 平铺（保持原样两组）；folderId = 只看该文件夹（组头可折叠，持久化）
  const [filter, setFilter] = useState<string | 'all'>('all')
  const [folderSheet, setFolderSheet] = useState(false)
  const [menuFor, setMenuFor] = useState<FolderSummary | null>(null)

  // v7.9 补：进行中的在前（aggregate 已排序），已完成的沉底成组
  const active = goalList.filter((x) => !x.goal.done)
  const done = goalList.filter((x) => x.goal.done)

  // v9.14 卡片所属文件夹小标签（folderId 归一化已由 aggregate 完成：无效/已删 → null）
  const folderNameOf = (folderId?: string): string | null => {
    if (!folderId) return null
    const f = folderList.find((x) => x.folder.id === folderId)
    return f ? f.folder.name : null
  }

  // v9.14.3 卡片列表（空态 + 卡片行）：renderGroup 与分组视图组内共用
  const renderCards = (items: typeof goalList, doneGroup: boolean, hideFolderTag = false): JSX.Element => (
    <>
      {items.length === 0 && (
        doneGroup ? (
          <div className={styles.groupEmpty}>还没有已完成的目标</div>
        ) : (
          <div className={styles.empty}>
            <span className={styles.emptyBig}>◎</span>
            还没有目标
            <br />
            点右上角「＋ 新建目标」创建一个阶段性目标
          </div>
        )
      )}

      {items.map(({ goal, stageCount, subtaskCount, current, activeDays }) => (
        <div
          key={goal.id}
          className={goal.done ? `${styles.card} ${styles.cardDone}` : styles.card}
          role="button"
          tabIndex={0}
          onClick={() => void openGoal(goal.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void openGoal(goal.id)
          }}
        >
          <h2>
            {goal.title}
            {goal.done && (
              <span className={`${styles.badge} ${styles.badgeDone}`}>已完成</span>
            )}
            {!goal.done && current && (
              <span className={`${styles.badge} ${styles.badgeCur}`}>
                当前 · {current.title}
              </span>
            )}
            <span className={styles.daysTag}>
              已进行 <b>{activeDays}</b> 天
            </span>
          </h2>
          <div className={styles.meta}>
            {/* v9.14 所属文件夹小标签（未分类不显示；分组视图/文件夹视图由组头标明归属 → 隐藏） */}
            {!hideFolderTag && folderNameOf(goal.folderId) && (
              <span className={styles.folderTag}>{folderNameOf(goal.folderId)}</span>
            )}
            <span>进度</span>
            <span className={styles.pct}>
              {current?.pct !== undefined ? `${current.pct}%` : '—'}
            </span>
            <span>· {subtaskCount} 个子任务 · {stageCount} 个阶段</span>
            <button
              className={goal.favorite ? `${styles.cardStar} ${styles.cardStarOn}` : styles.cardStar}
              aria-label={goal.favorite ? `取消收藏：${goal.title}` : `收藏：${goal.title}`}
              onClick={(e) => {
                e.stopPropagation()
                void toggleGoalFavorite(goal.id)
              }}
            >
              {goal.favorite ? '★' : '☆'}
            </button>
            <button
              className={styles.cardDoneBtn}
              aria-label={goal.done ? `恢复进行中：${goal.title}` : `标记完成：${goal.title}`}
              onClick={(e) => {
                e.stopPropagation()
                void setGoalDone(goal.id, !goal.done)
              }}
            >
              {goal.done ? '恢复进行中' : '标记完成'}
            </button>
          </div>
          {goal.note && <p className={styles.summary}>{goal.note}</p>}
        </div>
      ))}
    </>
  )

  const renderGroup = (
    title: string,
    items: typeof goalList,
    doneGroup: boolean,
    defaultFolder?: string | null,
    hideFolderTag?: boolean,
  ): JSX.Element => (
    <section key={title}>
      <div className={styles.listHead}>
        <span className={styles.listTitle}>
          {title}（{items.length}）
        </span>
        {!doneGroup && (
          <button
            className={styles.newGoalBtn}
            onClick={() => {
              setNewGoalFolder(defaultFolder ?? null)
              setNewOpen(true)
            }}
          >
            ＋ 新建目标
          </button>
        )}
      </div>
      {renderCards(items, doneGroup, hideFolderTag)}
    </section>
  )

  // v9.14 文件夹过滤视图：组头（折叠箭头 + 名字 + N + ···菜单），折叠状态持久化
  const renderFolderView = (): JSX.Element | null => {
    const fs = folderList.find((x) => x.folder.id === filter)
    if (!fs) return null
    const items = goalList.filter((x) => x.goal.folderId === fs.folder.id)
    const collapsed = fs.folder.collapsed ?? false
    return (
      <section>
        <div className={`${styles.folderGroupHead} ${collapsed ? styles.folderGroupHeadCollapsed : ''}`}>
          <button
            className={styles.folderCollapse}
            aria-label={collapsed ? '展开文件夹' : '折叠文件夹'}
            onClick={() => void setFolderCollapsed(fs.folder.id, !collapsed)}
          >
            {collapsed ? '▸' : '▾'}
          </button>
          <span className={styles.folderGroupTitle}>
            {fs.folder.favorite ? '★ ' : ''}{fs.folder.name}（{items.length}）
          </span>
          <button className={styles.folderGroupMenu} aria-label="文件夹菜单" onClick={() => setMenuFor(fs)}>
            ···
          </button>
        </div>
        {collapsed ? null : items.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyBig}>◎</span>
            这个文件夹还没有目标
            <br />
            <button className={styles.newGoalBtn} onClick={() => setNewOpen(true)}>
              ＋ 新建目标
            </button>
            <span className={styles.emptyHint}>自动归入此文件夹，或在详情页移动进来</span>
          </div>
        ) : (
          renderGroup('文件夹中的目标', items, false, null, true)
        )}
      </section>
    )
  }

  // v9.14.3 全部视图按文件夹分组：文件夹组（收藏置顶 → 创建时间）+ 未分类组沉底；每组可折叠
  // 组内沿用「进行中在上、已完成沉底」（aggregate 排序）；分组视图隐藏卡片文件夹小标签（组头已标明）
  const renderGroupedAll = (): JSX.Element => {
    const uncategorized = goalList.filter((x) => !x.goal.folderId)
    const groupedFolders = folderList.filter((f) =>
      goalList.some((x) => x.goal.folderId === f.folder.id),
    )
    if (groupedFolders.length === 0 && uncategorized.length === 0) {
      // 全部为空：沿用原「进行中（0）」空态提示
      return renderGroup('进行中的目标', [], false)
    }
    return (
      <>
        {groupedFolders.map(({ folder }) => {
          const items = goalList.filter((x) => x.goal.folderId === folder.id)
          const collapsed = folder.collapsed ?? false
          return (
            <section key={folder.id}>
              <div className={`${styles.folderGroupHead} ${collapsed ? styles.folderGroupHeadCollapsed : ''}`}>
                <button
                  className={styles.folderCollapse}
                  aria-label={collapsed ? '展开文件夹' : '折叠文件夹'}
                  onClick={() => void setFolderCollapsed(folder.id, !collapsed)}
                >
                  {collapsed ? '▸' : '▾'}
                </button>
                <span className={styles.folderGroupTitle}>
                  {folder.favorite ? '★ ' : ''}{folder.name}（{items.length}）
                </span>
                <button
                  className={styles.newGoalBtn}
                  onClick={() => {
                    setNewGoalFolder(folder.id)
                    setNewOpen(true)
                  }}
                >
                  ＋ 新建目标
                </button>
              </div>
              {collapsed ? null : renderCards(items, false, true)}
            </section>
          )
        })}
        {uncategorized.length > 0 && (
          <section>
            <div className={`${styles.folderGroupHead} ${uncatCollapsed ? styles.folderGroupHeadCollapsed : ''}`}>
              <button
                className={styles.folderCollapse}
                aria-label={uncatCollapsed ? '展开未分类' : '折叠未分类'}
                onClick={() => setUncatCollapsed(!uncatCollapsed)}
              >
                {uncatCollapsed ? '▸' : '▾'}
              </button>
              <span className={styles.folderGroupTitle}>未分类（{uncategorized.length}）</span>
              <button
                className={styles.newGoalBtn}
                onClick={() => {
                  setNewGoalFolder(null)
                  setNewOpen(true)
                }}
              >
                ＋ 新建目标
              </button>
            </div>
            {uncatCollapsed ? null : renderCards(uncategorized, false, true)}
          </section>
        )}
      </>
    )
  }

  // v9.14 文件夹 chips 区（无文件夹时不显示，老用户界面零变化）
  const folderBar = folderList.length > 0 ? (
    <div className={styles.folderBar}>
      <button
        className={filter === 'all' ? `${styles.folderChip} ${styles.folderChipOn}` : styles.folderChip}
        onClick={() => setFilter('all')}
      >
        全部
      </button>
      {folderList.map(({ folder, count }) => (
        <button
          key={folder.id}
          className={filter === folder.id ? `${styles.folderChip} ${styles.folderChipOn}` : styles.folderChip}
          onClick={() => setFilter(folder.id)}
        >
          {folder.favorite ? '★ ' : ''}{folder.name} {count}
        </button>
      ))}
      <button className={styles.folderNew} onClick={() => setFolderSheet(true)}>
        ＋ 新建文件夹
      </button>
    </div>
  ) : (
    <div className={styles.folderBar}>
      <button className={styles.folderNew} onClick={() => setFolderSheet(true)}>
        ＋ 新建文件夹
      </button>
    </div>
  )

  return (
    <div className={styles.list}>
      {folderBar}
      {filter === 'all' ? (
        folderList.length === 0 ? (
          <>
            {renderGroup('进行中的目标', active, false)}
            {done.length > 0 && renderGroup('已完成的目标', done, true)}
          </>
        ) : (
          renderGroupedAll()
        )
      ) : (
        renderFolderView()
      )}
      {newOpen && (
        <NewGoalSheet
          defaultFolderId={newGoalFolder ?? (filter !== 'all' ? filter : null)}
          onClose={() => {
            setNewGoalFolder(null)
            setNewOpen(false)
          }}
        />
      )}
      {folderSheet && <NewFolderSheet onClose={() => setFolderSheet(false)} />}
      {menuFor && (
        <FolderMenuSheet folder={menuFor} onClose={() => setMenuFor(null)} onDeleted={() => setFilter('all')} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 入口：详情 or 列表
// ---------------------------------------------------------------------------

export function GoalsView(): JSX.Element {
  const goalDetail = useApp((s) => s.goalDetail)
  return goalDetail ? (
    <GoalDetail goal={goalDetail.goal} stages={goalDetail.stages} subtasks={goalDetail.subtasks} />
  ) : (
    <GoalList />
  )
}
