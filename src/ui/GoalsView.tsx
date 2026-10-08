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
import { useState } from 'react'
import type { JSX, ReactNode } from 'react'
import type { GoalRecord, StageInput, StageRecord, SubtaskRecord } from '@core'
import { useApp } from '@/app/context'
import styles from './GoalsView.module.css'

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

function NewGoalSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const createGoal = useApp((s) => s.createGoal)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')

  const submit = async (): Promise<void> => {
    if (!title.trim()) return
    const ok = await createGoal(title.trim(), note.trim())
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
      {stage.pct !== undefined && (
        <div className={styles.bar}>
          <i style={{ width: `${stage.pct}%` }} />
        </div>
      )}
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
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(subtask.title)

  const save = async (): Promise<void> => {
    const t = draft.trim()
    if (t && t !== subtask.title) await updateSubtask(subtask.id, { title: t })
    setEditing(false)
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
  const deleteGoal = useApp((s) => s.deleteGoal)
  const setGoalDone = useApp((s) => s.setGoalDone)
  const deleteStage = useApp((s) => s.deleteStage)
  const deleteSubtask = useApp((s) => s.deleteSubtask)

  const [noteEdit, setNoteEdit] = useState(false)
  const [noteDraft, setNoteDraft] = useState(goal.note)
  const [stageSheet, setStageSheet] = useState<null | 'new' | StageRecord>(null)
  const [subtaskSheet, setSubtaskSheet] = useState(false)
  // v8.5 双视图：阶段（时间维度）| 子任务（执行维度），各自进度独立
  const [viewMode, setViewMode] = useState<'stages' | 'subtasks'>('subtasks') // v8.7 默认子任务视图

  const saveNote = async (): Promise<void> => {
    const ok = await updateGoal(goal.id, { note: noteDraft.trim() })
    if (ok) setNoteEdit(false)
  }

  const removeGoal = (): void => {
    // 连带删除全部阶段/子任务由 repo 单事务保证（用户口径：删除目标 = 删除它的一切）
    void deleteGoal(goal.id)
  }

  const removeStage = (s: StageRecord): void => {
    void deleteStage(s.id)
  }

  const removeSubtask = (st: SubtaskRecord): void => {
    void deleteSubtask(st.id)
  }

  const doneSubtaskCount = subtasks.filter((x) => x.done).length

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
        <button className={styles.deleteGoal} onClick={removeGoal} aria-label="删除目标" title="删除目标">
          删除
        </button>
      </div>

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
            subtasks.map((st) => (
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
  const openGoal = useApp((s) => s.openGoal)
  const setGoalDone = useApp((s) => s.setGoalDone)
  const [newOpen, setNewOpen] = useState(false)

  // v7.9 补：进行中的在前（aggregate 已排序），已完成的沉底成组
  const active = goalList.filter((x) => !x.goal.done)
  const done = goalList.filter((x) => x.goal.done)

  const renderGroup = (
    title: string,
    items: typeof goalList,
    doneGroup: boolean,
  ): JSX.Element => (
    <section key={title}>
      <div className={styles.listHead}>
        <span className={styles.listTitle}>
          {title}（{items.length}）
        </span>
        {!doneGroup && (
          <button className={styles.newGoalBtn} onClick={() => setNewOpen(true)}>
            ＋ 新建目标
          </button>
        )}
      </div>

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

      {items.map(({ goal, stageCount, subtaskCount, current }) => (
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
          </h2>
          <div className={styles.meta}>
            <span>进度</span>
            <span className={styles.pct}>
              {current?.pct !== undefined ? `${current.pct}%` : '—'}
            </span>
            <span>· {subtaskCount} 个子任务 · {stageCount} 个阶段</span>
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
    </section>
  )

  return (
    <div className={styles.list}>
      {renderGroup('进行中的目标', active, false)}
      {done.length > 0 && renderGroup('已完成的目标', done, true)}
      {newOpen && <NewGoalSheet onClose={() => setNewOpen(false)} />}
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
