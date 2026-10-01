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
  type AnniversaryRecord,
  type CategoryRecord,
  type DateKey,
  type ExpenseRecord,
  type NoteRecord,
  type RecordTable,
  type SettingKey,
  type SettingRecord,
  type StoreName,
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
}

/** settings 的合法 key（与 types.ts 的 SettingKey 同步，运行时兜底） */
const SETTING_KEYS: readonly string[] = [
  'accentColor',
  'lastBackupAt',
  'backupReminderOff',
  'onboarded',
  'weekStartsOn',
]

// ---------------------------------------------------------------------------
// 导出（serialize）
// ---------------------------------------------------------------------------

/** 全量序列化。**含墓碑**——备份必须能完整还原现场（PRD §6.3） */
export async function serializeBackup(
  store: RecordStore,
  now: Clock = systemClock,
): Promise<BackupFile> {
  const [todos, notes, expenses, anniversaries, categories, settings] = await Promise.all([
    store.all<TodoRecord>('todos', { includeDeleted: true }),
    store.all<NoteRecord>('notes', { includeDeleted: true }),
    store.all<ExpenseRecord>('expenses', { includeDeleted: true }),
    store.all<AnniversaryRecord>('anniversaries', { includeDeleted: true }),
    store.all<CategoryRecord>('categories', { includeDeleted: true }),
    store.allSettings(),
  ])
  return {
    app: 'daycell',
    version: BACKUP_FORMAT_VERSION,
    exportedAt: now(),
    schemaVersion: SCHEMA_VERSION,
    data: { todos, notes, expenses, anniversaries, categories, settings },
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

function parseSettings(raw: unknown): SettingRecord[] {
  if (!Array.isArray(raw)) throw new BackupCorruptError('备份文件损坏：settings 不是数组')
  for (const s of raw) {
    if (!s || typeof s !== 'object') throw new BackupCorruptError('备份文件损坏：settings 数据异常')
    const key = (s as { key?: unknown }).key
    if (typeof key !== 'string' || !(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BackupCorruptError('备份文件损坏：settings 含未知设置项')
    }
  }
  return raw as SettingRecord[]
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
      settings: parseSettings(data.settings),
    },
  }
}

// ---------------------------------------------------------------------------
// 合并导入（merge）
// ---------------------------------------------------------------------------

export interface MergeStats {
  /** 各 store 实际新增（补入）的记录数 */
  added: Record<Exclude<StoreName, 'settings'>, number>
  /** 新增的设置项数 */
  settingsAdded: number
  /** 因 id 冲突保留本地的条数 */
  keptLocal: number
}

/**
 * 合并导入（单事务）。返回统计供 UI 提示。
 * ⚠️ 调用前必须先 parseBackup 通过；这里不再重复校验。
 */
export async function mergeBackup(store: RecordStore, file: BackupFile): Promise<MergeStats> {
  // 本地现状：含墓碑，才能拿到"全部已用 id"
  const [localTodos, localNotes, localExpenses, localAnniv, localCats, localSettings] =
    await Promise.all([
      store.all<TodoRecord>('todos', { includeDeleted: true }),
      store.all<NoteRecord>('notes', { includeDeleted: true }),
      store.all<ExpenseRecord>('expenses', { includeDeleted: true }),
      store.all<AnniversaryRecord>('anniversaries', { includeDeleted: true }),
      store.all<CategoryRecord>('categories', { includeDeleted: true }),
      store.allSettings(),
    ])

  // 按 id 去重：本地已有 → 保留本地（keptLocal 计数）；备份新增且未删除 → 补入
  const pickNew = <T extends { id: string; deleted?: boolean }>(backup: T[], local: T[]): T[] => {
    const ids = new Set(local.map((r) => r.id))
    return backup.filter((r) => !r.deleted && !ids.has(r.id))
  }

  const newTodos = pickNew(file.data.todos, localTodos)
  const newNotes = pickNew(file.data.notes, localNotes)
  const newExpenses = pickNew(file.data.expenses, localExpenses)
  const newAnniv = pickNew(file.data.anniversaries, localAnniv)
  const newCats = pickNew(file.data.categories, localCats)

  const localKeys = new Set<SettingKey>(localSettings.map((s) => s.key))
  const newSettings = file.data.settings.filter((s) => !localKeys.has(s.key))

  const keptLocal =
    (file.data.todos.length - newTodos.length) +
    (file.data.notes.length - newNotes.length) +
    (file.data.expenses.length - newExpenses.length) +
    (file.data.anniversaries.length - newAnniv.length) +
    (file.data.categories.length - newCats.length)

  const allEmpty =
    newTodos.length === 0 && newNotes.length === 0 && newExpenses.length === 0 &&
    newAnniv.length === 0 && newCats.length === 0 && newSettings.length === 0

  // 一条可合并的都没有 → 无需开事务（也避免"导入了个空备份"误报成功）
  if (allEmpty) {
    return {
      added: { todos: 0, notes: 0, expenses: 0, anniversaries: 0, categories: 0 },
      settingsAdded: 0,
      keptLocal,
    }
  }

  await store.tx(async (scope) => {
    // keepTimestamps: true —— 恢复备份必须保留原始时间戳（见文件头注释）
    if (newTodos.length) await scope.putMany<TodoRecord>('todos', newTodos, { keepTimestamps: true })
    if (newNotes.length) await scope.putMany<NoteRecord>('notes', newNotes, { keepTimestamps: true })
    if (newExpenses.length) await scope.putMany<ExpenseRecord>('expenses', newExpenses, { keepTimestamps: true })
    if (newAnniv.length) await scope.putMany<AnniversaryRecord>('anniversaries', newAnniv, { keepTimestamps: true })
    if (newCats.length) await scope.putMany<CategoryRecord>('categories', newCats, { keepTimestamps: true })
    // settings 没有 keepTimestamps 选项（key/value 单例），刷新 updatedAt 无副作用
    for (const s of newSettings) await scope.putSetting(s.key, s.value)
  })

  return {
    added: {
      todos: newTodos.length,
      notes: newNotes.length,
      expenses: newExpenses.length,
      anniversaries: newAnniv.length,
      categories: newCats.length,
    },
    settingsAdded: newSettings.length,
    keptLocal,
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
 * 结构：标题 → 日期区间 → 每日小节（待办/想法/花费，空节跳过）→ 每日小计 → 末尾区间合计。
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
      lines.push('### 花费', '')
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
