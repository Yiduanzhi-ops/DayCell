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
import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { DateKey, FolderSummary, GoalRecord, StageRecord, SubtaskRecord } from '@core'
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
  lockFolder = false,
  onClose,
}: {
  defaultFolderId?: string | null
  /** v9.41 文件夹菜单「添加目标」进入：归属文件夹固定，表单内不可改 */
  lockFolder?: boolean
  onClose: () => void
}): JSX.Element {
  const createGoal = useApp((s) => s.createGoal)
  const folderList = useApp((s) => s.folderList)
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
      {/* v9.14 放入文件夹：不选 = 未分类；v9.41 文件夹菜单进入时锁定归属，不给切换 */}
      {lockFolder ? (
        <div className={styles.field}>
          <label>归属文件夹</label>
          <div className={styles.hint}>
            将归入「{folderList.find((x) => x.folder.id === folderId)?.folder.name ?? ''}」，创建后可在详情页移动
          </div>
        </div>
      ) : (
        <div className={styles.field}>
          <label>放入文件夹（可选）</label>
          <FolderPick value={folderId} onChange={setFolderId} />
        </div>
      )}
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
// v8.87 重命名文件夹（菜单入口；名称校验与新建同口径：必填、≤12 字）
// ---------------------------------------------------------------------------

function RenameFolderSheet({
  folder,
  onClose,
  onAliased,
}: {
  folder: FolderSummary
  onClose: () => void
  onAliased?: () => void
}): JSX.Element {
  const renameFolder = useApp((s) => s.renameFolder)
  const [name, setName] = useState(folder.folder.name)

  const submit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === folder.folder.name) return
    const ok = await renameFolder(folder.folder.id, trimmed)
    if (ok) {
      onAliased?.()
      onClose()
    }
  }

  return (
    <Sheet title="重命名文件夹" onCancel={onClose}>
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
        <div className={styles.hint}>改名只影响显示名称，里面的目标不受影响。</div>
      </div>
      <div className={styles.act}>
        <button className={styles.btnSoft} onClick={onClose}>取消</button>
        <button
          className={styles.btnPrimary}
          disabled={!name.trim() || name.trim() === folder.folder.name}
          onClick={() => void submit()}
        >
          保存
        </button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.14 文件夹组头菜单（重命名、收藏/取消收藏、删除）
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
  const [renameOpen, setRenameOpen] = useState(false)
  // v9.41 菜单里直接给这个文件夹加目标（归属锁定为本文件夹）
  const [addGoalOpen, setAddGoalOpen] = useState(false)
  const fav = folder.folder.favorite ?? false
  if (addGoalOpen) {
    return <NewGoalSheet defaultFolderId={folder.folder.id} lockFolder onClose={onClose} />
  }
  return (
    <Sheet title={folder.folder.name} onCancel={onClose}>
      <div className={styles.menuList}>
        <button className={styles.menuItem} onClick={() => setAddGoalOpen(true)}>
          <span className={styles.menuIcon}>＋</span>
          添加目标
        </button>
        <button className={styles.menuItem} onClick={() => setRenameOpen(true)}>
          <span className={styles.menuIcon}>✎</span>
          重命名文件夹
        </button>
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
      {renameOpen && <RenameFolderSheet folder={folder} onClose={onClose} />}
      {confirmDel && <DeleteFolderConfirm folder={folder} onClose={onClose} onDeleted={onDeleted} />}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// v9.46 阶段 / 子任务渲染（按《阶段与待办联动原型》）
// 阶段只存名称；「第N阶段 · 」由位置推导，读到旧前缀时剥离
// ---------------------------------------------------------------------------

const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const LEGACY_STAGE_PREFIX = /^第[一二三四五六七八九十百0-9]+阶段\s*[·:：-]\s*/

function stagePrefix(index: number): string {
  const n = index + 1
  const cn = n <= 10 ? CN_NUM[n - 1] : n <= 99 ? `${CN_NUM[Math.floor(n / 10) - 1]}十${n % 10 ? CN_NUM[n % 10 - 1] : ''}` : String(n)
  return `第${cn}阶段 · `
}

function cleanStageTitle(title: string): string {
  return title.replace(LEGACY_STAGE_PREFIX, '').trim()
}

function stageDisplayTitle(title: string, index: number): string {
  return `${stagePrefix(index)}${cleanStageTitle(title)}`
}

/** 从编辑框提交的完整名称里剥掉序号前缀，只把用户名称写入 stage.title */
function stageTitleFromInput(value: string, index: number): string {
  const prefix = stagePrefix(index)
  let v = value.trim()
  if (v.startsWith(prefix)) v = v.slice(prefix.length).trim()
  v = cleanStageTitle(v)
  return v
}

function fmtMD(key?: string | null): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return ''
  return `${key.slice(5, 7)}/${key.slice(8, 10)}`
}

function fmtTs(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/** 子任务副行：打卡 N 天 [· MM/DD 完成 | · 已在今天] */
function subtaskMeta(st: SubtaskRecord, inToday: boolean): string {
  const days = Array.isArray(st.workDates) ? st.workDates.length : 0
  const doneAt = st.done ? ` · ${fmtTs(st.updatedAt)} 完成` : inToday ? ' · 已在今天' : ''
  return `打卡 ${days} 天${doneAt}`
}

function StageCheck({ done }: { done: boolean }): JSX.Element {
  return <span className={done ? `${styles.taskCheck} ${styles.taskCheckOn}` : styles.taskCheck} aria-hidden="true" />
}

function Chevron({ open }: { open: boolean }): JSX.Element {
  return (
    <span className={open ? `${styles.stageChev} ${styles.stageChevOpen}` : styles.stageChev} aria-hidden="true">
      <svg viewBox="0 0 12 12" width="12" height="12">
        <path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function SubtaskRow({
  subtask,
  editing,
  stageDone,
  onDelete,
}: {
  subtask: SubtaskRecord
  editing: boolean
  stageDone: boolean
  onDelete: (st: SubtaskRecord) => void
}): JSX.Element {
  const setSubtaskDoneWithToday = useApp((s) => s.setSubtaskDoneWithToday)
  const updateSubtask = useApp((s) => s.updateSubtask)
  const addSubtaskToToday = useApp((s) => s.addSubtaskToToday)
  const removeSubtaskFromToday = useApp((s) => s.removeSubtaskFromToday)
  const subtaskTodayIds = useApp((s) => s.subtaskTodayIds)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(subtask.title)
  const lock = useRef(false)

  const inToday = subtaskTodayIds.includes(subtask.id)

  const commitRename = (): void => {
    if (lock.current) return
    const nextTitle = draft.trim()
    setRenaming(false)
    if (!nextTitle || nextTitle === subtask.title) return
    lock.current = true
    void updateSubtask(subtask.id, { title: nextTitle }).finally(() => {
      lock.current = false
    })
  }

  return (
    <div className={styles.taskRow}>
      {editing || stageDone ? (
        <StageCheck done={subtask.done} />
      ) : (
        <button
          type="button"
          className={subtask.done ? `${styles.taskCheck} ${styles.taskCheckOn}` : styles.taskCheck}
          role="checkbox"
          aria-checked={subtask.done}
          aria-label={subtask.done ? `取消完成：${subtask.title}` : `标记完成：${subtask.title}`}
          onClick={() => void setSubtaskDoneWithToday(subtask.id, !subtask.done)}
        />
      )}
      <div className={styles.taskBody}>
        {editing ? (
          renaming ? (
            <input
              className={styles.taskInput}
              value={draft}
              maxLength={50}
              autoFocus
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitRename()
                }
                if (e.key === 'Escape') {
                  setDraft(subtask.title)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={subtask.done ? `${styles.taskTitleEdit} ${styles.taskTitleDone}` : styles.taskTitleEdit}
              onClick={() => {
                setDraft(subtask.title)
                setRenaming(true)
              }}
            >
              {subtask.title}
            </button>
          )
        ) : (
          <div className={subtask.done ? `${styles.taskTitle} ${styles.taskTitleDone}` : styles.taskTitle}>
            {subtask.title}
          </div>
        )}
        <div className={styles.taskMeta}>{subtaskMeta(subtask, inToday && !subtask.done)}</div>
      </div>
      {editing ? (
        <button
          type="button"
          className={styles.taskDel}
          aria-label={`删除子任务：${subtask.title}`}
          title="删除"
          onClick={() => onDelete(subtask)}
        >
          ✕
        </button>
      ) : stageDone ? null : subtask.done ? (
        <span className={styles.todayBtnDim}>已做</span>
      ) : inToday ? (
        <button type="button" className={`${styles.todayBtn} ${styles.todayBtnUndo}`} onClick={() => void removeSubtaskFromToday(subtask.id)}>
          - 每日待办
        </button>
      ) : (
        <button type="button" className={styles.todayBtn} onClick={() => void addSubtaskToToday(subtask.id)}>
          ＋每日待办
        </button>
      )}
    </div>
  )
}

function StageCard({
  stage,
  index,
  items,
  editing,
  open,
  subFormOpen,
  showFinish,
  onToggle,
  onAddSub,
  onCancelSub,
  onSubmitSub,
  onDeleteSub,
  onDeleteStage,
  onRenameStage,
  onFinish,
  onLater,
}: {
  /** null = 不分阶段 */
  stage: StageRecord | null
  index: number
  items: SubtaskRecord[]
  editing: boolean
  open: boolean
  subFormOpen: boolean
  showFinish: boolean
  onToggle: () => void
  onAddSub: () => void
  onCancelSub: () => void
  onSubmitSub: (title: string) => void
  onDeleteSub: (st: SubtaskRecord) => void
  onDeleteStage: (stage: StageRecord, index: number) => void
  onRenameStage: (stage: StageRecord, index: number, fullTitle: string) => void
  onFinish: (stage: StageRecord) => void
  onLater: (stage: StageRecord) => void
}): JSX.Element {
  const [subName, setSubName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(stage ? stageDisplayTitle(stage.title, index) : '')
  const renameLock = useRef(false)

  const loose = stage === null
  const done = stage?.done ?? false
  const isCurrent = stage?.isCurrent ?? false
  const doneCount = items.filter((x) => x.done).length
  const total = items.length
  const display = loose ? '不分阶段' : stageDisplayTitle(stage.title, index)

  const commitStageRename = (): void => {
    if (!stage || renameLock.current) return
    const nextTitle = stageTitleFromInput(nameDraft, index)
    setRenaming(false)
    if (!nextTitle || nextTitle === cleanStageTitle(stage.title)) return
    renameLock.current = true
    onRenameStage(stage, index, nextTitle)
    renameLock.current = false
  }

  const headCls = [
    styles.stageCardHead,
    isCurrent ? styles.stageCardHeadCur : '',
    done ? styles.stageCardHeadDone : '',
  ].join(' ')

  return (
    <div className={[styles.stageCard, isCurrent ? styles.stageCardCur : ''].join(' ')}>
      <div
        className={headCls}
        onClick={editing || (!loose && !total) || (!loose && done && !total) ? undefined : onToggle}
      >
        {editing && stage && renaming ? (
          <input
            className={styles.stageNameInput}
            value={nameDraft}
            maxLength={60}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitStageRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitStageRename()
              }
              if (e.key === 'Escape') {
                setNameDraft(stageDisplayTitle(stage.title, index))
                setRenaming(false)
              }
            }}
          />
        ) : editing && stage ? (
          <button
            type="button"
            className={styles.stageTitleButton}
            onClick={() => {
              setNameDraft(stageDisplayTitle(stage.title, index))
              setRenaming(true)
            }}
          >
            {display}
          </button>
        ) : (
          <span className={styles.stageName}>{display}</span>
        )}

        {done && (
          <span className={styles.stageDoneOn}>完成于 {stage?.doneOn ? fmtMD(stage.doneOn) : stage ? fmtTs(stage.updatedAt) : ''}</span>
        )}
        {!done && !loose && <span className={isCurrent ? `${styles.stageBadge} ${styles.stageBadgeCur}` : styles.stageBadge}>{isCurrent ? '进行中' : '未开始'}</span>}

        {editing && stage ? (
          <span className={styles.stageEdits}>
            <button type="button" className={styles.stageMiniOp} onClick={() => {
              setNameDraft(stageDisplayTitle(stage.title, index))
              setRenaming(true)
            }}>
              改名
            </button>
            <button type="button" className={`${styles.stageMiniOp} ${styles.stageMiniOpDanger}`} onClick={() => onDeleteStage(stage, index)}>
              删除
            </button>
          </span>
        ) : editing && loose ? null : (
          <>
            {done ? (
              <span className={styles.stageCount}>{doneCount}/{total}</span>
            ) : (
              <button
                type="button"
                className={styles.addSubInline}
                onClick={(e) => {
                  e.stopPropagation()
                  onAddSub()
                }}
              >
                <span className={styles.bracket}>「</span>＋子任务<span className={styles.bracket}>」</span>
              </button>
            )}
            {total > 0 && (
              <button
                type="button"
                className={styles.stageChevBtn}
                aria-label={open ? '收起' : '展开'}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle()
                }}
              >
                <Chevron open={open} />
              </button>
            )}
          </>
        )}
      </div>

      {(editing || open) && (
        <>
          {items.map((st) => (
            <SubtaskRow key={st.id} subtask={st} editing={editing} stageDone={done} onDelete={onDeleteSub} />
          ))}
          {!editing && subFormOpen && (
            <div className={styles.subForm}>
              <input
                className={styles.subInput}
                value={subName}
                maxLength={50}
                autoFocus
                placeholder={loose ? '还没想好放哪一段？' : '这一阶段要做的下一件事'}
                onChange={(e) => setSubName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onSubmitSub(subName)
                    setSubName('')
                  }
                  if (e.key === 'Escape') onCancelSub()
                }}
              />
              <button
                type="button"
                className={styles.subSubmit}
                onClick={() => {
                  onSubmitSub(subName)
                  setSubName('')
                }}
              >
                添加
              </button>
              <button type="button" className={styles.subCancel} onClick={onCancelSub}>取消</button>
            </div>
          )}
          {showFinish && stage && (
            <div className={styles.finishBox}>
              <p>这一段的事都做完了，要标完成并进入下一段吗？</p>
              <div className={styles.finishRow}>
                <button type="button" className={styles.finishBtn} onClick={() => onFinish(stage)}>标完成，进入下一段</button>
                <button type="button" className={styles.finishLater} onClick={() => onLater(stage)}>先留着</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// v9.46 目标级「…」操作 Sheet：一个 Sheet 三视图
// ---------------------------------------------------------------------------

function GoalActionSheet({
  goal,
  onClose,
  onDeleted,
}: {
  goal: GoalRecord
  onClose: () => void
  onDeleted: () => void
}): JSX.Element {
  const folderList = useApp((s) => s.folderList)
  const setGoalDone = useApp((s) => s.setGoalDone)
  const moveGoalToFolder = useApp((s) => s.moveGoalToFolder)
  const deleteGoal = useApp((s) => s.deleteGoal)
  const [view, setView] = useState<'actions' | 'folder' | 'delete'>('actions')

  return (
    <div
      className={styles.goalSheetLayer}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.goalSheet} role="dialog" aria-label={view === 'delete' ? '删除目标' : view === 'folder' ? '移动到文件夹' : '目标操作'}>
        <div className={styles.goalSheetGrab} />
        {view === 'actions' && (
          <>
            <div className={styles.goalSheetTitle}>目标操作</div>
            <button
              type="button"
              className={styles.goalSheetRow}
              onClick={() => {
                onClose()
                void setGoalDone(goal.id, !goal.done)
              }}
            >
              {goal.done ? '恢复进行中' : '标记完成'}
            </button>
            <button type="button" className={styles.goalSheetRow} onClick={() => setView('folder')}>
              移动到文件夹
            </button>
            <button type="button" className={`${styles.goalSheetRow} ${styles.goalSheetDanger}`} onClick={() => setView('delete')}>
              删除目标
            </button>
            <button type="button" className={`${styles.goalSheetRow} ${styles.goalSheetCancel}`} onClick={onClose}>
              取消
            </button>
          </>
        )}

        {view === 'folder' && (
          <>
            <div className={styles.goalSheetTitle}>移动到文件夹</div>
            <button
              type="button"
              className={`${styles.goalSheetRow} ${styles.goalSheetOpt}`}
              onClick={() => {
                onClose()
                void moveGoalToFolder(goal.id, null)
              }}
            >
              <span>未分类</span>
              {!goal.folderId && <span className={styles.goalSheetTick}>✓</span>}
            </button>
            {folderList.map(({ folder }) => (
              <button
                type="button"
                key={folder.id}
                className={`${styles.goalSheetRow} ${styles.goalSheetOpt}`}
                onClick={() => {
                  onClose()
                  void moveGoalToFolder(goal.id, folder.id)
                }}
              >
                <span>{folder.name}</span>
                {goal.folderId === folder.id && <span className={styles.goalSheetTick}>✓</span>}
              </button>
            ))}
            <button type="button" className={`${styles.goalSheetRow} ${styles.goalSheetCancel}`} onClick={onClose}>
              取消
            </button>
          </>
        )}

        {view === 'delete' && (
          <>
            <div className={styles.goalSheetTitle}>删除目标</div>
            <p className={styles.goalSheetText}>
              删除「{goal.title}」将同时删除它的全部阶段与子任务，此操作不可恢复。
            </p>
            <div className={styles.goalSheetBtns}>
              <button type="button" className={styles.goalSheetBtn} onClick={onClose}>取消</button>
              <button
                type="button"
                className={`${styles.goalSheetBtn} ${styles.goalSheetBtnDanger}`}
                onClick={() => {
                  onClose()
                  void deleteGoal(goal.id).then((ok) => {
                    if (ok) onDeleted()
                  })
                }}
              >
                删除目标
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 目标详情页（v9.46）：不分阶段 + 阶段列表、目标级操作层、编辑态
// ---------------------------------------------------------------------------

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
  const renameGoal = useApp((s) => s.renameGoal)
  const updateGoalRange = useApp((s) => s.updateGoalRange)
  const clearGoalRange = useApp((s) => s.clearGoalRange)
  const createStage = useApp((s) => s.createStage)
  const renameStage = useApp((s) => s.renameStage)
  const setStageDone = useApp((s) => s.setStageDone)
  const createSubtask = useApp((s) => s.createSubtask)
  const deleteSubtaskCascade = useApp((s) => s.deleteSubtaskCascade)
  const restoreSubtaskCascade = useApp((s) => s.restoreSubtaskCascade)
  const deleteStageCascade = useApp((s) => s.deleteStageCascade)
  const restoreStageCascade = useApp((s) => s.restoreStageCascade)
  const showToast = useApp((s) => s.showToast)

  const [editMode, setEditMode] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [renamingGoal, setRenamingGoal] = useState(false)
  const [goalNameDraft, setGoalNameDraft] = useState(goal.title)
  const goalRenameLock = useRef(false)

  const [rangeEditing, setRangeEditing] = useState(false)
  const [startDraft, setStartDraft] = useState(goal.startOn ?? '')
  const [endDraft, setEndDraft] = useState(goal.endOn ?? '')

  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const [laterStages, setLaterStages] = useState<string[]>([])
  const [subFormFor, setSubFormFor] = useState<string | null>(null)

  const [newStageOpen, setNewStageOpen] = useState(false)
  const [newStageName, setNewStageName] = useState('')

  const looseItems = useMemo(() => {
    const stageIds = new Set(stages.map((x) => x.id))
    return subtasks.filter((x) => !x.stageId || !stageIds.has(x.stageId))
  }, [stages, subtasks])

  const itemsOfStage = (stageId: string): SubtaskRecord[] => subtasks.filter((x) => x.stageId === stageId)

  const startGoalRename = (): void => {
    setGoalNameDraft(goal.title)
    setRenamingGoal(true)
  }

  const commitGoalRename = (): void => {
    if (goalRenameLock.current) return
    const nextTitle = goalNameDraft.trim()
    setRenamingGoal(false)
    if (!nextTitle || nextTitle === goal.title) return
    goalRenameLock.current = true
    void renameGoal(goal.id, nextTitle).finally(() => {
      goalRenameLock.current = false
    })
  }

  const toggleEdit = (): void => {
    if (renamingGoal) commitGoalRename()
    const next = !editMode
    setEditMode(next)
    setSubFormFor(null)
    setNewStageOpen(false)
    showToast(next ? '编辑模式：改名与删除立即生效' : '已退出编辑')
  }

  const saveRange = (): void => {
    setRangeEditing(false)
    void updateGoalRange(goal.id, startDraft ? (startDraft as DateKey) : null, endDraft ? (endDraft as DateKey) : null)
  }

  const clearRange = (): void => {
    setRangeEditing(false)
    setStartDraft('')
    setEndDraft('')
    void clearGoalRange(goal.id)
  }

  const submitNewStage = (): void => {
    const name = cleanStageTitle(newStageName)
    if (!name) {
      showToast('先给这一段起个名字')
      return
    }
    setNewStageName('')
    setNewStageOpen(false)
    void createStage({ goalId: goal.id, title: name })
  }

  const submitSubtask = (stageId: string | null, title: string): void => {
    const t = title.trim()
    if (!t) {
      showToast('先写清楚要做的事')
      return
    }
    setSubFormFor(null)
    void createSubtask({ goalId: goal.id, title: t, stageId })
  }

  const removeSubtask = (st: SubtaskRecord): void => {
    void deleteSubtaskCascade(st.id).then((snapshot) => {
      if (!snapshot) return
      showToast('已删除子任务', {
        label: '撤销',
        onClick: () => {
          void restoreSubtaskCascade(snapshot)
        },
      })
    })
  }

  const removeStage = (stage: StageRecord, index: number): void => {
    const display = stageDisplayTitle(stage.title, index)
    const moved = itemsOfStage(stage.id).length
    void deleteStageCascade(stage.id).then((snapshot) => {
      if (!snapshot) return
      showToast(moved > 0 ? `已删除「${display}」，${moved} 个子任务移入不分阶段` : `已删除「${display}」`, {
        label: '撤销',
        onClick: () => {
          void restoreStageCascade(snapshot)
        },
      })
    })
  }

  const finishStage = (stage: StageRecord): void => {
    void setStageDone(stage.id, true)
  }

  const titleDone = goal.done ? <span className={styles.goalDonePill}>已完成</span> : null

  return (
    <div className={styles.goalDetailPage}>
      <div className={styles.goalTopbar}>
        <button type="button" className={styles.goalBack} onClick={closeGoal} aria-label="返回目标列表">
          ‹ 目标
        </button>
        <div className={styles.goalTopActions}>
          <button type="button" className={styles.goalMoreBtn} onClick={() => setSheetOpen(true)} aria-label="目标操作" title="目标操作">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="19" cy="12" r="1.6" />
            </svg>
          </button>
          <button type="button" className={styles.goalEditToggle} onClick={toggleEdit}>
            {editMode ? '完成' : '编辑'}
          </button>
        </div>
      </div>

      {sheetOpen && (
        <GoalActionSheet
          goal={goal}
          onClose={() => setSheetOpen(false)}
          onDeleted={closeGoal}
        />
      )}

      <div className={styles.goalTitleLine}>
        {renamingGoal ? (
          <input
            className={styles.goalNameInput}
            value={goalNameDraft}
            maxLength={50}
            autoFocus
            autoComplete="off"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setGoalNameDraft(e.target.value)}
            onBlur={commitGoalRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitGoalRename()
              }
              if (e.key === 'Escape') {
                setGoalNameDraft(goal.title)
                setRenamingGoal(false)
              }
            }}
          />
        ) : editMode ? (
          <button type="button" className={styles.goalTitleBtn} onClick={startGoalRename} aria-label={`重命名目标：${goal.title}`}>
            {goal.title}
            <span className={styles.titlePencil} aria-hidden="true">✎</span>
          </button>
        ) : (
          <span className={styles.goalTitleText}>{goal.title}</span>
        )}
        {!renamingGoal && titleDone}
      </div>

      <div className={styles.goalRange}>
        {rangeEditing ? (
          <div className={styles.goalRangeForm}>
            <input type="date" value={startDraft} onChange={(e) => setStartDraft(e.target.value)} aria-label="开始日期" />
            <span className={styles.goalRangeDash}>至</span>
            <input type="date" value={endDraft} onChange={(e) => setEndDraft(e.target.value)} aria-label="结束日期" />
            <button type="button" className={styles.goalRangeSave} onClick={saveRange}>保存</button>
            <button type="button" className={`${styles.goalRangeSave} ${styles.goalRangeClear}`} onClick={clearRange}>清除</button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.goalRangeText}
            onClick={() => {
              setStartDraft(goal.startOn ?? '')
              setEndDraft(goal.endOn ?? '')
              setRangeEditing(true)
            }}
            title={goal.startOn || goal.endOn ? '点击修改时间范围' : '点击设置时间范围'}
          >
            {goal.startOn || goal.endOn
              ? `${goal.startOn ? fmtMD(goal.startOn) : '-'} – ${goal.endOn ? fmtMD(goal.endOn) : '-'}`
              : '时间范围未设'}
          </button>
        )}
      </div>

      <StageCard
        stage={null}
        index={0}
        items={looseItems}
        editing={editMode}
        open={openMap.loose ?? true}
        subFormOpen={subFormFor === 'loose'}
        showFinish={false}
        onToggle={() => setOpenMap((m) => ({ ...m, loose: !(m.loose ?? true) }))}
        onAddSub={() => setSubFormFor('loose')}
        onCancelSub={() => setSubFormFor(null)}
        onSubmitSub={(title) => submitSubtask(null, title)}
        onDeleteSub={removeSubtask}
        onDeleteStage={() => undefined}
        onRenameStage={() => undefined}
        onFinish={() => undefined}
        onLater={() => undefined}
      />

      {stages.map((stage, index) => {
        const items = itemsOfStage(stage.id)
        const allDone = items.length > 0 && items.every((x) => x.done)
        return (
          <StageCard
            key={stage.id}
            stage={stage}
            index={index}
            items={items}
            editing={editMode}
            open={editMode ? true : (openMap[stage.id] ?? !stage.done)}
            subFormOpen={subFormFor === stage.id}
            showFinish={stage.isCurrent && !stage.done && allDone && !laterStages.includes(stage.id)}
            onToggle={() => setOpenMap((m) => ({ ...m, [stage.id]: !(m[stage.id] ?? !stage.done) }))}
            onAddSub={() => setSubFormFor(stage.id)}
            onCancelSub={() => setSubFormFor(null)}
            onSubmitSub={(title) => submitSubtask(stage.id, title)}
            onDeleteSub={removeSubtask}
            onDeleteStage={removeStage}
            onRenameStage={(s, i, fullTitle) => {
              const body = stageTitleFromInput(fullTitle, i)
              if (body && body !== cleanStageTitle(s.title)) void renameStage(s.id, body)
            }}
            onFinish={finishStage}
            onLater={(s) => setLaterStages((list) => [...list, s.id])}
          />
        )
      })}

      {!editMode && (
        newStageOpen ? (
          <div className={styles.stageForm}>
            <div className={styles.stageFormRow}>
              <span className={styles.stageFormLabel}>名称</span>
              <input
                value={newStageName}
                maxLength={50}
                autoFocus
                placeholder="例如：上线前验收"
                onChange={(e) => setNewStageName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitNewStage()
                  }
                  if (e.key === 'Escape') {
                    setNewStageOpen(false)
                    setNewStageName('')
                  }
                }}
              />
            </div>
            <div className={styles.stageFormBtns}>
              <button type="button" className={styles.stageFormCancel} onClick={() => {
                setNewStageOpen(false)
                setNewStageName('')
              }}>
                取消
              </button>
              <button type="button" className={styles.stageFormCreate} onClick={submitNewStage}>创建阶段</button>
            </div>
          </div>
        ) : (
          <button type="button" className={styles.addStage} onClick={() => setNewStageOpen(true)}>
            ＋ 新建阶段
          </button>
        )
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
            点右上角「新建目标」创建一个阶段性目标
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
                当前 · {cleanStageTitle(current.title)}
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
            <span>{subtaskCount} 个子任务 · {stageCount} 个阶段</span>
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

  // v9.29 组头不再挂「新建目标」——全局入口固定在顶部工具条
  // v9.31 文件夹组头那枚也去掉：只留顶部一个入口，表单里可选文件夹
  const renderGroup = (
    title: string,
    items: typeof goalList,
    doneGroup: boolean,
    hideFolderTag?: boolean,
  ): JSX.Element => (
    <section key={title}>
      <div className={styles.listHead}>
        <span className={styles.listTitle}>
          {title}（{items.length}）
        </span>
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
          {/* v8.75：箭头 + 标题合并为一个可点击区——点文件夹名本身也能折叠/展开；
              右侧「新建目标」/「···菜单」仍是独立按钮，点击不触发折叠 */}
          <button
            className={styles.folderGroupMain}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? '展开' : '折叠'}文件夹「${fs.folder.name}」`}
            onClick={() => void setFolderCollapsed(fs.folder.id, !collapsed)}
          >
            <span className={styles.folderCollapse} aria-hidden="true">
              {collapsed ? '▸' : '▾'}
            </span>
            <span className={styles.folderGroupTitle}>
              {fs.folder.name}（{items.length}）{fs.folder.favorite ? ' ★' : ''}
            </span>
          </button>
          <button className={styles.folderGroupMenu} aria-label="文件夹菜单" onClick={() => setMenuFor(fs)}>
            ···
          </button>
        </div>
        {collapsed ? null : items.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyBig}>◎</span>
            这个文件夹还没有目标
            <br />
            <button
              className={styles.newGoalBtn}
              aria-label={`在「${fs.folder.name}」下新建目标`}
              onClick={() => {
                setNewGoalFolder(fs.folder.id)
                setNewOpen(true)
              }}
            >
              新建目标
            </button>
            <span className={styles.emptyHint}>自动归入此文件夹，或在详情页移动进来</span>
          </div>
        ) : (
          renderGroup('文件夹中的目标', items, false, true)
        )}
      </section>
    )
  }

  // v9.28 全部视图按文件夹分组：文件夹组（收藏置顶 → 创建时间）+ 未分类组沉底；每组可折叠
  // 组内沿用「进行中在上、已完成沉底」（aggregate 排序）；分组视图隐藏卡片文件夹小标签（组头已标明）
  // v9.28 空文件夹也入列（新建但还没放目标时也在列表里，而不是凭空消失）；未分类组常驻
  const renderGroupedAll = (): JSX.Element => {
    const uncategorized = goalList.filter((x) => !x.goal.folderId)
    return (
      <>
        {folderList.map(({ folder }) => {
          const items = goalList.filter((x) => x.goal.folderId === folder.id)
          const collapsed = folder.collapsed ?? false
          return (
            <section key={folder.id}>
              <div className={`${styles.folderGroupHead} ${collapsed ? styles.folderGroupHeadCollapsed : ''}`}>
                <button
                  className={styles.folderGroupMain}
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? '展开' : '折叠'}文件夹「${folder.name}」`}
                  onClick={() => void setFolderCollapsed(folder.id, !collapsed)}
                >
                  <span className={styles.folderCollapse} aria-hidden="true">
                    {collapsed ? '▸' : '▾'}
                  </span>
                  <span className={styles.folderGroupTitle}>
                    {folder.name}（{items.length}）{folder.favorite ? ' ★' : ''}
                  </span>
                </button>
                {/* v8.87 「全部」页的组头也挂 ··· 菜单：此前只有切进单文件夹视图才有编辑入口，
                    导致在全部页看到的文件夹既不能改名也不能收藏/删除 */}
                <button
                  className={styles.folderGroupMenu}
                  aria-label={`文件夹菜单：${folder.name}`}
                  onClick={() => setMenuFor(folderList.find((x) => x.folder.id === folder.id) ?? null)}
                >
                  ···
                </button>
              </div>
              {collapsed ? null : items.length === 0 ? (
                <div className={styles.groupEmpty}>这个文件夹还没有目标</div>
              ) : (
                renderCards(items, false, true)
              )}
            </section>
          )
        })}
        <section>
          <div className={`${styles.folderGroupHead} ${uncatCollapsed ? styles.folderGroupHeadCollapsed : ''}`}>
            <button
              className={styles.folderGroupMain}
              aria-expanded={!uncatCollapsed}
              aria-label={uncatCollapsed ? '展开未分类' : '折叠未分类'}
              onClick={() => setUncatCollapsed(!uncatCollapsed)}
            >
              <span className={styles.folderCollapse} aria-hidden="true">
                {uncatCollapsed ? '▸' : '▾'}
              </span>
              <span className={styles.folderGroupTitle}>未分类（{uncategorized.length}）</span>
            </button>
          </div>
          {uncatCollapsed ? null : uncategorized.length === 0 ? (
            <div className={styles.groupEmpty}>还没有未分类的目标</div>
          ) : (
            renderCards(uncategorized, false, true)
          )}
        </section>
      </>
    )
  }

  // 桌面端：鼠标只有纵向滚轮，把纵向滚轮转成文件夹 chips 的横向滚动（触控板/触摸仍是原生横滑）
  const chipsRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = chipsRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (el.scrollWidth <= el.clientWidth + 1) return          // 没溢出就不用接管
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return      // 横向手势（触控板）交还原生
      const before = el.scrollLeft
      el.scrollLeft = before + e.deltaY
      if (el.scrollLeft !== before) e.preventDefault()          // 滚到头就放行，让页面继续滚
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [folderList.length])

  // v9.28 顶部工具条：新建文件夹、新建目标两端固定（不随 chips 横滑被滚走），中间 chips 横滑
  // 新建目标的默认归属跟随当前视图：全部 → 未分类；单文件夹视图 → 该文件夹
  const openNewGoal = (): void => {
    setNewGoalFolder(filter === 'all' ? null : filter)
    setNewOpen(true)
  }
  const folderBar = folderList.length > 0 ? (
    <div className={styles.folderBar}>
      <button className={styles.folderNew} aria-label="新建文件夹" onClick={() => setFolderSheet(true)}>
        新建文件夹
      </button>
      <div ref={chipsRef} className={styles.folderChips}>
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
      </div>
      <button className={styles.folderNewGoal} aria-label="新建目标" onClick={openNewGoal}>
        新建目标
      </button>
    </div>
  ) : (
    <div className={styles.folderBar}>
      <button className={styles.folderNew} aria-label="新建文件夹" onClick={() => setFolderSheet(true)}>
        新建文件夹
      </button>
      <button className={styles.folderNewGoal} aria-label="新建目标" onClick={openNewGoal}>
        新建目标
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
