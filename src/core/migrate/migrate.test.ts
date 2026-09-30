/**
 * migrate 层测试。
 *
 * 真实的 `MIGRATIONS` 现在是**空的**（v1 是基线版本），所以链条逻辑全部用
 * `createMigrator` 注入合成迁移来测——这正是把它做成工厂的原因。
 * 等真的加 v2 时，这里的用例已经证明了机器是对的，只需要再补一条 v1→v2 的数据断言。
 *
 * 覆盖重点：
 *  - **纯函数**：入参绝不被改动，哪怕迁移函数自己乱改
 *  - 六种失败模式都要抛 `MigrationFailedError`，且入参依然完好（调用方才能回滚）
 *  - `settings` 表不是 `CoreRecord` 形状，必须原样穿过迁移（守 RecordTable 那个类型修正）
 */
import { describe, expect, it } from 'vitest'
import { MigrationFailedError } from '../errors'
import {
  SCHEMA_VERSION,
  type CategoryRecord,
  type DateKey,
  type RecordTable,
  type SettingRecord,
  type TodoRecord,
} from '../types'

const k = (s: string): DateKey => s as DateKey
import {
  MIGRATIONS,
  applyMigrations,
  assertChainComplete,
  createMigrator,
  emptyTables,
  migrationPath,
  type Migration,
} from './index'

/** 一份"v1 的 fixture"：六个表都有东西，形状各不相同 */
function fixture(): RecordTable {
  const base = { createdAt: 1000, updatedAt: 2000, deleted: false }
  const t = emptyTables()
  t.todos.push({ id: 't1', type: 'todo', date: k('2026-09-29'), text: '待办一', done: false, ...base } as TodoRecord)
  t.todos.push({ id: 't2', type: 'todo', date: k('2026-09-29'), text: '已删的', done: false, ...base, deleted: true } as TodoRecord)
  t.notes.push({ id: 'n1', type: 'note', date: k('2026-09-29'), text: '想法', ...base })
  t.expenses.push({ id: 'e1', type: 'expense', date: k('2026-09-29'), amountCents: 2850, catId: 'c1', note: '午饭', ...base })
  t.anniversaries.push({ id: 'a1', type: 'anniversary', title: '妈妈生日', date: '2000-10-02', isLunar: true, repeat: 'yearly', ...base })
  t.categories.push({ id: 'c1', type: 'category', name: '餐饮', order: 0, ...base } as CategoryRecord)
  // ⚠️ settings 不是 CoreRecord：没有 id / createdAt / deleted
  t.settings.push({ key: 'weekStartsOn', value: 1, updatedAt: 2000 } as SettingRecord)
  return t
}

/** 合成迁移：给每条待办的文本加个前缀，用来验证"真的跑过了"与"按顺序跑" */
const tag = (mark: string): Migration => ({
  from: 0,
  to: 0,
  up: (r) => ({
    ...r,
    todos: r.todos.map((x) => ({ ...x, text: `${mark}:${x.text}` })),
  }),
})

function chain(...steps: Array<[number, number]>): Migration[] {
  return steps.map(([from, to], i) => ({ ...tag(`v${to}`), from, to, up: tag(`step${i + 1}`).up }))
}

// ===========================================================================

describe('真实迁移表（当前为空）', () => {
  it('v1 是基线：MIGRATIONS 为空，SCHEMA_VERSION 为 1', () => {
    expect(MIGRATIONS).toEqual([])
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('★ 测试契约 §7.5：能从 v1 的 fixture 一路迁到当前版本', () => {
    expect(() => assertChainComplete()).not.toThrow()
    const out = applyMigrations(fixture(), 1, SCHEMA_VERSION)
    expect(out).toEqual(fixture())
  })

  it('migrationPath(1,1) 是空链；applyMigrations 返回**副本**而非同一引用', () => {
    expect(migrationPath(1, 1)).toEqual([])
    const src = fixture()
    const out = applyMigrations(src, 1, 1)
    expect(out).toEqual(src)
    expect(out).not.toBe(src)
    expect(out.todos).not.toBe(src.todos)
    expect(out.todos[0]).not.toBe(src.todos[0])
  })

  it('emptyTables 每次返回全新数组，不共享引用', () => {
    const a = emptyTables()
    const b = emptyTables()
    a.todos.push({ id: 'x' } as TodoRecord)
    expect(b.todos).toHaveLength(0)
    expect(a.notes).not.toBe(b.notes)
  })
})

describe('多步迁移（合成链）', () => {
  const m = createMigrator(chain([1, 2], [2, 3]))

  it('按顺序应用，两步都留下了痕迹', () => {
    const out = m.apply(fixture(), 1, 3)
    expect(out.todos[0]!.text).toBe('step2:step1:待办一')
  })

  it('path 返回完整的链', () => {
    expect(m.path(1, 3)).toHaveLength(2)
    expect(m.path(1, 3).map((x) => `${x.from}→${x.to}`)).toEqual(['1→2', '2→3'])
    expect(m.path(2, 3)).toHaveLength(1)
    expect(m.path(1, 1)).toEqual([])
  })

  it('从中间版本起步也可以（导入旧备份的场景）', () => {
    const out = m.apply(fixture(), 2, 3)
    expect(out.todos[0]!.text).toBe('step2:待办一')
  })

  it('跨版本的迁移（v1→v3 一步到位）也能走通', () => {
    const jump = createMigrator([{ ...tag('jump'), from: 1, to: 3 }])
    expect(jump.path(1, 3)).toHaveLength(1)
    expect(jump.apply(fixture(), 1, 3).todos[0]!.text).toBe('jump:待办一')
  })
})

describe('★ 纯函数：入参绝不被改动', () => {
  it('迁移函数就地改了自己的入参，调用方的数据仍然完好', () => {
    const dirty: Migration = {
      from: 1,
      to: 2,
      up: (r) => {
        // 故意作恶：就地改数组、改记录、还删了一个表的内容
        r.todos[0]!.text = '被就地改坏了'
        r.todos.push({ id: 'injected' } as TodoRecord)
        r.settings.length = 0
        return r
      },
    }
    const src = fixture()
    const snapshot = JSON.parse(JSON.stringify(src)) as RecordTable

    const out = createMigrator([dirty]).apply(src, 1, 2)

    // 入参照旧（这是导入流程能回滚的前提）
    expect(src).toEqual(snapshot)
    // 且输出确实反映了迁移的改动
    expect(out.todos[0]!.text).toBe('被就地改坏了')
    expect(out.todos).toHaveLength(3)
  })

  it('上一步的输出被下一步就地改，也不会串味', () => {
    const m = createMigrator(chain([1, 2], [2, 3]))
    const src = fixture()
    const snapshot = JSON.parse(JSON.stringify(src)) as RecordTable
    m.apply(src, 1, 3)
    expect(src).toEqual(snapshot)
  })

  it('墓碑记录原样穿过迁移（迁移不该"顺手清理"数据）', () => {
    const out = createMigrator(chain([1, 2])).apply(fixture(), 1, 2)
    expect(out.todos).toHaveLength(2)
    expect(out.todos[1]!.deleted).toBe(true)
  })

  it('★ settings 表原样穿过——它不是 CoreRecord 形状', () => {
    const out = createMigrator(chain([1, 2], [2, 3])).apply(fixture(), 1, 3)
    expect(out.settings).toEqual([{ key: 'weekStartsOn', value: 1, updatedAt: 2000 }])
    // 迁移不得给它补上 id / deleted 之类 CoreRecord 的字段
    expect(Object.keys(out.settings[0]!).sort()).toEqual(['key', 'updatedAt', 'value'])
  })
})

describe('失败模式（全部抛 MigrationFailedError，且入参完好）', () => {
  const m = createMigrator(chain([1, 2], [2, 3]))

  it('降级：from > to', () => {
    expect(() => m.path(3, 1)).toThrow(MigrationFailedError)
    expect(() => m.path(3, 1)).toThrow(/不支持降级/)
  })

  it('链条断裂：缺中间那一步', () => {
    const gapped = createMigrator(chain([1, 2], [3, 4]))
    expect(() => gapped.path(1, 4)).toThrow(/缺少从 v2 出发的迁移步骤/)
  })

  it('链条越过目标：有 v1→v3 却要求升到 v2', () => {
    const jump = createMigrator([{ ...tag('j'), from: 1, to: 3 }])
    expect(() => jump.path(1, 2)).toThrow(/越过了目标版本/)
  })

  it('版本号非法：0 / 负数 / 小数 / NaN', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => m.path(bad, 3)).toThrow(MigrationFailedError)
      expect(() => m.path(1, bad)).toThrow(MigrationFailedError)
    }
  })

  it('up() 抛错 → 包成 MigrationFailedError 并保留 cause', () => {
    const boom = new RangeError('炸了')
    const bad: Migration = {
      from: 1,
      to: 2,
      up: () => {
        throw boom
      },
    }
    let caught: unknown
    try {
      createMigrator([bad]).apply(fixture(), 1, 2)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MigrationFailedError)
    expect((caught as MigrationFailedError).message).toMatch(/v1 → v2 迁移执行失败/)
    expect((caught as Error).cause).toBe(boom) // 原始错误不能丢，否则没法排查
  })

  it('up() 少返回一个表 → 报错并点名缺哪个', () => {
    const partial: Migration = {
      from: 1,
      to: 2,
      up: (r) => ({ ...r, settings: undefined as unknown as SettingRecord[] }),
    }
    expect(() => createMigrator([partial]).apply(fixture(), 1, 2)).toThrow(/缺少这些表：settings/)
  })

  it('up() 返回的不是对象 → 报错', () => {
    const nope: Migration = { from: 1, to: 2, up: () => null as unknown as RecordTable }
    expect(() => createMigrator([nope]).apply(fixture(), 1, 2)).toThrow(/没有返回记录表/)
  })

  it('★ 失败时入参依然完好，调用方才能回滚（PRD §6.4）', () => {
    const src = fixture()
    const snapshot = JSON.parse(JSON.stringify(src)) as RecordTable
    const bad: Migration = {
      from: 1,
      to: 2,
      up: (r) => {
        r.todos.length = 0 // 先搞破坏
        throw new Error('然后失败')
      },
    }
    expect(() => createMigrator([bad]).apply(src, 1, 2)).toThrow(MigrationFailedError)
    expect(src).toEqual(snapshot)
  })

  it('传入 undefined 当记录表也不炸（当作空库）', () => {
    const out = m.apply(undefined as unknown as RecordTable, 1, 3)
    expect(out).toEqual(emptyTables())
  })
})

describe('迁移表自身的合法性（构造时即检查）', () => {
  it('同一个 from 有两条出路 → 构造时就抛', () => {
    expect(() => createMigrator(chain([1, 2], [1, 3]))).toThrow(/两条出路/)
  })

  it('to <= from（不是升级）→ 构造时就抛', () => {
    expect(() => createMigrator([{ ...tag('x'), from: 2, to: 2 }])).toThrow(/不是升级/)
    expect(() => createMigrator([{ ...tag('x'), from: 3, to: 2 }])).toThrow(/不是升级/)
  })

  it('assertChainComplete 可以指定目标版本，用于测合成链', () => {
    const m = createMigrator(chain([1, 2], [2, 3]))
    expect(() => m.assertChainComplete(3)).not.toThrow()
    expect(() => m.assertChainComplete(4)).toThrow(/缺少从 v3 出发/)
  })
})
