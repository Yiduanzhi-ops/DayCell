/**
 * RecordStore 契约测试（CORE-API §4.2）。
 *
 * **同一份用例跑两个实现**：内存版与 IndexedDB 版。
 * 这是 ADR-0001 的硬要求——如果只有内存版通过，PRD E1 的降级路径就不可信；
 * 如果只有 idb 版通过，说明契约里混进了实现细节。
 *
 * IndexedDB 由 fake-indexeddb 提供（在 node 环境里跑，符合 ADR-0006）。
 */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DateKey, ExpenseRecord, NoteRecord, TodoRecord, CategoryRecord } from '../types'
import { createMemoryStore } from './memory'
import { createIdbStore } from './idb'
import type { RecordStore } from './types'
import { StorageUnavailableError } from '../errors'

const k = (s: string): DateKey => s as DateKey

let seq = 0

/** 固定时钟，让 updatedAt 可断言（ADR-0006 铁律 3） */
function fakeClock(start = 1_700_000_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms), set: (v: number) => (t = v) }
}

function todo(over: Partial<TodoRecord> & { id: string; date: DateKey }): TodoRecord {
  return {
    type: 'todo',
    text: '待办',
    done: false,
    createdAt: 1,
    updatedAt: 1,
    deleted: false,
    ...over,
  }
}

/** 一套契约用例，对两个实现各跑一遍 */
function describeStore(name: string, make: (clock: ReturnType<typeof fakeClock>) => Promise<RecordStore>) {
  describe(`RecordStore 契约 · ${name}`, () => {
    let store: RecordStore
    const clock = fakeClock()

    beforeEach(async () => {
      store = await make(clock)
      await store.init()
    })
    afterEach(() => store.close())

    it('put 后可以 get 回来，字段完整', async () => {
      const rec = todo({ id: 't1', date: k('2026-09-29'), text: '回客户邮件' })
      await store.put('todos', rec)
      const got = await store.get<TodoRecord>('todos', 't1')
      expect(got?.text).toBe('回客户邮件')
      expect(got?.date).toBe('2026-09-29')
      expect(got?.type).toBe('todo')
      expect(got?.deleted).toBe(false)
    })

    it('get 不存在的 id 返回 undefined 而不是抛错', async () => {
      expect(await store.get('todos', 'nope')).toBeUndefined()
    })

    it('返回的对象与库内隔离：改返回值不会污染存储', async () => {
      await store.put('todos', todo({ id: 't1', date: k('2026-09-29'), text: '原文' }))
      const got = await store.get<TodoRecord>('todos', 't1')
      got!.text = '被改了'
      const again = await store.get<TodoRecord>('todos', 't1')
      expect(again!.text).toBe('原文')
    })

    it('put 自动刷新 updatedAt（ADR-0001：漏传会破坏 LWW）', async () => {
      clock.set(1_700_000_000_000)
      await store.put('todos', todo({ id: 't1', date: k('2026-09-29'), updatedAt: 1 }))
      expect((await store.get<TodoRecord>('todos', 't1'))!.updatedAt).toBe(1_700_000_000_000)

      clock.advance(5000)
      await store.put('todos', { ...(await store.get<TodoRecord>('todos', 't1'))!, text: '改过了' })
      const after = await store.get<TodoRecord>('todos', 't1')
      expect(after!.updatedAt).toBe(1_700_000_005_000)
      expect(after!.text).toBe('改过了')
    })

    it('keepTimestamps=true 时保留原时间戳（导入备份必须如此）', async () => {
      clock.set(1_700_000_000_000)
      await store.put(
        'todos',
        todo({ id: 't1', date: k('2026-09-29'), createdAt: 42, updatedAt: 99 }),
        { keepTimestamps: true },
      )
      const got = await store.get<TodoRecord>('todos', 't1')
      expect(got!.createdAt).toBe(42)
      expect(got!.updatedAt).toBe(99) // 没有被刷成 now()
    })

    it('putMany 批量写入', async () => {
      const recs = [
        todo({ id: 'a', date: k('2026-09-29') }),
        todo({ id: 'b', date: k('2026-09-29') }),
        todo({ id: 'c', date: k('2026-09-30') }),
      ]
      const out = await store.putMany('todos', recs)
      expect(out).toHaveLength(3)
      expect(await store.get('todos', 'b')).toBeDefined()
    })

    describe('byDate', () => {
      beforeEach(async () => {
        await store.putMany('todos', [
          todo({ id: 'd1', date: k('2026-09-27'), text: '27 日', createdAt: 100 }),
          todo({ id: 'd2', date: k('2026-09-28'), text: '28 日', createdAt: 200 }),
          todo({ id: 'd3', date: k('2026-09-29'), text: '29 日', createdAt: 300 }),
          todo({ id: 'd4', date: k('2026-09-30'), text: '30 日', createdAt: 400 }),
          todo({ id: 'o1', date: k('2026-08-15'), text: '上个月', createdAt: 50 }),
          todo({ id: 'o2', date: k('2026-10-05'), text: '下个月', createdAt: 500 }),
        ])
      })

      it('闭区间：含首尾两端', async () => {
        const r = await store.byDate<TodoRecord>('todos', k('2026-09-28'), k('2026-09-29'))
        expect(r.map((x) => x.text)).toEqual(['28 日', '29 日'])
      })

      it('区间外的不返回', async () => {
        const r = await store.byDate<TodoRecord>('todos', k('2026-09-01'), k('2026-09-30'))
        expect(r).toHaveLength(4)
        expect(r.some((x) => x.text === '上个月')).toBe(false)
        expect(r.some((x) => x.text === '下个月')).toBe(false)
      })

      it('单日查询', async () => {
        const r = await store.byDate<TodoRecord>('todos', k('2026-09-29'), k('2026-09-29'))
        expect(r).toHaveLength(1)
        expect(r[0]!.text).toBe('29 日')
      })

      it('按 date 升序、同日按 createdAt 升序', async () => {
        await store.putMany('todos', [
          todo({ id: 's2', date: k('2026-09-29'), text: '同日晚', createdAt: 999 }),
          todo({ id: 's1', date: k('2026-09-29'), text: '同日早', createdAt: 111 }),
        ])
        const r = await store.byDate<TodoRecord>('todos', k('2026-09-29'), k('2026-09-29'))
        expect(r.map((x) => x.text)).toEqual(['同日早', '29 日', '同日晚'])
      })

      it('排除墓碑（软删除后查不到）', async () => {
        const d3 = (await store.get<TodoRecord>('todos', 'd3'))!
        await store.put('todos', { ...d3, deleted: true })
        const r = await store.byDate<TodoRecord>('todos', k('2026-09-01'), k('2026-09-30'))
        expect(r).toHaveLength(3)
        expect(r.some((x) => x.id === 'd3')).toBe(false)
      })

      it('墓碑仍在库里，get 能拿到（同步需要）', async () => {
        const d3 = (await store.get<TodoRecord>('todos', 'd3'))!
        await store.put('todos', { ...d3, deleted: true })
        expect((await store.get<TodoRecord>('todos', 'd3'))!.deleted).toBe(true)
      })

      it('空区间返回空数组', async () => {
        expect(await store.byDate('todos', k('2027-01-01'), k('2027-01-31'))).toEqual([])
      })

      it('from > to 返回空数组而不是抛错', async () => {
        expect(await store.byDate('todos', k('2026-09-30'), k('2026-09-01'))).toEqual([])
      })
    })

    it('byDateAll 一次取回三类内容（月/周视图的唯一入口）', async () => {
      await store.put('todos', todo({ id: 't1', date: k('2026-09-29'), text: '待办' }))
      await store.put('notes', {
        id: 'n1', type: 'note', date: k('2026-09-29'), text: '想法',
        createdAt: 1, updatedAt: 1, deleted: false,
      } satisfies NoteRecord)
      await store.put('expenses', {
        id: 'e1', type: 'expense', date: k('2026-09-29'), amountCents: 4500, catId: 'c1', note: '午饭',
        createdAt: 1, updatedAt: 1, deleted: false,
      } satisfies ExpenseRecord)
      await store.put('todos', todo({ id: 't2', date: k('2026-10-01'), text: '区间外' }))

      const r = await store.byDateAll(k('2026-09-29'), k('2026-09-29'))
      expect(r.todos.map((x) => x.id)).toEqual(['t1'])
      expect(r.notes.map((x) => x.id)).toEqual(['n1'])
      expect(r.expenses.map((x) => x.id)).toEqual(['e1'])
    })

    it('byDateAll 空库返回三个空数组', async () => {
      const r = await store.byDateAll(k('2026-09-01'), k('2026-09-30'))
      expect(r).toEqual({ todos: [], notes: [], expenses: [] })
    })

    describe('byUpdatedSince（为云同步预留）', () => {
      it('只返回 updatedAt 严格大于 since 的记录，按 updatedAt 升序', async () => {
        clock.set(1000)
        await store.put('todos', todo({ id: 'a', date: k('2026-09-29') }))
        clock.set(2000)
        await store.put('todos', todo({ id: 'b', date: k('2026-09-29') }))
        clock.set(3000)
        await store.put('todos', todo({ id: 'c', date: k('2026-09-29') }))

        const r = await store.byUpdatedSince<TodoRecord>('todos', 1500)
        expect(r.map((x) => x.id)).toEqual(['b', 'c'])
      })

      it('默认排除墓碑', async () => {
        clock.set(1000)
        await store.put('todos', todo({ id: 'a', date: k('2026-09-29') }))
        clock.set(2000)
        await store.put('todos', { ...(await store.get<TodoRecord>('todos', 'a'))!, deleted: true })

        expect(await store.byUpdatedSince('todos', 0)).toEqual([])
      })

      it('includeDeleted=true 时返回墓碑（导出整库需要）', async () => {
        clock.set(1000)
        await store.put('todos', todo({ id: 'a', date: k('2026-09-29') }))
        clock.set(2000)
        await store.put('todos', { ...(await store.get<TodoRecord>('todos', 'a'))!, deleted: true })

        const r = await store.byUpdatedSince<TodoRecord>('todos', 0, { includeDeleted: true })
        expect(r).toHaveLength(1)
        expect(r[0]!.deleted).toBe(true)
      })

      it('since=0 拿到全部', async () => {
        await store.putMany('todos', [
          todo({ id: 'a', date: k('2026-09-29') }),
          todo({ id: 'b', date: k('2026-09-30') }),
        ])
        expect(await store.byUpdatedSince('todos', 0)).toHaveLength(2)
      })
    })

    describe('all', () => {
      it('默认排除墓碑，includeDeleted 可拿到', async () => {
        await store.put('todos', todo({ id: 'a', date: k('2026-09-29') }))
        await store.put('todos', todo({ id: 'b', date: k('2026-09-29'), deleted: true }))
        expect(await store.all('todos')).toHaveLength(1)
        expect(await store.all('todos', { includeDeleted: true })).toHaveLength(2)
      })

      it('categories 按 order 升序返回', async () => {
        const mk = (id: string, nm: string, order: number): CategoryRecord => ({
          id, type: 'category', name: nm, order, createdAt: 1, updatedAt: 1, deleted: false,
        })
        // 乱序写入
        await store.putMany('categories', [mk('c3', '购物', 3), mk('c1', '餐饮', 1), mk('c2', '交通', 2)])
        const r = await store.all<CategoryRecord>('categories')
        expect(r.map((x) => x.name)).toEqual(['餐饮', '交通', '购物'])
      })
    })

    describe('tx 原子性', () => {
      it('回调内抛错 → 已写入的全部回滚', async () => {
        await store.put('todos', todo({ id: 'pre', date: k('2026-09-29'), text: '事务前' }))

        await expect(
          store.tx(async (scope) => {
            await scope.put('todos', todo({ id: 'x1', date: k('2026-09-29'), text: '事务内 1' }))
            await scope.put('notes', {
              id: 'x2', type: 'note', date: k('2026-09-29'), text: '事务内 2',
              createdAt: 1, updatedAt: 1, deleted: false,
            })
            throw new Error('模拟失败')
          }),
        ).rejects.toThrow('模拟失败')

        expect(await store.get('todos', 'x1')).toBeUndefined()
        expect(await store.get('notes', 'x2')).toBeUndefined()
        // 事务外的数据不受影响
        expect(await store.get('todos', 'pre')).toBeDefined()
      })

      it('回调正常返回 → 提交', async () => {
        const r = await store.tx(async (scope) => {
          await scope.put('todos', todo({ id: 'ok1', date: k('2026-09-29') }))
          return 'done'
        })
        expect(r).toBe('done')
        expect(await store.get('todos', 'ok1')).toBeDefined()
      })

      it('事务内可跨多个 store 写入（顺延场景）', async () => {
        await store.tx(async (scope) => {
          await scope.put('todos', todo({ id: 'src', date: k('2026-09-28'), rolledTo: k('2026-09-29') }))
          await scope.put('todos', todo({ id: 'dst', date: k('2026-09-29'), rolledFrom: k('2026-09-28') }))
        })
        expect((await store.get<TodoRecord>('todos', 'src'))!.rolledTo).toBe('2026-09-29')
        expect((await store.get<TodoRecord>('todos', 'dst'))!.rolledFrom).toBe('2026-09-28')
      })
    })

    describe('settings', () => {
      it('未设置时返回 fallback', async () => {
        expect(await store.getSetting('accentColor', '#2E4BA6')).toBe('#2E4BA6')
      })

      it('写入后可读回，且覆盖旧值', async () => {
        await store.putSetting('accentColor', '#2C6B57')
        expect(await store.getSetting('accentColor', '#2E4BA6')).toBe('#2C6B57')
        await store.putSetting('accentColor', '#B0512A')
        expect(await store.getSetting('accentColor', '')).toBe('#B0512A')
      })

      it('可存对象与布尔', async () => {
        await store.putSetting('weekStartsOn', 1)
        await store.putSetting('backupReminderOff', false)
        await store.putSetting('onboarded', { step: 2, at: 123 })
        expect(await store.getSetting('weekStartsOn', 0)).toBe(1)
        expect(await store.getSetting('backupReminderOff', true)).toBe(false)
        expect(await store.getSetting<{ step: number; at: number }>('onboarded', { step: 0, at: 0 })).toEqual({ step: 2, at: 123 })
      })

      it('allSettings 列出全部', async () => {
        await store.putSetting('accentColor', '#2E4BA6')
        await store.putSetting('onboarded', true)
        const all = await store.allSettings()
        expect(all.map((x) => x.key).sort()).toEqual(['accentColor', 'onboarded'])
        expect(all.every((x) => typeof x.updatedAt === 'number')).toBe(true)
      })
    })

    it('estimateUsage 返回 usage 与 quota', async () => {
      await store.put('todos', todo({ id: 'a', date: k('2026-09-29'), text: 'x'.repeat(200) }))
      const u = await store.estimateUsage()
      expect(typeof u.usage).toBe('number')
      expect(typeof u.quota).toBe('number')
      expect(u.quota).toBeGreaterThan(0)
    })

    it('clearAll 物理清空全部 store', async () => {
      await store.put('todos', todo({ id: 'a', date: k('2026-09-29') }))
      await store.putSetting('accentColor', '#000')
      await store.clearAll()
      expect(await store.get('todos', 'a')).toBeUndefined()
      expect(await store.all('todos')).toEqual([])
      expect(await store.getSetting('accentColor', null)).toBeNull()
    })

    it('重复 init 不报错', async () => {
      await store.init()
      await store.init()
      await store.put('todos', todo({ id: 'a', date: k('2026-09-29') }))
      expect(await store.get('todos', 'a')).toBeDefined()
    })
  })
}

// ---------------------------------------------------------------------------
// 两个实现跑同一套用例
// ---------------------------------------------------------------------------
describeStore('memory', async (clock) => createMemoryStore({ now: clock.now }))

describeStore('indexeddb (fake)', async (clock) =>
  createIdbStore({
    indexedDB: globalThis.indexedDB,
    // 每个测试实例用独立库名，否则 fake-indexeddb 会跨用例串数据
    dbName: `daycell-test-${++seq}-${Date.now()}`,
    now: clock.now,
  }),
)

// ---------------------------------------------------------------------------
// 只在特定实现上成立的降级行为
// ---------------------------------------------------------------------------
describe('memory 实现的降级语义（PRD E1）', () => {
  it('failInit 时抛 StorageUnavailableError，让 UI 能识别并降级', async () => {
    const s = createMemoryStore({ failInit: true })
    await expect(s.init()).rejects.toBeInstanceOf(StorageUnavailableError)
    s.close()
  })

  it('超出 quotaBytes 时抛 QuotaExceededError（PRD E2）', async () => {
    const s = createMemoryStore({ quotaBytes: 200 })
    await s.init()
    await expect(
      s.put('todos', todo({ id: 'a', date: k('2026-09-29'), text: 'x'.repeat(500) })),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
    s.close()
  })
})

describe('idb 实现的环境校验', () => {
  it('indexedDB 缺失时抛 StorageUnavailableError', async () => {
    await expect(
      createIdbStore({ indexedDB: undefined as unknown as IDBFactory }),
    ).rejects.toBeInstanceOf(StorageUnavailableError)
  })
})
