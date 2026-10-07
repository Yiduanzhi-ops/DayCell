/**
 * 领域操作层（CORE-API §5.5）。
 *
 * repo 是 UI 与 store 之间唯一的一层：
 *  - UI 不得直接调 store（ESLint 已禁止深入 core 子模块）
 *  - repo 负责校验、构造记录、维护不变量（rolledTo 配对、墓碑、order 连续性）
 *  - 跨 store 的复合操作用 store.tx() 保证原子性
 *
 * 时间一律来自注入的 Clock（ADR-0006 铁律 3），id 一律来自注入的 IdGen。
 */

import type {
  AnniversaryRecord,
  CategoryRecord,
  CheckinRecord,
  CoreRecord,
  DateKey,
  ExpenseRecord,
  GoalRecord,
  HabitFreq,
  HabitRecord,
  NoteRecord,
  SettingKey,
  StageRecord,
  TodoRecord,
} from '../types'
import { NotFoundError, ValidationError } from '../errors'
import { systemClock, type Clock } from '../clock'
import { createIdGen, type IdGen } from '../id'
import type { RecordStore } from '../store/types'
import {
  parseAmount,
  parseAnniversaryTitle,
  parseCategoryName,
  parseDateKey,
  parseExpenseNote,
  parseGoalNote,
  parseGoalTitle,
  parseHabitFreq,
  parseHabitName,
  parseNoteText,
  parseStageNote,
  parseStageTitle,
  parseTodoText,
  type ParseResult,
} from '../validate'

/** 校验失败 → 抛 ValidationError（repo 是最后一道防线，见 errors.ts 的说明） */
function unwrap<T>(r: ParseResult<T>): T {
  if (!r.ok) throw new ValidationError(r.code, r.message)
  return r.value
}

export interface RepoDeps {
  store: RecordStore
  now?: Clock
  idGen?: IdGen
}

// ---------------------------------------------------------------------------
// 待办
// ---------------------------------------------------------------------------

export interface RollOverResult {
  /** 目标日新增的待办 */
  moved: TodoRecord[]
  /** 之前已顺延过、这次跳过的条数（PRD E11：同一条不顺延两次） */
  skipped: number
}

export interface TodoRepo {
  byDate(date: DateKey): Promise<TodoRecord[]>
  create(date: DateKey, text: string): Promise<TodoRecord>
  setText(id: string, text: string): Promise<TodoRecord>
  toggle(id: string): Promise<TodoRecord>
  softDelete(id: string): Promise<void>
  rollOver(from: DateKey, to: DateKey): Promise<RollOverResult>
  /** 是否有可顺延项；0 时 UI 不显示横幅（PRD E10） */
  rollableCount(date: DateKey): Promise<number>
}

/**
 * 待办进度。**排除已顺延出去的记录**（PRD US-04）：
 * 09-28 原有 3 条、完成 1 条 → 顺延 2 条后进度从 1/3 变成 1/1。
 * 纯函数，不查库。
 */
export function todoProgress(recs: TodoRecord[]): { done: number; total: number } {
  const active = recs.filter((r) => !r.rolledTo)
  return { done: active.filter((r) => r.done).length, total: active.length }
}

/** 可顺延的判定：未完成、且没有被顺延出去过 */
export const isRollable = (t: TodoRecord): boolean => !t.done && !t.rolledTo

// ---------------------------------------------------------------------------
// 想法
// ---------------------------------------------------------------------------

export interface NoteRepo {
  byDate(date: DateKey): Promise<NoteRecord[]>
  create(date: DateKey, text: string): Promise<NoteRecord>
  setText(id: string, text: string): Promise<NoteRecord>
  softDelete(id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 花费
// ---------------------------------------------------------------------------

export interface ExpenseInput {
  amountCents: number
  catId: string
  note?: string
}

export interface ExpenseRepo {
  byDate(date: DateKey): Promise<ExpenseRecord[]>
  create(date: DateKey, input: ExpenseInput): Promise<ExpenseRecord>
  update(id: string, patch: Partial<ExpenseInput>): Promise<ExpenseRecord>
  softDelete(id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 纪念日
// ---------------------------------------------------------------------------

export interface AnniversaryInput {
  title: string
  /**
   * date 的语义随 repeat（见 AnniversaryRecord 注释）：
   * - none / yearly：'YYYY-MM-DD'（农历时只看 MM-DD）
   * - monthly：'YYYY-MM-DD'，只取日号 DD
   * - weekly：'YYYY-MM-DD'，只取星期几（参考日期）
   */
  date: string
  isLunar: boolean
  /** v7.5 扩展：weekly（每周）/ monthly（每月）。weekly/monthly 仅公历 */
  repeat: 'none' | 'yearly' | 'monthly' | 'weekly'
  /** 农历闰月生日；该年无闰月时按同月号计（PRD E13） */
  isLeapMonth?: boolean
}

export interface AnniversaryRepo {
  all(): Promise<AnniversaryRecord[]>
  create(input: AnniversaryInput): Promise<AnniversaryRecord>
  update(id: string, patch: Partial<AnniversaryInput>): Promise<AnniversaryRecord>
  softDelete(id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 分类
// ---------------------------------------------------------------------------

/** PRD E24：首次启动预置的 8 个分类（PRD D8） */
export const DEFAULT_CATEGORIES = ['餐饮', '交通', '购物', '居住', '娱乐', '医疗', '学习', '其他'] as const

export interface CategoryRepo {
  all(): Promise<CategoryRecord[]>
  /** catId → 显示名的映射，供聚合层一次取完（避免逐笔查询） */
  nameMap(): Promise<Map<string, string>>
  /** 已删除或不存在的分类显示为「已删除分类」（PRD E21，不级联删除支出） */
  resolveName(id: string): Promise<string>
  create(name: string): Promise<CategoryRecord>
  rename(id: string, name: string): Promise<CategoryRecord>
  reorder(ids: string[]): Promise<void>
  softDelete(id: string): Promise<void>
  /** 库为空时播种默认分类；返回是否实际播种了 */
  seedDefaults(): Promise<boolean>
}

// ---------------------------------------------------------------------------
// 目标与阶段（v7.9）
// ---------------------------------------------------------------------------

export interface GoalInput {
  title: string
  note?: string
}

export interface GoalRepo {
  all(): Promise<GoalRecord[]>
  create(input: GoalInput): Promise<GoalRecord>
  update(id: string, patch: Partial<GoalInput>): Promise<GoalRecord>
  /** 目标整体完成/取消完成（v7.9 补：完成的目标沉底到「已完成」列表） */
  setDone(id: string, done: boolean): Promise<GoalRecord>
  /** 软删目标，**连带软删其全部阶段**（单事务） */
  softDelete(id: string): Promise<void>
}

export interface StageInput {
  goalId: string
  title: string
  /** 0–100 整数；undefined = 不填（无百分比语义） */
  pct?: number
  note?: string
}

export interface StageRepo {
  byGoal(goalId: string): Promise<StageRecord[]>
  /** 目标必须存在；**第一个阶段自动成为当前阶段** */
  create(input: StageInput): Promise<StageRecord>
  /** pct 传 null 表示显式清空；undefined 表示不改 */
  update(id: string, patch: Partial<Omit<StageInput, 'goalId' | 'pct'>> & { pct?: number | null }): Promise<StageRecord>
  /** 设为当前：同目标其他阶段自动取消 current（互斥） */
  setCurrent(id: string): Promise<StageRecord>
  setDone(id: string, done: boolean): Promise<StageRecord>
  softDelete(id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 习惯（v8.0）
// ---------------------------------------------------------------------------

export interface HabitInput {
  name: string
  freq: HabitFreq
}

export interface HabitRepo {
  /** 全部**活**习惯（含暂停的——设置页要显示；今日过滤在 aggregate） */
  all(): Promise<HabitRecord[]>
  create(input: HabitInput): Promise<HabitRecord>
  /** 可改 name / freq / paused */
  update(id: string, patch: Partial<HabitInput> & { paused?: boolean }): Promise<HabitRecord>
  softDelete(id: string): Promise<void>
}

/** 打卡（v8.0）：date + habitId 唯一；toggle 幂等 */
export interface CheckinRepo {
  /** date 上已打卡的 habitId 集合（含墓碑判断后的活记录） */
  doneOn(date: DateKey): Promise<Set<string>>
  /** 切换打卡：返回切换后是否已打卡。取消打卡 = 置墓碑（永不物理删除） */
  toggle(date: DateKey, habitId: string): Promise<boolean>
}

// ---------------------------------------------------------------------------
// 设置
// ---------------------------------------------------------------------------

export interface SettingRepo {
  get<T>(key: SettingKey, fallback: T): Promise<T>
  set<T>(key: SettingKey, value: T): Promise<void>
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

export interface Repos {
  todos: TodoRepo
  notes: NoteRepo
  expenses: ExpenseRepo
  anniversaries: AnniversaryRepo
  categories: CategoryRepo
  goals: GoalRepo
  stages: StageRepo
  habits: HabitRepo
  checkins: CheckinRepo
  settings: SettingRepo
}

export function createRepos(deps: RepoDeps): Repos {
  const store = deps.store
  const now = deps.now ?? systemClock
  const idGen = deps.idGen ?? createIdGen()

  type MutableStore = 'todos' | 'notes' | 'expenses' | 'anniversaries' | 'categories' | 'goals' | 'stages' | 'habits' | 'checkins'

  /** 取一条活记录；不存在或已是墓碑都算 NotFound（PRD E19：可能已被其他标签页删除） */
  const mustGet = async <T extends CoreRecord>(storeName: MutableStore, id: string): Promise<T> => {
    const rec = await store.get<T>(storeName, id)
    if (!rec || rec.deleted) throw new NotFoundError()
    return rec
  }

  const softDelete = (storeName: MutableStore) =>
    async function del(id: string): Promise<void> {
      const rec = await mustGet<CoreRecord>(storeName, id)
      // 墓碑：置 deleted 并刷新 updatedAt（put 自动刷）。**永不物理删除**（ADR-0001）
      await store.put(storeName, { ...rec, deleted: true } as never)
    }

  const todos: TodoRepo = {
    byDate: (date) => store.byDate<TodoRecord>('todos', date, date),

    async create(date, text) {
      unwrap(parseDateKey(date))
      const t = unwrap(parseTodoText(text))
      const ts = now()
      return store.put<TodoRecord>('todos', {
        id: idGen.next(),
        type: 'todo',
        date,
        text: t,
        done: false,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async setText(id, text) {
      const rec = await mustGet<TodoRecord>('todos', id)
      return store.put<TodoRecord>('todos', { ...rec, text: unwrap(parseTodoText(text)) })
    },

    async toggle(id) {
      const rec = await mustGet<TodoRecord>('todos', id)
      const done = !rec.done
      return store.put<TodoRecord>('todos', { ...rec, done, doneAt: done ? now() : undefined })
    },

    softDelete: softDelete('todos'),

    async rollOver(from, to) {
      unwrap(parseDateKey(from))
      unwrap(parseDateKey(to))
      const src = await store.byDate<TodoRecord>('todos', from, from)
      const candidates = src.filter(isRollable)
      const skipped = src.filter((t) => !t.done && t.rolledTo).length
      if (candidates.length === 0) return { moved: [], skipped }

      // 单事务：目标日的新记录 + 源记录的 rolledTo 标记必须同时生效，
      // 否则会出现"复制了但没标记" → 下次又顺延一遍
      const moved = await store.tx(async (scope) => {
        const created: TodoRecord[] = []
        const base = now()
        for (const [i, t] of candidates.entries()) {
          // ⚠️ **createdAt 必须逐条递增**，不能整批共用一个时间戳。
          // 顺延是一批同时写入，共用 ts 会让目标日的排序整个落到 sortDated 的 id 兜底上；
          // 生产环境 id 是 UUID，等于「顺延过来的待办顺序随机」，和昨天的顺序对不上
          // （PRD US-04 要的就是可追溯，顺序乱了就追溯不了）。
          // +i 毫秒既保序又不改变语义——一批写入本来就发生在同一瞬间。
          //
          // 用 keepTimestamps 是因为 put 默认把 updatedAt 刷成 now()，
          // 那样会得到 createdAt > updatedAt（记录在被创建之前就被修改了）。
          const ts = base + i
          created.push(
            await scope.put<TodoRecord>(
              'todos',
              {
                id: idGen.next(),
                type: 'todo',
                date: to,
                text: t.text,
                done: false,
                rolledFrom: from,
                createdAt: ts,
                updatedAt: ts,
                deleted: false,
              },
              { keepTimestamps: true },
            ),
          )
          await scope.put<TodoRecord>('todos', { ...t, rolledTo: to })
        }
        return created
      })
      return { moved, skipped }
    },

    async rollableCount(date) {
      const recs = await store.byDate<TodoRecord>('todos', date, date)
      return recs.filter(isRollable).length
    },
  }

  const notes: NoteRepo = {
    byDate: (date) => store.byDate<NoteRecord>('notes', date, date),

    async create(date, text) {
      unwrap(parseDateKey(date))
      const t = unwrap(parseNoteText(text))
      const ts = now()
      return store.put<NoteRecord>('notes', {
        id: idGen.next(),
        type: 'note',
        date,
        text: t,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async setText(id, text) {
      const rec = await mustGet<NoteRecord>('notes', id)
      return store.put<NoteRecord>('notes', { ...rec, text: unwrap(parseNoteText(text)) })
    },

    softDelete: softDelete('notes'),
  }

  const expenses: ExpenseRepo = {
    byDate: (date) => store.byDate<ExpenseRecord>('expenses', date, date),

    async create(date, input) {
      unwrap(parseDateKey(date))
      // amountCents 必须已经是整数分（ADR-0003）；这里再校一次范围，防调用方绕过 parseAmount
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
        throw new ValidationError('NOT_POSITIVE', '金额必须大于 0')
      }
      const ts = now()
      return store.put<ExpenseRecord>('expenses', {
        id: idGen.next(),
        type: 'expense',
        date,
        amountCents: input.amountCents,
        catId: input.catId,
        note: unwrap(parseExpenseNote(input.note ?? '')),
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async update(id, patch) {
      const rec = await mustGet<ExpenseRecord>('expenses', id)
      const next: ExpenseRecord = { ...rec }
      if (patch.amountCents !== undefined) {
        if (!Number.isSafeInteger(patch.amountCents) || patch.amountCents <= 0) {
          throw new ValidationError('NOT_POSITIVE', '金额必须大于 0')
        }
        next.amountCents = patch.amountCents
      }
      if (patch.catId !== undefined) next.catId = patch.catId
      if (patch.note !== undefined) next.note = unwrap(parseExpenseNote(patch.note))
      return store.put<ExpenseRecord>('expenses', next)
    },

    softDelete: softDelete('expenses'),
  }

  const annivRepeats = ['none', 'yearly', 'monthly', 'weekly'] as const
  const assertRepeat = (repeat: string): void => {
    // 运行时防御：weekly/monthly 只允许公历，农历只允许 none/yearly
    if (!(annivRepeats as readonly string[]).includes(repeat)) {
      throw new ValidationError('BAD_VALUE', '重复频率不正确')
    }
  }

  const anniversaries: AnniversaryRepo = {
    all: () => store.all<AnniversaryRecord>('anniversaries'),

    async create(input) {
      const title = unwrap(parseAnniversaryTitle(input.title))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
        throw new ValidationError('BAD_DATE', '日期格式不正确')
      }
      assertRepeat(input.repeat)
      if ((input.repeat === 'weekly' || input.repeat === 'monthly') && input.isLunar) {
        throw new ValidationError('BAD_VALUE', '每周/每月重复仅支持公历')
      }
      const ts = now()
      return store.put<AnniversaryRecord>('anniversaries', {
        id: idGen.next(),
        type: 'anniversary',
        title,
        date: input.date,
        isLunar: input.isLunar,
        repeat: input.repeat,
        isLeapMonth: input.isLeapMonth ?? false,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async update(id, patch) {
      const rec = await mustGet<AnniversaryRecord>('anniversaries', id)
      const next: AnniversaryRecord = { ...rec }
      if (patch.title !== undefined) next.title = unwrap(parseAnniversaryTitle(patch.title))
      if (patch.date !== undefined) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date)) {
          throw new ValidationError('BAD_DATE', '日期格式不正确')
        }
        next.date = patch.date
      }
      if (patch.isLunar !== undefined) next.isLunar = patch.isLunar
      if (patch.repeat !== undefined) {
        assertRepeat(patch.repeat)
        next.repeat = patch.repeat
      }
      if (patch.isLeapMonth !== undefined) next.isLeapMonth = patch.isLeapMonth
      // 组合校验放在合并之后：isLunar / repeat 任一被改都要按**最终值**检查
      if ((next.repeat === 'weekly' || next.repeat === 'monthly') && next.isLunar) {
        throw new ValidationError('BAD_VALUE', '每周/每月重复仅支持公历')
      }
      return store.put<AnniversaryRecord>('anniversaries', next)
    },

    softDelete: softDelete('anniversaries'),
  }

  const categories: CategoryRepo = {
    all: () => store.all<CategoryRecord>('categories'),

    async nameMap() {
      const all = await store.all<CategoryRecord>('categories')
      const m = new Map<string, string>()
      for (const c of all) m.set(c.id, c.name)
      return m
    },

    async resolveName(id) {
      const c = await store.get<CategoryRecord>('categories', id)
      // 已删除或不存在 → 固定文案（PRD E21）
      return c && !c.deleted ? c.name : '已删除分类'
    },

    async create(name) {
      const n = unwrap(parseCategoryName(name))
      const all = await store.all<CategoryRecord>('categories')
      const order = all.length === 0 ? 0 : Math.max(...all.map((c) => c.order)) + 1
      const ts = now()
      return store.put<CategoryRecord>('categories', {
        id: idGen.next(),
        type: 'category',
        name: n,
        order,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async rename(id, name) {
      const rec = await mustGet<CategoryRecord>('categories', id)
      return store.put<CategoryRecord>('categories', { ...rec, name: unwrap(parseCategoryName(name)) })
    },

    async reorder(ids) {
      await store.tx(async (scope) => {
        for (let i = 0; i < ids.length; i++) {
          const rec = await scope.get<CategoryRecord>('categories', ids[i]!)
          if (rec && !rec.deleted) await scope.put('categories', { ...rec, order: i })
        }
      })
    },

    softDelete: softDelete('categories'),

    async seedDefaults() {
      const existing = await store.all<CategoryRecord>('categories', { includeDeleted: true })
      if (existing.length > 0) return false
      const ts = now()
      await store.putMany<CategoryRecord>(
        'categories',
        DEFAULT_CATEGORIES.map((name, order) => ({
          id: idGen.next(),
          type: 'category' as const,
          name,
          order,
          createdAt: ts,
          updatedAt: ts,
          deleted: false,
        })),
      )
      return true
    },
  }

  const goals: GoalRepo = {
    all: () => store.all<GoalRecord>('goals'),

    async create(input) {
      const title = unwrap(parseGoalTitle(input.title))
      const note = unwrap(parseGoalNote(input.note ?? ''))
      const ts = now()
      return store.put<GoalRecord>('goals', {
        id: idGen.next(),
        type: 'goal',
        title,
        note,
        done: false,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async update(id, patch) {
      const rec = await mustGet<GoalRecord>('goals', id)
      const next: GoalRecord = { ...rec }
      if (patch.title !== undefined) next.title = unwrap(parseGoalTitle(patch.title))
      if (patch.note !== undefined) next.note = unwrap(parseGoalNote(patch.note))
      return store.put<GoalRecord>('goals', next)
    },

    async setDone(id, done) {
      const rec = await mustGet<GoalRecord>('goals', id)
      return store.put<GoalRecord>('goals', { ...rec, done })
    },

    async softDelete(id) {
      const rec = await mustGet<GoalRecord>('goals', id)
      // 单事务：目标 + 其全部阶段一起软删（墓碑永不物理删除）
      await store.tx(async (scope) => {
        await scope.put<GoalRecord>('goals', { ...rec, deleted: true } as never)
        const stages = await scope.all<StageRecord>('stages')
        for (const s of stages) {
          if (s.goalId === id && !s.deleted) {
            await scope.put<StageRecord>('stages', { ...s, deleted: true })
          }
        }
      })
    },
  }

  /** 0–100 整数校验（repo 最后防线；UI 已用 parsePct 预检） */
  const assertPct = (pct: number): void => {
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
      throw new ValidationError('BAD_VALUE', '进度必须是 0–100 的整数')
    }
  }

  const stages: StageRepo = {
    byGoal: (goalId) => {
      return (async () => {
        const all = await store.all<StageRecord>('stages')
        return all.filter((s) => s.goalId === goalId)
      })()
    },

    async create(input) {
      // 目标必须存在且未删——否则会出现"挂在幽灵目标下的阶段"
      await mustGet<GoalRecord>('goals', input.goalId)
      const title = unwrap(parseStageTitle(input.title))
      const note = unwrap(parseStageNote(input.note ?? ''))
      if (input.pct !== undefined) assertPct(input.pct)
      const ts = now()
      // 第一个阶段自动成为当前（用户口径：建完就有"当前"，无需再设）
      const siblings = await stages.byGoal(input.goalId)
      const isFirst = siblings.length === 0
      return store.put<StageRecord>('stages', {
        id: idGen.next(),
        type: 'stage',
        goalId: input.goalId,
        title,
        pct: input.pct,
        note,
        done: false,
        isCurrent: isFirst,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async update(id, patch) {
      const rec = await mustGet<StageRecord>('stages', id)
      const next: StageRecord = { ...rec }
      if (patch.title !== undefined) next.title = unwrap(parseStageTitle(patch.title))
      if (patch.note !== undefined) next.note = unwrap(parseStageNote(patch.note))
      // null = 显式清空；undefined = 不改
      if (patch.pct !== undefined) {
        if (patch.pct === null) next.pct = undefined
        else {
          assertPct(patch.pct)
          next.pct = patch.pct
        }
      }
      return store.put<StageRecord>('stages', next)
    },

    async setCurrent(id) {
      const rec = await mustGet<StageRecord>('stages', id)
      // 互斥：同目标所有阶段 current 清掉，再给目标阶段置位（单事务）
      await store.tx(async (scope) => {
        const all = await scope.all<StageRecord>('stages')
        for (const s of all) {
          if (s.goalId === rec.goalId && s.isCurrent) {
            await scope.put<StageRecord>('stages', { ...s, isCurrent: false })
          }
        }
        await scope.put<StageRecord>('stages', { ...rec, isCurrent: true, done: false })
      })
      return { ...rec, isCurrent: true, done: false }
    },

    async setDone(id, done) {
      const rec = await mustGet<StageRecord>('stages', id)
      return store.put<StageRecord>('stages', { ...rec, done })
    },

    softDelete: softDelete('stages'),
  }

  const habits: HabitRepo = {
    all: () => store.all<HabitRecord>('habits'),

    async create(input) {
      const name = unwrap(parseHabitName(input.name))
      const freq = unwrap(parseHabitFreq(input.freq))
      const ts = now()
      return store.put<HabitRecord>('habits', {
        id: idGen.next(),
        type: 'habit',
        name,
        freq,
        paused: false,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
    },

    async update(id, patch) {
      const rec = await mustGet<HabitRecord>('habits', id)
      const next: HabitRecord = { ...rec }
      if (patch.name !== undefined) next.name = unwrap(parseHabitName(patch.name))
      if (patch.freq !== undefined) next.freq = unwrap(parseHabitFreq(patch.freq))
      if (patch.paused !== undefined) next.paused = patch.paused
      return store.put<HabitRecord>('habits', next)
    },

    softDelete: softDelete('habits'),
  }

  const checkins: CheckinRepo = {
    async doneOn(date) {
      unwrap(parseDateKey(date))
      // 打卡表很小（每天每习惯一条），全表扫 + 内存过滤即可；
      // 不走 byDateAll 热路径（那是 todos/notes/expenses 的月/周聚合纪律，见 aggregate 注释）
      const all = await store.all<CheckinRecord>('checkins', { includeDeleted: true })
      const out = new Set<string>()
      for (const c of all) {
        if (!c.deleted && c.date === date) out.add(c.habitId)
      }
      return out
    },

    async toggle(date, habitId) {
      unwrap(parseDateKey(date))
      const all = await store.all<CheckinRecord>('checkins', { includeDeleted: true })
      const rec = all.find((c) => c.habitId === habitId && c.date === date)
      if (rec) {
        // 墓碑复活 = 再打卡；活记录 = 取消打卡（置墓碑，永不物理删除）
        // 返回"切换后是否已打卡"：rec.deleted=true（墓碑）→ 复活后已打卡 → true
        const next = { ...rec, deleted: !rec.deleted }
        await store.put<CheckinRecord>('checkins', next)
        return rec.deleted
      }
      const ts = now()
      await store.put<CheckinRecord>('checkins', {
        id: idGen.next(),
        type: 'checkin',
        habitId,
        date,
        createdAt: ts,
        updatedAt: ts,
        deleted: false,
      })
      return true
    },
  }

  const settings: SettingRepo = {
    get: (key, fallback) => store.getSetting(key, fallback),
    set: (key, value) => store.putSetting(key, value),
  }

  return { todos, notes, expenses, anniversaries, categories, goals, stages, habits, checkins, settings }
}

/** 便捷入口：从 store 里读金额时用，避免 UI 层出现 /100（ADR-0003） */
export function toYuan(cents: number): number {
  return cents / 100
}

/** 便捷入口：元字符串 → 分。UI 的输入框直接调这个，不要自己乘 100 */
export const toCents = (raw: string): ParseResult<number> => parseAmount(raw)
