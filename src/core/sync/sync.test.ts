/**
 * core/sync 单元测试：WebDAV 客户端 + 同步合并 + 引擎（v8.1）。
 *
 * 全部走注入（fetch mock / memory store / 固定时钟），不碰 DOM、不碰网络。
 */

import { describe, expect, it, vi } from 'vitest'
import { createMemoryStore } from '../store/memory'
import { parseBackup, serializeBackup } from '../backup'
import { createWebDavClient, assertWebDavConfig, type WebDavConfig } from './webdav'
import { mergeByUpdated, mergeSettings, mergeTables } from './merge'
import { createSyncEngine, type SyncEngine } from './engine'
import { WebDavError } from '../errors'
import type { DateKey, RecordTable, SettingRecord, TodoRecord } from '../types'

const CFG: WebDavConfig = { url: 'https://dav.example.com/dav/daycell.json', user: 'u@example.com', pass: 'app-pass' }

const rec = (
  id: string,
  type: string,
  updatedAt: number,
  extra: Record<string, unknown> = {},
): { id: string; type: string; updatedAt: number; deleted: boolean; [k: string]: unknown } => ({
  id,
  type,
  updatedAt,
  deleted: false,
  ...extra,
})

/** 完整 TodoRecord（RecordTable 字面量需要） */
const todoRec = (id: string, updatedAt: number): TodoRecord => ({
  id,
  type: 'todo',
  createdAt: updatedAt - 1,
  updatedAt,
  deleted: false,
  text: `todo-${id}`,
  done: false,
  date: '2026-01-01' as DateKey,
})

// ---------------------------------------------------------------------------
// webdav.ts
// ---------------------------------------------------------------------------

describe('assertWebDavConfig', () => {
  it('合法配置通过', () => {
    expect(() => assertWebDavConfig(CFG)).not.toThrow()
  })
  it('缺字段抛 WebDavError', () => {
    expect(() => assertWebDavConfig({ ...CFG, pass: '' })).toThrow(WebDavError)
  })
  it('非法 URL 抛 WebDavError', () => {
    expect(() => assertWebDavConfig({ ...CFG, url: 'not-a-url' })).toThrow(WebDavError)
  })
})

describe('createWebDavClient', () => {
  type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
  const mockFetch = (status: number, body = ''): ReturnType<typeof vi.fn> =>
    vi.fn(async () => new Response(body, { status }))
  const asFetch = (f: ReturnType<typeof vi.fn>): FetchLike => f as unknown as FetchLike

  it('GET 404 → null（云端尚无文件）', async () => {
    const fetchImpl = mockFetch(404)
    const c = createWebDavClient(CFG, { fetchImpl: asFetch(fetchImpl) })
    await expect(c.fetchFile()).resolves.toBeNull()
  })

  it('GET 200 返回正文，且带 Basic Auth', async () => {
    const fetchImpl = mockFetch(200, '{"hello":1}')
    const c = createWebDavClient(CFG, { fetchImpl: asFetch(fetchImpl) })
    await expect(c.fetchFile()).resolves.toBe('{"hello":1}')
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${btoa('u@example.com:app-pass')}`,
    )
  })

  it('GET 401 抛 WebDavError 并带状态码文案', async () => {
    const c = createWebDavClient(CFG, { fetchImpl: asFetch(mockFetch(401)) })
    await expect(c.fetchFile()).rejects.toThrow('HTTP 401')
  })

  it('PUT 成功；失败（500）抛 WebDavError', async () => {
    const ok = createWebDavClient(CFG, { fetchImpl: asFetch(mockFetch(201)) })
    await expect(ok.putFile('{}')).resolves.toBeUndefined()
    const bad = createWebDavClient(CFG, { fetchImpl: asFetch(mockFetch(500)) })
    await expect(bad.putFile('{}')).rejects.toThrow('HTTP 500')
  })
})

// ---------------------------------------------------------------------------
// merge.ts
// ---------------------------------------------------------------------------

describe('mergeByUpdated', () => {
  it('同 id 取 updatedAt 较新者', () => {
    const local = [rec('a', 'todo', 100), rec('b', 'todo', 50)]
    const remote = [rec('a', 'todo', 200), rec('c', 'todo', 80)]
    const out = mergeByUpdated(local, remote)
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b', 'c'])
    expect(out.find((r) => r.id === 'a')!.updatedAt).toBe(200)
  })

  it('两端独立新增互不覆盖', () => {
    const out = mergeByUpdated([rec('x', 'todo', 1)], [rec('y', 'todo', 1)])
    expect(out.map((r) => r.id).sort()).toEqual(['x', 'y'])
  })

  it('较新的墓碑同步删除（本地活记录 < 远端墓碑）', () => {
    const out = mergeByUpdated([rec('a', 'todo', 100)], [{ ...rec('a', 'todo', 300), deleted: true }])
    expect(out.find((r) => r.id === 'a')!.deleted).toBe(true)
  })

  it('远端独有墓碑被跳过（本地从无此 id）', () => {
    const out = mergeByUpdated([], [{ ...rec('ghost', 'todo', 300), deleted: true }])
    expect(out).toEqual([])
  })

  it('本地墓碑保留（本地独有）', () => {
    const out = mergeByUpdated([{ ...rec('a', 'todo', 100), deleted: true }], [])
    expect(out.find((r) => r.id === 'a')!.deleted).toBe(true)
  })
})

describe('mergeSettings', () => {
  it('同 key 取较新，异 key 合并', () => {
    const local: SettingRecord[] = [
      { key: 'accentColor', value: 'red', updatedAt: 100 },
      { key: 'onboarded', value: true, updatedAt: 50 },
    ]
    const remote: SettingRecord[] = [
      { key: 'accentColor', value: 'blue', updatedAt: 200 },
      { key: 'weekStartsOn', value: 1, updatedAt: 10 },
    ]
    const out = mergeSettings(local, remote)
    expect(out.find((s) => s.key === 'accentColor')!.value).toBe('blue')
    expect(out.find((s) => s.key === 'onboarded')!.value).toBe(true)
    expect(out.find((s) => s.key === 'weekStartsOn')!.value).toBe(1)
  })
})

describe('mergeTables', () => {
  it('整表合并，settings 走独立规则', () => {
    const local: RecordTable = {
      todos: [todoRec('a', 100)],
      notes: [],
      expenses: [],
      anniversaries: [],
      categories: [],
      goals: [],
      stages: [],
      habits: [],
      checkins: [],
      settings: [{ key: 'accentColor', value: 'red', updatedAt: 100 }],
    }
    const remote: RecordTable = {
      todos: [todoRec('a', 50), todoRec('b', 60)],
      notes: [],
      expenses: [],
      anniversaries: [],
      categories: [],
      goals: [],
      stages: [],
      habits: [],
      checkins: [],
      settings: [{ key: 'accentColor', value: 'blue', updatedAt: 200 }],
    }
    const out = mergeTables(local, remote)
    expect(out.todos.map((r) => r.id).sort()).toEqual(['a', 'b'])
    expect(out.todos.find((r) => r.id === 'a')!.updatedAt).toBe(100) // 本地较新
    expect(out.settings.find((s) => s.key === 'accentColor')!.value).toBe('blue')
  })
})

// ---------------------------------------------------------------------------
// engine.ts（memory store + mock fetch + 固定时钟）
// ---------------------------------------------------------------------------

const T0 = 1_000_000_000_000

async function makeEngine(remote: string | null = null, remoteStatus = 200, putStatus = 201) {
  const store = createMemoryStore({ now: () => T0 })
  await store.init()
  const putCalls: string[] = []
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putCalls.push(String(init.body))
      return new Response('', { status: putStatus })
    }
    if (remoteStatus === 404) return new Response('', { status: 404 })
    return new Response(remote ?? 'null', { status: remoteStatus })
  }) as unknown as (input: string, init?: RequestInit) => Promise<Response>
  const statuses: Array<ReturnType<SyncEngine['status']>> = []
  const engine = createSyncEngine({
    store,
    fetchImpl,
    clock: () => T0,
    onStatus: (s) => statuses.push(s),
  })
  engine.configure(CFG)
  return { store, engine, putCalls, statuses }
}

describe('createSyncEngine', () => {
  it('未配置时 pull/push 均为 no-op（configure(null)）', async () => {
    const store = createMemoryStore()
    await store.init()
    const engine = createSyncEngine({ store, fetchImpl: vi.fn() })
    await expect(engine.pull()).resolves.toEqual({ pulled: false, pushed: false })
    expect(engine.configured).toBe(false)
  })

  it('pull：云端无文件（404）→ 仅记录同步时间，不动本地', async () => {
    const { store, engine, statuses } = await makeEngine(null, 404)
    const before = await serializeBackup(store)
    await engine.pull()
    const after = await serializeBackup(store)
    expect(JSON.stringify(before.data)).toBe(JSON.stringify(after.data))
    expect(engine.status().lastSyncAt).toBe(T0)
    expect(statuses[0]?.state).toBe('syncing')
    expect(statuses[statuses.length - 1]?.state).toBe('idle')
  })

  it('pull：云端较新记录合并进本地（LWW）', async () => {
    const { store, engine } = await makeEngine(
      JSON.stringify({
        app: 'daycell',
        version: 1,
        exportedAt: T0,
        schemaVersion: 1,
        data: {
          todos: [rec('a', 'todo', 999), rec('b', 'todo', 888)],
          notes: [], expenses: [], anniversaries: [], categories: [], goals: [], stages: [], habits: [], checkins: [],
          settings: [],
        },
      }),
    )
    await store.put('todos', rec('a', 'todo', 100) as never, { keepTimestamps: true })
    await engine.pull()
    const all = await store.all('todos', { includeDeleted: true })
    expect(all.find((r) => r.id === 'a')!.updatedAt).toBe(999) // 远端新
    expect(all.find((r) => r.id === 'b')!.updatedAt).toBe(888) // 远端独有
    // 时间戳被保留（不是"刚刚"）
    expect(all.find((r) => r.id === 'a')!.updatedAt).not.toBe(T0)
  })

  it('pull：云端损坏 → WebDavError 且本地不动', async () => {
    const { store, engine } = await makeEngine('not json')
    const before = await serializeBackup(store)
    await expect(engine.pull()).rejects.toThrow()
    const after = await serializeBackup(store)
    expect(JSON.stringify(before.data)).toBe(JSON.stringify(after.data))
    expect(engine.status().state).toBe('error')
    expect(engine.status().lastError).toBeTruthy()
  })

  it('push：本地全量上传，含墓碑', async () => {
    const { store, engine, putCalls } = await makeEngine()
    await store.put('todos', rec('a', 'todo', 100) as never, { keepTimestamps: true })
    await store.put('todos', { ...rec('b', 'todo', 50), deleted: true } as never, { keepTimestamps: true })
    await engine.push()
    expect(putCalls).toHaveLength(1)
    const uploaded = parseBackup(putCalls[0]!)
    expect(uploaded.data.todos.find((r) => r.id === 'b')!.deleted).toBe(true)
  })

  it('push 失败 → status.error，错误信息保留', async () => {
    const { engine } = await makeEngine(null, 200, 500)
    await expect(engine.push()).rejects.toThrow()
    expect(engine.status().state).toBe('error')
  })

  it('schedulePush 防抖：多次变更只推一次', async () => {
    vi.useFakeTimers()
    try {
      const { engine, putCalls } = await makeEngine()
      engine.schedulePush(1000)
      engine.schedulePush(1000)
      engine.schedulePush(1000)
      vi.advanceTimersByTime(999)
      expect(putCalls).toHaveLength(0)
      vi.advanceTimersByTime(1)
      await vi.runAllTimersAsync()
      expect(putCalls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('pull 完成后 merging 复位，不残留同步态', async () => {
    const { engine } = await makeEngine(
      JSON.stringify({
        app: 'daycell',
        version: 1,
        exportedAt: T0,
        schemaVersion: 1,
        data: {
          todos: [rec('a', 'todo', 999)],
          notes: [], expenses: [], anniversaries: [], categories: [], goals: [], stages: [], habits: [], checkins: [],
          settings: [],
        },
      }),
    )
    await engine.pull()
    expect(engine.merging).toBe(false)
    expect(engine.status().lastSyncAt).toBe(T0)
  })

  it('sync = pull + push（先拉后推，避免覆盖远端新数据）', async () => {
    const { engine, putCalls } = await makeEngine(
      JSON.stringify({
        app: 'daycell',
        version: 1,
        exportedAt: T0,
        schemaVersion: 1,
        data: {
          todos: [],
          notes: [], expenses: [], anniversaries: [], categories: [], goals: [], stages: [], habits: [], checkins: [],
          settings: [],
        },
      }),
    )
    const r = await engine.sync()
    expect(r).toEqual({ pulled: true, pushed: true })
    expect(putCalls).toHaveLength(1)
  })
})
