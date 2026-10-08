/**
 * v8.0 习惯模块测试。
 *
 * 覆盖用户拍板的行为口径：
 *  - 习惯 = 纯勾选打卡项（不进待办），频率自定义：每天 / 每周选星期几
 *  - 暂停后不出现在「今日习惯」（设置页仍可见）
 *  - 打卡 toggle 幂等：勾 → 取消 → 再勾；取消打卡 = 置墓碑（永不物理删除）
 *  - habitDay 只返回"今天该做的"（每天全部 / 每周命中星期），含打卡状态
 *  - 备份含 habits/checkins；旧备份（无这两段）仍可导入
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { CheckinRecord, DateKey, HabitRecord } from '../types'
import { createMemoryStore } from '../store/memory'
import type { RecordStore } from '../store/types'
import { createFakeClock, type FakeClock } from '../clock'
import { createSeqIdGen } from '../id'
import { NotFoundError, ValidationError } from '../errors'
import { createRepos, type Repos } from './index'
import { createAggregates, type Aggregates } from '../aggregate'
import { parseBackup, serializeBackup, mergeBackup } from '../backup'

const k = (s: string): DateKey => s as DateKey

let store: RecordStore
let repos: Repos
let agg: Aggregates
let clock: FakeClock

beforeEach(async () => {
  clock = createFakeClock(1_700_000_000_000)
  store = createMemoryStore({ now: clock })
  await store.init()
  repos = createRepos({ store, now: clock, idGen: createSeqIdGen() })
  agg = createAggregates({ store, repos, lunar: null })
})

describe('habits', () => {
  it('create：名称 trim、默认未暂停', async () => {
    const h = await repos.habits.create({ name: '  多喝水  ', freq: { kind: 'daily' } })
    expect(h.name).toBe('多喝水')
    expect(h.paused).toBe(false)
    expect(h.deleted).toBe(false)
  })

  it('名称超长拒绝（LIMITS.habitName=30）', async () => {
    await expect(
      repos.habits.create({ name: 'x'.repeat(31), freq: { kind: 'daily' } }),
    ).rejects.toThrow(ValidationError)
  })

  it('weekly 频率：去重排序、不选任何一天拒绝', async () => {
    const h = await repos.habits.create({ name: '健身', freq: { kind: 'weekly', weekdays: [4, 2, 4] } })
    expect(h.freq).toEqual({ kind: 'weekly', weekdays: [2, 4] })
    await expect(
      repos.habits.create({ name: '健身', freq: { kind: 'weekly', weekdays: [] } }),
    ).rejects.toThrow(ValidationError)
    await expect(
      repos.habits.create({ name: '健身', freq: { kind: 'weekly', weekdays: [7] } }),
    ).rejects.toThrow(ValidationError)
  })

  it('update：改名称/频率/暂停', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    const p = await repos.habits.update(h.id, { paused: true })
    expect(p.paused).toBe(true)
    const w = await repos.habits.update(h.id, { freq: { kind: 'weekly', weekdays: [1, 3] } })
    expect(w.freq).toEqual({ kind: 'weekly', weekdays: [1, 3] })
    expect(w.name).toBe('喝水') // 只改频率，名称不动
  })

  it('softDelete：墓碑，不在 all() 里', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    await repos.habits.softDelete(h.id)
    expect(await repos.habits.all()).toHaveLength(0)
    const raw = await store.get<HabitRecord>('habits', h.id)
    expect(raw?.deleted).toBe(true)
  })

  it('softDelete 不存在 → NotFoundError', async () => {
    await expect(repos.habits.softDelete('nope')).rejects.toThrow(NotFoundError)
  })
})

describe('checkins（打卡）', () => {
  it('toggle：勾 → 取消 → 再勾，幂等；doneOn 反映状态', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    expect(await repos.checkins.doneOn(k('2026-10-08'))).toEqual(new Set())

    expect(await repos.checkins.toggle(k('2026-10-08'), h.id)).toBe(true)
    expect(await repos.checkins.doneOn(k('2026-10-08'))).toEqual(new Set([h.id]))

    expect(await repos.checkins.toggle(k('2026-10-08'), h.id)).toBe(false)
    expect(await repos.checkins.doneOn(k('2026-10-08'))).toEqual(new Set())

    expect(await repos.checkins.toggle(k('2026-10-08'), h.id)).toBe(true)
    expect(await repos.checkins.doneOn(k('2026-10-08'))).toEqual(new Set([h.id]))
  })

  it('打卡按日期隔离：昨天打卡不影响今天', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    await repos.checkins.toggle(k('2026-10-07'), h.id)
    expect(await repos.checkins.doneOn(k('2026-10-07'))).toEqual(new Set([h.id]))
    expect(await repos.checkins.doneOn(k('2026-10-08'))).toEqual(new Set())
  })

  it('取消打卡只打墓碑：记录仍在（永不物理删除）', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    await repos.checkins.toggle(k('2026-10-08'), h.id)
    await repos.checkins.toggle(k('2026-10-08'), h.id) // 取消
    const all = await store.all<CheckinRecord>('checkins', { includeDeleted: true })
    expect(all).toHaveLength(1)
    expect(all[0]!.deleted).toBe(true)
  })
})

describe('aggregate.habitDay（今日习惯）', () => {
  const THU = k('2026-10-08') // 周四

  it('每天的习惯全出；每周只出命中今天的；暂停的不出', async () => {
    await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    await repos.habits.create({ name: '阅读', freq: { kind: 'weekly', weekdays: [4] } }) // 周四
    const off = await repos.habits.create({ name: '健身', freq: { kind: 'weekly', weekdays: [2] } }) // 周二
    const paused = await repos.habits.create({ name: '散步', freq: { kind: 'daily' } })
    await repos.habits.update(paused.id, { paused: true })

    const day = await agg.habitDay(THU)
    expect(day.items.map((x) => x.name)).toEqual(['喝水', '阅读']) // 健身（周二）与散步（暂停）不出现
    expect(day.dueCount).toBe(2)
    expect(day.doneCount).toBe(0)
    void off
  })

  it('打卡状态进入 habitDay；勾选后 doneCount 更新', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    await repos.checkins.toggle(THU, h.id)
    const day = await agg.habitDay(THU)
    expect(day.items[0]!.done).toBe(true)
    expect(day.doneCount).toBe(1)
  })

  it('不同的星期：weekly 习惯只在命中日出', async () => {
    await repos.habits.create({ name: '阅读', freq: { kind: 'weekly', weekdays: [4] } })
    const mon = await agg.habitDay(k('2026-10-05')) // 周一
    expect(mon.items).toHaveLength(0)
    const thu = await agg.habitDay(k('2026-10-08')) // 周四
    expect(thu.items.map((x) => x.name)).toEqual(['阅读'])
  })
})

describe('备份含 habits/checkins；旧备份兼容', () => {
  it('serialize 含两段；旧备份（无两段）导入不炸、按空表合并', async () => {
    const h = await repos.habits.create({ name: '喝水', freq: { kind: 'daily' } })
    await repos.checkins.toggle(k('2026-10-08'), h.id)

    const file = await serializeBackup(store, clock)
    expect(file.data.habits).toHaveLength(1)
    expect(file.data.checkins).toHaveLength(1)

    // 旧备份：只有 todos 段（模拟 v7 时代的文件），无 habits/checkins
    const legacy = JSON.stringify({
      app: 'daycell',
      version: 1,
      exportedAt: 1_700_000_000_000,
      schemaVersion: 1,
      data: { todos: [], notes: [], expenses: [], anniversaries: [], categories: [], goals: [], stages: [], subtasks: [], settings: [] },
    })
    const parsed = parseBackup(legacy)
    expect(parsed.data.habits).toEqual([])
    expect(parsed.data.checkins).toEqual([])
    const stats = await mergeBackup(store, parsed)
    expect(stats.added.habits).toBe(0)
    // 本地习惯不受影响
    expect((await repos.habits.all()).map((x) => x.name)).toEqual(['喝水'])
  })

  it('导入备份的习惯与打卡补入本地', async () => {
    const file = await serializeBackup(store, clock)
    // 另一个"设备"：新 store 导入
    const store2 = createMemoryStore({ now: clock })
    await store2.init()
    const repos2 = createRepos({ store: store2, now: clock, idGen: createSeqIdGen() })
    const h2 = await repos2.habits.create({ name: '阅读', freq: { kind: 'weekly', weekdays: [4] } })
    await repos2.checkins.toggle(k('2026-10-08'), h2.id)
    const file2 = await serializeBackup(store2, clock)

    const stats = await mergeBackup(store, file2)
    expect(stats.added.habits).toBe(1)
    expect(stats.added.checkins).toBe(1)
    expect((await repos.habits.all()).map((x) => x.name)).toEqual(['阅读'])
    void file
  })
})
