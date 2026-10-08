/**
 * app/sync 集成测试（v8.1）：
 *  - wrapStoreForSync：写库后触发引擎防抖推送
 *  - 防循环：pull 合并写库期间（merging=true）触发的推送被引擎拦截，
 *    不产生额外 PUT——否则 拉取→写库→推送→另一端拉取 无限循环
 *
 * node 环境（无 DOM）：localStorage 用 typeof 守卫，本测试不触碰它。
 */

import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '@core/store/memory'
import { createSyncEngine, type SyncEngine, type WebDavConfig } from '@core'
import { wrapStoreForSync } from './sync'

const CFG: WebDavConfig = { url: 'https://dav.example.com/dav/daycell.json', user: 'u', pass: 'p' }
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

describe('wrapStoreForSync', () => {
  it('写库后触发防抖推送（一次变更只推一次）', async () => {
    vi.useFakeTimers()
    try {
      const store = createMemoryStore({ now: () => T0 })
      await store.init()
      const putCalls: string[] = []
      const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
        if (init?.method === 'PUT') {
          putCalls.push('x')
          return new Response('', { status: 201 })
        }
        return new Response('null', { status: 404 })
      }) as unknown as (input: string, init?: RequestInit) => Promise<Response>

      let engine: SyncEngine | null = null
      const wrapped = wrapStoreForSync(store, () => engine)
      engine = createSyncEngine({ store: wrapped, fetchImpl, clock: () => T0 })
      engine.configure(CFG)

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
    const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        putCalls.push('x')
        return new Response('', { status: 201 })
      }
      return new Response(remoteWith(999), { status: 200 })
    }) as unknown as (input: string, init?: RequestInit) => Promise<Response>

    let engine: SyncEngine | null = null
    const wrapped = wrapStoreForSync(store, () => engine)
    engine = createSyncEngine({ store: wrapped, fetchImpl, clock: () => T0 })
    engine.configure(CFG)

    // 本地已有同 id 但更旧的记录
    await wrapped.put('todos', rec('a', 100) as never, { keepTimestamps: true })

    await engine.pull() // 远端(999)更新 → 合并写库 → 包装层触发 schedulePush

    const all = await wrapped.all('todos', { includeDeleted: true })
    expect(all.find((r) => r.id === 'a')!.updatedAt).toBe(999) // 合并生效
    expect(putCalls).toHaveLength(0) // 但 merging 拦截了推送 → 无循环
  })
})
