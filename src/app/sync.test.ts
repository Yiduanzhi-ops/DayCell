/**
 * app/sync 集成测试（v8.1/v8.2）：
 *  - wrapStoreForSync：写库后触发引擎防抖推送
 *  - 防循环：pull 合并写库期间（merging=true）触发的推送被引擎拦截，
 *    不产生额外推送——否则 拉取→写库→推送→另一端拉取 无限循环
 *
 * node 环境（无 DOM）：localStorage 用 typeof 守卫，本测试不触碰它。
 */

import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '@core/store/memory'
import { createSyncEngine, type SyncEngine, type SyncTransport } from '@core'
import { wrapStoreForSync } from './sync'

const T0 = 1_000_000_000_000

const rec = (id: string, updatedAt: number): { id: string; type: string; updatedAt: number; deleted: boolean } => ({
  id,
  type: 'todo',
  updatedAt,
  deleted: false,
})

const remoteWith = (todoUpdatedAt: number): string =>
  JSON.stringify({
    app: 'daycell',
    version: 1,
    exportedAt: T0,
    schemaVersion: 1,
    data: {
      todos: [rec('a', todoUpdatedAt)],
      notes: [], expenses: [], anniversaries: [], categories: [], goals: [], stages: [], habits: [], checkins: [],
      settings: [],
    },
  })

/** fake transport：fetchFile 返回远端内容，putFile 记数 */
const fakeTransport = (remote: string | null, putCalls: string[]): SyncTransport => ({
  fetchFile: vi.fn(async () => remote),
  putFile: vi.fn(async (text: string) => {
    putCalls.push(text)
  }),
})

describe('wrapStoreForSync', () => {
  it('写库后触发防抖推送（一次变更只推一次）', async () => {
    vi.useFakeTimers()
    try {
      const store = createMemoryStore({ now: () => T0 })
      await store.init()
      const putCalls: string[] = []

      let engine: SyncEngine | null = null
      const wrapped = wrapStoreForSync(store, () => engine)
      engine = createSyncEngine({ store: wrapped, clock: () => T0, transport: fakeTransport(null, putCalls) })

      await wrapped.put('todos', rec('a', 100) as never, { keepTimestamps: true })
      await wrapped.put('todos', rec('b', 100) as never, { keepTimestamps: true })
      expect(putCalls).toHaveLength(0) // 防抖窗口内不推
      vi.advanceTimersByTime(4000)
      await vi.runAllTimersAsync()
      expect(putCalls).toHaveLength(1) // 合并为一次
    } finally {
      vi.useRealTimers()
    }
  })

  it('防循环：pull 合并写库不触发推送（无额外 PUT）', async () => {
    const store = createMemoryStore({ now: () => T0 })
    await store.init()
    const putCalls: string[] = []

    let engine: SyncEngine | null = null
    const wrapped = wrapStoreForSync(store, () => engine)
    engine = createSyncEngine({
      store: wrapped,
      clock: () => T0,
      transport: fakeTransport(remoteWith(999), putCalls),
    })

    // 本地已有同 id 但更旧的记录
    await wrapped.put('todos', rec('a', 100) as never, { keepTimestamps: true })

    await engine.pull() // 远端(999)更新 → 合并写库 → 包装层触发 schedulePush

    const all = await wrapped.all('todos', { includeDeleted: true })
    expect(all.find((r) => r.id === 'a')!.updatedAt).toBe(999) // 合并生效
    expect(putCalls).toHaveLength(0) // 但 merging 拦截了推送 → 无循环
  })
})
