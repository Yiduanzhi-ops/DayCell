/**
 * core/backup —— 备份导出 / 合并导入 / Markdown 导出（PRD M14/M15，v7.5 实现）。
 *
 * 纯 core：**禁 React/DOM**（isolation.test.ts 守护），只操作 RecordStore 与纯字符串。
 * UI 层的"下载文件 / 读 File"不在这里，而在 app/store.ts（那是唯一允许碰 DOM 的层）。
 *
 * ## 备份文件格式（version 1）
 * ```json
 * {
 *   "app": "daycell",
 *   "version": 1,              // 备份格式版本
 *   "exportedAt": 1760000000000,
 *   "schemaVersion": 1,        // 数据 schema 版本（SCHEMA_VERSION）
 *   "data": { todos, notes, expenses, anniversaries, categories, settings }
 * }
 * ```
 *
 * ## 导入 = **合并**（v7.5 用户口径，US-10 修订）：
 *  - 按记录 id 去重：本地已有 id → 保留本地；备份新增 id → 补入
 *  - 备份里的墓碑（deleted: true）不导入——"已删除"没有可恢复的可见数据，只添乱
 *  - settings 本地优先：本地已有的 key 不覆盖（夜间模式等 UI 偏好不被备份顶掉）；
 *    备份有而本地没有的 key 才补入
 *  - 全程单事务（store.tx），任何一步失败整体回滚，现有数据不动
 *  - 写回一律 keepTimestamps: true（PRD §6.3 / store/types.ts 注释）：
 *    否则恢复出来的记录 updatedAt 全变"刚刚"，记录级 last-write-wins 会反向覆盖
 */

import {
  SCHEMA_VERSION,
  SETTING_KEYS,
  type AnniversaryRecord,
  type AnnivCheckRecord,
  type CategoryRecord,
  type CheckinRecord,
  type DateKey,
  type ExpenseRecord,
  type FolderRecord,
  type GoalRecord,
  type HabitRecord,
  type NoteRecord,
  type RecordTable,
  type ReviewRecord,
  type SettingKey,
  type SettingRecord,
  type StageRecord,
  type StoreName,
  type SubtaskRecord,
  type TodoRecord,
} from '../types'
import { BackupCorruptError } from '../errors'
import { systemClock, type Clock } from '../clock'
import { dowOf, fromKey } from '../date'
import { formatMoney } from '../aggregate/money'
import type { RecordStore } from '../store/types'

// ---------------------------------------------------------------------------
// 备份文件
// ---------------------------------------------------------------------------

export interface BackupFile {
  app: 'daycell'
  version: 1
  exportedAt: number
  schemaVersion: typeof SCHEMA_VERSION
  data: RecordTable
}

export const BACKUP_FORMAT_VERSION = 1 as const

const CONTENT_STORE_TYPES: Record<Exclude<StoreName, 'settings'>, string> = {
  todos: 'todo',
  notes: 'note',
  expenses: 'expense',
  anniversaries: 'anniversary',
  categories: 'category',
  goals: 'goal',
  stages: 'stage',
  subtasks: 'subtask',
  habits: 'habit',
  checkins: 'checkin',
  annivchecks: 'anniv-check',
  reviews: 'review',
  folders: 'folder',
}

/** settings 的合法 key（与 types.ts 的 SettingKey 同步，运行时兜底） */
// 设置键白名单 = types 的 SETTING_KEYS（**单一来源**，v8.65 起不再本地手抄，
// 防"类型加了、白名单忘更新"导致备份文件误判损坏——v8.62 的 weekViewHabits 教训）

// ---------------------------------------------------------------------------
// 导出（serialize）
// ---------------------------------------------------------------------------

/** 全量序列化。**含墓碑**——备份必须能完整还原现场（PRD §6.3） */
export async function serializeBackup(
  store: RecordStore,
  now: Clock = systemClock,
): Promise<BackupFile> {
  const [todos, notes, expenses, anniversaries, categories, goals, stages, subtasks, habits, checkins, annivchecks, reviews, folders, settings] = await Promise.all([
    store.all<TodoRecord>('todos', { includeDeleted: true }),
    store.all<NoteRecord>('notes', { includeDeleted: true }),
    store.all<ExpenseRecord>('expenses', { includeDeleted: true }),
    store.all<AnniversaryRecord>('anniversaries', { includeDeleted: true }),
    store.all<CategoryRecord>('categories', { includeDeleted: true }),
    store.all<GoalRecord>('goals', { includeDeleted: true }),
    store.all<StageRecord>('stages', { includeDeleted: true }),
    store.all<SubtaskRecord>('subtasks', { includeDeleted: true }),
    store.all<HabitRecord>('habits', { includeDeleted: true }),
    store.all<CheckinRecord>('checkins', { includeDeleted: true }),
    store.all<AnnivCheckRecord>('annivchecks', { includeDeleted: true }),
    store.all<ReviewRecord>('reviews', { includeDeleted: true }),
    store.all<FolderRecord>('folders', { includeDeleted: true }),
    store.allSettings(),
  ])
  return {
    app: 'daycell',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: now(),
    schemaVersion: SCHEMA_VERSION,
    data: { todos, notes, expenses, anniversaries, categories, goals, stages, subtasks, habits, checkins, annivchecks, reviews, folders, settings },
  }
}

// ---------------------------------------------------------------------------
// 解析与校验（parse）
// ---------------------------------------------------------------------------

function isRecord(r: unknown, type: string): r is Record<string, unknown> {
  return (
    !!r &&
    typeof r === 'object' &&
    typeof (r as { id?: unknown }).id === 'string' &&
    (r as { id: string }).id.length > 0 &&
    (r as { type?: unknown }).type === type
  )
}

function parseRecords<T>(raw: unknown, type: string, field: string): T[] {
  if (!Array.isArray(raw)) throw new BackupCorruptError(`备份文件损坏：${field} 不是数组`)
  for (const r of raw) {
    if (!isRecord(r, type)) throw new BackupCorruptError(`备份文件损坏：${field} 里混入了无法识别的数据`)
  }
  return raw as T[]
}

/**
 * v9.32 未知设置项**跳过**，不再判成"文件损坏"。
 *
 * 原先白名单里没有的 key 会让整份备份一条都不导入（提示"备份文件损坏：
 * settings 含未知设置项"）——可备份里出现未知 key 是很正常的事：旧版本导出的、
 * 已经废弃的偏好、另一条分支新增的开关、甚至同一设备早期残留的键。这些都不该
 * 挡住用户的待办/目标数据。
 * 只有**结构本身坏了**（settings 不是数组、条目不是对象、条目没有 key）才算损坏。
 */
function parseSettings(raw: unknown): SettingRecord[] {
  if (!Array.isArray(raw)) throw new BackupCorruptError('备份文件损坏：settings 不是数组')
  const out: SettingRecord[] = []
  for (const s of raw) {
    if (!s || typeof s !== 'object') throw new BackupCorruptError('备份文件损坏：settings 数据异常')
    const key = (s as { key?: unknown }).key
    if (typeof key !== 'string') throw new BackupCorruptError('备份文件损坏：settings 数据异常')
    // 不认识的键：本端用不上，直接忽略（不会写库）
    if (!SETTING_KEYS.includes(key as SettingKey)) continue
    out.push(s as SettingRecord)
  }
  return out
}

/**
 * 解析并校验备份文本。**任何一处非法 → 整体拒绝**（BackupCorruptError），
 * 调用方（store.importBackup）保证"一条都没写入"。
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BackupCorruptError('文件不是有效的 JSON')
  }
  if (!raw || typeof raw !== 'object') throw new BackupCorruptError('备份文件格式不正确')
  const f = raw as Partial<BackupFile>
  if (f.app !== 'daycell') throw new BackupCorruptError('不是 DayCell 的备份文件')
  if (f.version !== BACKUP_FORMAT_VERSION) throw new BackupCorruptError('备份文件版本过新，请升级应用后导入')
  if (f.schemaVersion !== SCHEMA_VERSION) throw new BackupCorruptError('备份数据版本与当前应用不兼容')
  if (typeof f.exportedAt !== 'number' || !Number.isFinite(f.exportedAt)) {
    throw new BackupCorruptError('备份文件缺少导出时间')
  }
  const data = f.data
  if (!data || typeof data !== 'object') throw new BackupCorruptError('备份文件缺少数据体')

  return {
    app: 'daycell',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: f.exportedAt,
    schemaVersion: SCHEMA_VERSION,
    data: {
      todos: parseRecords<TodoRecord>(data.todos, CONTENT_STORE_TYPES.todos, 'todos'),
      notes: parseRecords<NoteRecord>(data.notes, CONTENT_STORE_TYPES.notes, 'notes'),
      expenses: parseRecords<ExpenseRecord>(data.expenses, CONTENT_STORE_TYPES.expenses, 'expenses'),
      anniversaries: parseRecords<AnniversaryRecord>(data.anniversaries, CONTENT_STORE_TYPES.anniversaries, 'anniversaries'),
      categories: parseRecords<CategoryRecord>(data.categories, CONTENT_STORE_TYPES.categories, 'categories'),
      goals: parseRecords<GoalRecord>(data.goals ?? [], CONTENT_STORE_TYPES.goals, 'goals'),
      stages: parseRecords<StageRecord>(data.stages ?? [], CONTENT_STORE_TYPES.stages, 'stages'),
      subtasks: parseRecords<SubtaskRecord>(data.subtasks ?? [], CONTENT_STORE_TYPES.subtasks, 'subtasks'),
      habits: parseRecords<HabitRecord>(data.habits ?? [], CONTENT_STORE_TYPES.habits, 'habits'),
      checkins: parseRecords<CheckinRecord>(data.checkins ?? [], CONTENT_STORE_TYPES.checkins, 'checkins'),
      annivchecks: parseRecords<AnnivCheckRecord>(data.annivchecks ?? [], CONTENT_STORE_TYPES.annivchecks, 'annivchecks'),
      reviews: parseRecords<ReviewRecord>(data.reviews ?? [], CONTENT_STORE_TYPES.reviews, 'reviews'),
      folders: parseRecords<FolderRecord>(data.folders ?? [], CONTENT_STORE_TYPES.folders, 'folders'),
      settings: parseSettings(data.settings),
    },
  }
}

// ---------------------------------------------------------------------------
// 合并统计的可读文案（v9.30）
// ---------------------------------------------------------------------------

/**
 * 统计文案用的展示单位与顺序（v9.30）。
 * 顺序刻意让「目标 / 文件夹」排在前面：用户最关心的就是备份有没有带上这些，
 * 从前这几类漏算，导致只导入目标时误报「没有新数据」。
 */
const MERGE_LABELS: { key: keyof MergeStats['added']; unit: string }[] = [
  { key: 'goals', unit: '个目标' },
  { key: 'stages', unit: '个阶段' },
  { key: 'subtasks', unit: '个子任务' },
  { key: 'folders', unit: '个文件夹' },
  { key: 'todos', unit: '条待办' },
  { key: 'notes', unit: '条想法' },
  { key: 'expenses', unit: '条支出' },
  { key: 'anniversaries', unit: '条纪念日' },
  { key: 'categories', unit: '个分类' },
  { key: 'habits', unit: '个习惯' },
  { key: 'checkins', unit: '条打卡' },
  { key: 'annivchecks', unit: '条纪念日打卡' },
  { key: 'reviews', unit: '条复盘' },
]

/**
 * 把 MergeStats 渲染成「2 个目标、1 个文件夹、3 条待办」。
 * 全为 0 时返回空串（调用方据此给「没有新数据」）。
 * **覆盖 MergeStats.added 的全部键**：新增 store 时必须同步 MERGE_LABELS，
 * 否则又会出现"明明导入了却不计数"的老问题。
 */
export function formatMergeStats(stats: MergeStats): string {
  const parts = MERGE_LABELS.filter(({ key }) => stats.added[key] > 0).map(
    ({ key, unit }) => `${stats.added[key]} ${unit}`,
  )
  if (stats.settingsAdded > 0) parts.push(`${stats.settingsAdded} 项设置`)
  // v9.34：本地删掉、备份里还在的记录会被恢复，同样要如实说，否则用户以为只导入了新增
  const restoredTotal = (Object.values(stats.restored) as number[]).reduce((a, b) => a + b, 0)
  if (restoredTotal > 0) parts.push(`恢复 ${restoredTotal} 条已删除的记录`)
  // v9.33：这次没有新增目标、但把已有目标补回了文件夹归属，也要如实说
  if (stats.linkedGoals > 0) parts.push(`${stats.linkedGoals} 个目标归回文件夹`)
  return parts.join('、')
}

// ---------------------------------------------------------------------------
// 合并导入（merge）
// ---------------------------------------------------------------------------

export interface MergeStats {
  /** 各 store 实际新增（补入）的记录数 */
  added: Record<Exclude<StoreName, 'settings'>, number>
  /**
   * v9.34：各 store 从备份恢复的条数（本地是墓碑 deleted=true、备份里是活记录）。
   * 「导入备份」的语义是恢复，删掉的数据必须能跟着备份回来——
   * 此前同 id 一律整条保留本地，墓碑也算「本地已有」，删掉的东西永远导不回来。
   */
  restored: Record<Exclude<StoreName, 'settings'>, number>
  /** 新增的设置项数 */
  settingsAdded: number
  /** 因 id 冲突保留本地的条数（备份里既没新增、也没恢复的） */
  keptLocal: number
  /** v9.33：同 id 目标从备份补回文件夹归属的条数（本地原本没有归属） */
  linkedGoals: number
}

/**
 * 合并导入（单事务）。返回统计供 UI 提示。
 * ⚠️ 调用前必须先 parseBackup 通过；这里不再重复校验。
 */
export async function mergeBackup(store: RecordStore, file: BackupFile): Promise<MergeStats> {
  // 本地现状：含墓碑，才能拿到"全部已用 id"
  const [localTodos, localNotes, localExpenses, localAnniv, localCats, localGoals, localStages, localSubtasks, localHabits, localCheckins, localAnnivChecks, localReviews, localFolders, localSettings] =
    await Promise.all([
      store.all<TodoRecord>('todos', { includeDeleted: true }),
      store.all<NoteRecord>('notes', { includeDeleted: true }),
      store.all<ExpenseRecord>('expenses', { includeDeleted: true }),
      store.all<AnniversaryRecord>('anniversaries', { includeDeleted: true }),
      store.all<CategoryRecord>('categories', { includeDeleted: true }),
      store.all<GoalRecord>('goals', { includeDeleted: true }),
      store.all<StageRecord>('stages', { includeDeleted: true }),
      store.all<SubtaskRecord>('subtasks', { includeDeleted: true }),
      store.all<HabitRecord>('habits', { includeDeleted: true }),
      store.all<CheckinRecord>('checkins', { includeDeleted: true }),
      store.all<AnnivCheckRecord>('annivchecks', { includeDeleted: true }),
      store.all<ReviewRecord>('reviews', { includeDeleted: true }),
      store.all<FolderRecord>('folders', { includeDeleted: true }),
      store.allSettings(),
    ])

  // 按 id 三分：备份是墓碑 → 不引入；本地没有 → 新增；本地是墓碑、备份是活记录 → 恢复；
  // 本地活着 → 保留本地（keptLocal 计数），不覆盖用户后来的修改
  const splitMerge = <T extends { id: string; deleted?: boolean }>(
    backup: T[],
    local: T[],
  ): { fresh: T[]; restored: T[] } => {
    const localById = new Map(local.map((r) => [r.id, r]))
    const fresh: T[] = []
    const restored: T[] = []
    for (const r of backup) {
      if (r.deleted) continue
      const localRow = localById.get(r.id)
      if (!localRow) fresh.push(r)
      else if (localRow.deleted) restored.push(r)
    }
    return { fresh, restored }
  }

  const mTodos = splitMerge(file.data.todos, localTodos)
  const mNotes = splitMerge(file.data.notes, localNotes)
  const mExpenses = splitMerge(file.data.expenses, localExpenses)
  const mAnniv = splitMerge(file.data.anniversaries, localAnniv)
  const mCats = splitMerge(file.data.categories, localCats)
  const mGoals = splitMerge(file.data.goals, localGoals)
  const mStages = splitMerge(file.data.stages, localStages)
  const mSubtasks = splitMerge(file.data.subtasks, localSubtasks)
  const mHabits = splitMerge(file.data.habits, localHabits)
  const mCheckins = splitMerge(file.data.checkins, localCheckins)
  const mAnnivChecks = splitMerge(file.data.annivchecks, localAnnivChecks)
  const mReviews = splitMerge(file.data.reviews ?? [], localReviews)
  const mFolders = splitMerge(file.data.folders ?? [], localFolders)

  // v9.33 文件夹归属补全：id 冲突时目标整条保留本地，但 folderId 是纯归属元数据——
  // 本地目标没有归属（在文件夹功能之前创建、或从旧版备份导入的），备份里却带着它属于哪个文件夹，
  // 此前会被"本地已有"一并跳过，于是文件夹导进来了、里面的目标却全落在未分类。
  // 这里只补「本地没有 folderId」的目标，不覆盖任何本地已有归属；文件夹在合并后不存在则跳过。
  const liveLocalFolderIds = new Set(localFolders.filter((f) => !f.deleted).map((f) => f.id))
  const folderIdsAfterMerge = new Set([
    ...liveLocalFolderIds,
    ...mFolders.fresh.map((f) => f.id),
    ...mFolders.restored.map((f) => f.id),
  ])
  const backupGoalById = new Map(file.data.goals.map((g) => [g.id, g]))
  const goalLinkUpdates: GoalRecord[] = []
  for (const g of localGoals) {
    if (g.deleted || g.folderId) continue
    const fromBackup = backupGoalById.get(g.id)
    if (!fromBackup || fromBackup.deleted || !fromBackup.folderId) continue
    if (!folderIdsAfterMerge.has(fromBackup.folderId)) continue
    goalLinkUpdates.push({ ...g, folderId: fromBackup.folderId })
  }

  const localKeys = new Set<SettingKey>(localSettings.map((s) => s.key))
  // v9.32：白名单兜底——快照恢复等路径不经 parseSettings，这里再挡一次，
  // 未知设置键绝不写库
  const knownKeys = new Set<string>(SETTING_KEYS)
  const newSettings = file.data.settings.filter(
    (s) => knownKeys.has(s.key) && !localKeys.has(s.key),
  )

  // 备份里有、但既没新增也没恢复的条数：本地活着（同 id 冲突保留本地）+ 两边都是墓碑
  const keptLocal =
    (file.data.todos.length - mTodos.fresh.length - mTodos.restored.length) +
    (file.data.notes.length - mNotes.fresh.length - mNotes.restored.length) +
    (file.data.expenses.length - mExpenses.fresh.length - mExpenses.restored.length) +
    (file.data.anniversaries.length - mAnniv.fresh.length - mAnniv.restored.length) +
    (file.data.categories.length - mCats.fresh.length - mCats.restored.length) +
    (file.data.goals.length - mGoals.fresh.length - mGoals.restored.length) +
    (file.data.stages.length - mStages.fresh.length - mStages.restored.length) +
    (file.data.subtasks.length - mSubtasks.fresh.length - mSubtasks.restored.length) +
    (file.data.habits.length - mHabits.fresh.length - mHabits.restored.length) +
    (file.data.checkins.length - mCheckins.fresh.length - mCheckins.restored.length) +
    (file.data.annivchecks.length - mAnnivChecks.fresh.length - mAnnivChecks.restored.length) +
    ((file.data.reviews?.length ?? 0) - mReviews.fresh.length - mReviews.restored.length) +
    ((file.data.folders?.length ?? 0) - mFolders.fresh.length - mFolders.restored.length)

  const allEmpty =
    mTodos.fresh.length === 0 && mTodos.restored.length === 0 &&
    mNotes.fresh.length === 0 && mNotes.restored.length === 0 &&
    mExpenses.fresh.length === 0 && mExpenses.restored.length === 0 &&
    mAnniv.fresh.length === 0 && mAnniv.restored.length === 0 &&
    mCats.fresh.length === 0 && mCats.restored.length === 0 &&
    mGoals.fresh.length === 0 && mGoals.restored.length === 0 &&
    mStages.fresh.length === 0 && mStages.restored.length === 0 &&
    mSubtasks.fresh.length === 0 && mSubtasks.restored.length === 0 &&
    mHabits.fresh.length === 0 && mHabits.restored.length === 0 &&
    mCheckins.fresh.length === 0 && mCheckins.restored.length === 0 &&
    mAnnivChecks.fresh.length === 0 && mAnnivChecks.restored.length === 0 &&
    mReviews.fresh.length === 0 && mReviews.restored.length === 0 &&
    mFolders.fresh.length === 0 && mFolders.restored.length === 0 &&
    newSettings.length === 0 && goalLinkUpdates.length === 0

  // 一条可合并的都没有 → 无需开事务（也避免"导入了个空备份"误报成功）
  if (allEmpty) {
    return {
      added: { todos: 0, notes: 0, expenses: 0, anniversaries: 0, categories: 0, goals: 0, stages: 0, subtasks: 0, habits: 0, checkins: 0, annivchecks: 0, reviews: 0, folders: 0 },
      restored: { todos: 0, notes: 0, expenses: 0, anniversaries: 0, categories: 0, goals: 0, stages: 0, subtasks: 0, habits: 0, checkins: 0, annivchecks: 0, reviews: 0, folders: 0 },
      settingsAdded: 0,
      keptLocal,
      linkedGoals: 0,
    }
  }

  await store.tx(async (scope) => {
    // keepTimestamps: true —— 恢复备份必须保留原始时间戳（见文件头注释）
    // v9.34：新增（fresh）与恢复（restored，本地墓碑被备份里的活记录覆盖写回）一起落库
    const wTodos = [...mTodos.fresh, ...mTodos.restored]
    const wNotes = [...mNotes.fresh, ...mNotes.restored]
    const wExpenses = [...mExpenses.fresh, ...mExpenses.restored]
    const wAnniv = [...mAnniv.fresh, ...mAnniv.restored]
    const wCats = [...mCats.fresh, ...mCats.restored]
    const wGoals = [...mGoals.fresh, ...mGoals.restored]
    const wStages = [...mStages.fresh, ...mStages.restored]
    const wSubtasks = [...mSubtasks.fresh, ...mSubtasks.restored]
    const wHabits = [...mHabits.fresh, ...mHabits.restored]
    const wCheckins = [...mCheckins.fresh, ...mCheckins.restored]
    const wAnnivChecks = [...mAnnivChecks.fresh, ...mAnnivChecks.restored]
    const wReviews = [...mReviews.fresh, ...mReviews.restored]
    const wFolders = [...mFolders.fresh, ...mFolders.restored]
    if (wTodos.length) await scope.putMany<TodoRecord>('todos', wTodos, { keepTimestamps: true })
    if (wNotes.length) await scope.putMany<NoteRecord>('notes', wNotes, { keepTimestamps: true })
    if (wExpenses.length) await scope.putMany<ExpenseRecord>('expenses', wExpenses, { keepTimestamps: true })
    if (wAnniv.length) await scope.putMany<AnniversaryRecord>('anniversaries', wAnniv, { keepTimestamps: true })
    if (wCats.length) await scope.putMany<CategoryRecord>('categories', wCats, { keepTimestamps: true })
    if (wGoals.length) await scope.putMany<GoalRecord>('goals', wGoals, { keepTimestamps: true })
    if (wStages.length) await scope.putMany<StageRecord>('stages', wStages, { keepTimestamps: true })
    if (wSubtasks.length) await scope.putMany<SubtaskRecord>('subtasks', wSubtasks, { keepTimestamps: true })
    if (wHabits.length) await scope.putMany<HabitRecord>('habits', wHabits, { keepTimestamps: true })
    if (wCheckins.length) await scope.putMany<CheckinRecord>('checkins', wCheckins, { keepTimestamps: true })
    if (wAnnivChecks.length) await scope.putMany<AnnivCheckRecord>('annivchecks', wAnnivChecks, { keepTimestamps: true })
    if (wReviews.length) await scope.putMany<ReviewRecord>('reviews', wReviews, { keepTimestamps: true })
    if (wFolders.length) await scope.putMany<FolderRecord>('folders', wFolders, { keepTimestamps: true })
    // v9.33 归属补全：只写回 folderId，原始创建/更新时间戳一律不动
    if (goalLinkUpdates.length) await scope.putMany<GoalRecord>('goals', goalLinkUpdates, { keepTimestamps: true })
    // settings 没有 keepTimestamps 选项（key/value 单例），刷新 updatedAt 无副作用
    for (const s of newSettings) await scope.putSetting(s.key, s.value)
  })

  return {
    added: {
      todos: mTodos.fresh.length,
      notes: mNotes.fresh.length,
      expenses: mExpenses.fresh.length,
      anniversaries: mAnniv.fresh.length,
      categories: mCats.fresh.length,
      goals: mGoals.fresh.length,
      stages: mStages.fresh.length,
      subtasks: mSubtasks.fresh.length,
      habits: mHabits.fresh.length,
      checkins: mCheckins.fresh.length,
      annivchecks: mAnnivChecks.fresh.length,
      reviews: mReviews.fresh.length,
      folders: mFolders.fresh.length,
    },
    restored: {
      todos: mTodos.restored.length,
      notes: mNotes.restored.length,
      expenses: mExpenses.restored.length,
      anniversaries: mAnniv.restored.length,
      categories: mCats.restored.length,
      goals: mGoals.restored.length,
      stages: mStages.restored.length,
      subtasks: mSubtasks.restored.length,
      habits: mHabits.restored.length,
      checkins: mCheckins.restored.length,
      annivchecks: mAnnivChecks.restored.length,
      reviews: mReviews.restored.length,
      folders: mFolders.restored.length,
    },
    settingsAdded: newSettings.length,
    keptLocal,
    linkedGoals: goalLinkUpdates.length,
  }
}

// ---------------------------------------------------------------------------
// Markdown 导出（PRD M14 的"按月 Markdown"，v7.5 扩展为周/月通用）
// ---------------------------------------------------------------------------

export interface MdDay {
  date: DateKey
  /** 活跃记录（不含墓碑），date 升序由调用方保证 */
  todos: TodoRecord[]
  notes: NoteRecord[]
  expenses: ExpenseRecord[]
  /** catId → 显示名（已删除分类显示「已删除分类」，同聚合层口径） */
  catName: (catId: string) => string
}

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function dateHeading(k: DateKey): string {
  const { m, d } = fromKey(k)
  return `${m}月${d}日 ${WEEK_CN[dowOf(k)]}`
}

/**
 * 把一段日期的记录渲染成 Markdown（纯函数，无 IO）。
 *
 * 结构：标题 → 日期区间 → 每日小节（待办/想法/支出，空节跳过）→ 每日小计 → 末尾区间合计。
 */
export function renderRangeMd(title: string, days: MdDay[]): string {
  if (days.length === 0) return `# ${title}\n\n（该区间没有记录）\n`

  const lines: string[] = [`# ${title}`, '', `${days[0]!.date} ~ ${days[days.length - 1]!.date}`, '']

  let grandTotal = 0
  for (const day of days) {
    const activeTodos = day.todos.filter((t) => !t.deleted)
    const activeNotes = day.notes.filter((n) => !n.deleted)
    const activeExpenses = day.expenses.filter((e) => !e.deleted)
    const dayTotal = activeExpenses.reduce((sum, e) => sum + e.amountCents, 0)
    grandTotal += dayTotal

    lines.push(`## ${dateHeading(day.date)}`, '')
    if (activeTodos.length > 0) {
      lines.push('### 待办', '')
      for (const t of activeTodos) lines.push(`- [${t.done ? 'x' : ' '}] ${t.text}`)
      lines.push('')
    }
    if (activeNotes.length > 0) {
      lines.push('### 想法', '')
      for (const n of activeNotes) lines.push(`> ${n.text.replace(/\n/g, '\n> ')}`)
      lines.push('')
    }
    if (activeExpenses.length > 0) {
      lines.push('### 支出', '')
      for (const e of activeExpenses) {
        lines.push(`- ${day.catName(e.catId)} ¥${formatMoney(e.amountCents)}${e.note ? `（${e.note}）` : ''}`)
      }
      lines.push('')
      lines.push(`小计：¥${formatMoney(dayTotal)}`, '')
    }
    lines.push('---', '')
  }

  if (grandTotal > 0) {
    lines.push(`合计：¥${formatMoney(grandTotal)}`, '')
  }
  return lines.join('\n')
}
