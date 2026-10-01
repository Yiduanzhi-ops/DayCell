/**
 * backup 模块测试（v7.5）：序列化 / 校验 / 合并导入 / Markdown 渲染。
 *
 * 合并口径（用户拍板，US-10 修订）：
 *  - 按 id 去重：本地已有 → 保留本地；备份新增 → 补入
 *  - 备份墓碑不导入
 *  - settings 本地优先，新 key 才补入
 *  - keepTimestamps 保留原始时间戳（last-write-wins 防反转）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { DateKey, TodoRecord } from '../types'
import { createMemoryStore } from '../store/memory'
import type { RecordStore } from '../store/types'
import { createFakeClock, type FakeClock } from '../clock'
import { createSeqIdGen } from '../id'
import { createRepos, type Repos } from '../repo'
import { BackupCorruptError } from '../errors'
import {
  serializeBackup,
  parseBackup,
  mergeBackup,
  renderRangeMd,
  type BackupFile,
  type MdDay,
} from './index'

const k = (s: string): DateKey => s as DateKey

let store: RecordStore
let repos: Repos
let clock: FakeClock

beforeEach(async () => {
  clock = createFakeClock(1_700_000_000_000)
  store = createMemoryStore({ now: clock })
  await store.init()
  repos = createRepos({ store, now: clock, idGen: createSeqIdGen() })
})

// ---------------------------------------------------------------------------
// serialize
// ---------------------------------------------------------------------------

describe('serializeBackup', () => {
  it('全量导出含墓碑与 settings', async () => {
    const t = await repos.todos.create(k('2026-09-29'), '写周报')
    await repos.todos.softDelete(t.id)
    await repos.notes.create(k('2026-09-29'), '想法一条')
    await repos.settings.set('onboarded', true)

    const file = await serializeBackup(store, clock)
    expect(file.app).toBe('daycell')
    expect(file.version).toBe(1)
    expect(file.schemaVersion).toBe(1)
    expect(file.exportedAt).toBe(1_700_000_000_000)
    // 墓碑也在备份里（完整还原现场）
    expect(file.data.todos).toHaveLength(1)
    expect(file.data.todos[0]!.deleted).toBe(true)
    expect(file.data.notes).toHaveLength(1)
    expect(file.data.settings.some((s) => s.key === 'onboarded')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

describe('parseBackup', () => {
  const good = (): BackupFile => ({
    app: 'daycell',
    version: 1,
    exportedAt: 1_700_000_000_000,
    schemaVersion: 1,
    data: {
      todos: [{ id: 'a', type: 'todo', date: k('2026-09-29'), text: 'x', done: false, createdAt: 1, updatedAt: 1, deleted: false }],
      notes: [],
      expenses: [],
      anniversaries: [],
      categories: [],
      settings: [],
    },
  })

  it('合法备份通过', () => {
    const f = parseBackup(JSON.stringify(good()))
    expect(f.data.todos).toHaveLength(1)
  })

  it('非 JSON 拒绝', () => {
    expect(() => parseBackup('not json')).toThrow(BackupCorruptError)
  })

  it('非 DayCell 文件拒绝', () => {
    expect(() => parseBackup(JSON.stringify({ ...good(), app: 'other' }))).toThrow(BackupCorruptError)
  })

  it('备份格式版本过新拒绝', () => {
    expect(() => parseBackup(JSON.stringify({ ...good(), version: 2 }))).toThrow(BackupCorruptError)
  })

  it('schema 版本不兼容拒绝', () => {
    expect(() => parseBackup(JSON.stringify({ ...good(), schemaVersion: 99 }))).toThrow(BackupCorruptError)
  })

  it('记录里混入非法数据 → 整体拒绝', () => {
    const f = good()
    f.data.todos = [{ id: 'a', type: 'note', date: 'x' }] as never
    expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupCorruptError)
  })

  it('settings 含未知 key → 拒绝', () => {
    const f = good()
    f.data.settings = [{ key: 'hacked', value: 1, updatedAt: 1 }] as never
    expect(() => parseBackup(JSON.stringify(f))).toThrow(BackupCorruptError)
  })
})

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

describe('mergeBackup（合并导入）', () => {
  it('新 id 补入、同 id 保留本地、墓碑不导入', async () => {
    // 本地已有一条 todo（id=1）
    const local = await repos.todos.create(k('2026-09-29'), '本地待办')
    // 备份文件：同 id=1 但不同文本 + 一条新 id + 一条墓碑 id
    const file: BackupFile = {
      app: 'daycell',
      version: 1,
      exportedAt: 2_000_000_000_000,
      schemaVersion: 1,
      data: {
        todos: [
          { ...local, text: '备份改过的文本', updatedAt: 9_999 },
          { id: 'backup-new', type: 'todo', date: k('2026-09-30'), text: '备份新增', done: false, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, deleted: false },
          { id: 'backup-tomb', type: 'todo', date: k('2026-09-28'), text: '已删', done: false, createdAt: 1, updatedAt: 1, deleted: true },
        ],
        notes: [],
        expenses: [],
        anniversaries: [],
        categories: [],
        settings: [],
      },
    }

    const stats = await mergeBackup(store, file)
    expect(stats.added.todos).toBe(1) // 只有 backup-new
    expect(stats.keptLocal).toBe(2) // 同 id 1 条 + 墓碑 1 条

    const all = await store.all<TodoRecord>('todos', { includeDeleted: true })
    expect(all).toHaveLength(2) // local + backup-new（墓碑不导入）
    const localNow = all.find((r) => r.id === local.id)!
    expect(localNow.text).toBe('本地待办') // 本地保留
    expect(localNow.updatedAt).toBe(local.updatedAt) // 时间戳也没被备份覆盖
    const added = all.find((r) => r.id === 'backup-new')!
    expect(added.updatedAt).toBe(1_800_000_000_000) // keepTimestamps：原始时间戳保留
  })

  it('settings：本地已有的 key 不覆盖，新 key 补入', async () => {
    await repos.settings.set('onboarded', false)
    const file: BackupFile = {
      app: 'daycell',
      version: 1,
      exportedAt: 1,
      schemaVersion: 1,
      data: {
        todos: [], notes: [], expenses: [], anniversaries: [], categories: [],
        settings: [
          { key: 'onboarded', value: true, updatedAt: 9_999 },
          { key: 'weekStartsOn', value: 0, updatedAt: 1 },
        ],
      },
    }
    const stats = await mergeBackup(store, file)
    expect(stats.settingsAdded).toBe(1)
    expect(await repos.settings.get('onboarded', false)).toBe(false) // 本地优先
    expect(await repos.settings.get('weekStartsOn', 1)).toBe(0) // 新 key 补入
  })

  it('全部与本地重复 → 空合并，不报错', async () => {
    const local = await repos.todos.create(k('2026-09-29'), 'x')
    const file: BackupFile = {
      app: 'daycell',
      version: 1,
      exportedAt: 1,
      schemaVersion: 1,
      data: {
        todos: [{ ...local }],
        notes: [], expenses: [], anniversaries: [], categories: [], settings: [],
      },
    }
    const stats = await mergeBackup(store, file)
    expect(stats.added.todos).toBe(0)
    const all = await store.all<TodoRecord>('todos', { includeDeleted: true })
    expect(all).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// renderRangeMd
// ---------------------------------------------------------------------------

describe('renderRangeMd', () => {
  const catName = (): string => '餐饮'
  const day = (date: string, over: Partial<MdDay> = {}): MdDay => ({
    date: k(date),
    todos: [],
    notes: [],
    expenses: [],
    catName,
    ...over,
  })

  it('渲染待办/想法/花费与小计合计', () => {
    const md = renderRangeMd('人生小格 · 本周记录', [
      day('2026-09-28', {
        todos: [
          { id: '1', type: 'todo', date: k('2026-09-28'), text: '写周报', done: true, createdAt: 1, updatedAt: 1, deleted: false },
          { id: '2', type: 'todo', date: k('2026-09-28'), text: '跑步', done: false, createdAt: 2, updatedAt: 2, deleted: false },
        ],
        notes: [{ id: '3', type: 'note', date: k('2026-09-28'), text: '风很大', createdAt: 1, updatedAt: 1, deleted: false }],
        expenses: [
          { id: '4', type: 'expense', date: k('2026-09-28'), amountCents: 1200, catId: 'c1', note: '', createdAt: 1, updatedAt: 1, deleted: false },
          { id: '5', type: 'expense', date: k('2026-09-28'), amountCents: 300, catId: 'c1', note: '地铁', createdAt: 2, updatedAt: 2, deleted: false },
        ],
      }),
    ])
    expect(md).toContain('# 人生小格 · 本周记录')
    expect(md).toContain('## 9月28日 周一')
    expect(md).toContain('- [x] 写周报')
    expect(md).toContain('- [ ] 跑步')
    expect(md).toContain('> 风很大')
    expect(md).toContain('- 餐饮 ¥12.00')
    expect(md).toContain('- 餐饮 ¥3.00（地铁）')
    expect(md).toContain('小计：¥15.00')
    expect(md).toContain('合计：¥15.00')
  })

  it('墓碑记录不出现', () => {
    const md = renderRangeMd('t', [
      day('2026-09-28', {
        todos: [
          { id: '1', type: 'todo', date: k('2026-09-28'), text: '已删', done: false, createdAt: 1, updatedAt: 1, deleted: true },
        ],
      }),
    ])
    expect(md).not.toContain('已删')
  })

  it('空区间给占位文案', () => {
    const md = renderRangeMd('t', [])
    expect(md).toContain('该区间没有记录')
  })
})
