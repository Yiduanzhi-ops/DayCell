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
  CoreRecord,
  DateKey,
  ExpenseRecord,
  NoteRecord,
  SettingKey,
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
  parseNoteText,
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
  /** isLunar=false → 公历 'YYYY-MM-DD'；isLunar=true → 农历月日（年份无意义） */
  date: string
  isLunar: boolean
  repeat: 'none' | 'yearly'
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
  settings: SettingRepo
}

export function createRepos(deps: RepoDeps): Repos {
  const store = deps.store
  const now = deps.now ?? systemClock
  const idGen = deps.idGen ?? createIdGen()

  type MutableStore = 'todos' | 'notes' | 'expenses' | 'anniversaries' | 'categories'

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

  const anniversaries: AnniversaryRepo = {
    all: () => store.all<AnniversaryRecord>('anniversaries'),

    async create(input) {
      const title = unwrap(parseAnniversaryTitle(input.title))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
        throw new ValidationError('BAD_DATE', '日期格式不正确')
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
      if (patch.repeat !== undefined) next.repeat = patch.repeat
      if (patch.isLeapMonth !== undefined) next.isLeapMonth = patch.isLeapMonth
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

  const settings: SettingRepo = {
    get: (key, fallback) => store.getSetting(key, fallback),
    set: (key, value) => store.putSetting(key, value),
  }

  return { todos, notes, expenses, anniversaries, categories, settings }
}

/** 便捷入口：从 store 里读金额时用，避免 UI 层出现 /100（ADR-0003） */
export function toYuan(cents: number): number {
  return cents / 100
}

/** 便捷入口：元字符串 → 分。UI 的输入框直接调这个，不要自己乘 100 */
export const toCents = (raw: string): ParseResult<number> => parseAmount(raw)
