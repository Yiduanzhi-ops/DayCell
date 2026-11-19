/**
 * v8.108 常驻推进：planPinnedTodos 纯函数测试。
 *
 * 口径：pin 一次 → 每天在「当天」补一条该子任务的待办行；幂等键 subtaskId；
 * 完成/删除/目标不存在 一律不补；不回填历史（函数只关心传入的那一天）。
 */
import { describe, expect, it } from 'vitest'
import { createFakeClock, type FakeClock } from './clock'
import { createSeqIdGen } from './id'
import type { PinnedTodoDraft } from './pinned'
import { planPinnedTodos } from './pinned'
import { createRepos, type Repos } from './repo'
import { createMemoryStore } from './store/memory'
import type { SubtaskRecord, TodoRecord } from './types'

interface Harness {
  repos: Repos
  clock: FakeClock
}

async function setup(): Promise<Harness> {
  const clock = createFakeClock(1000)
  const store = createMemoryStore({ now: clock })
  await store.init()
  return { repos: createRepos({ store, now: clock, idGen: createSeqIdGen() }), clock }
}

async function seed(repos: Repos, pinned = true) {
  const goal = await repos.goals.create({ title: '考研', note: '' })
  const sub = await repos.subtasks.create({ goalId: goal.id, title: '背单词' })
  if (pinned) await repos.subtasks.setPinned(sub.id, true)
  return { goal, sub }
}

describe('v8.108 planPinnedTodos（常驻推进每日补建）', () => {
  it('pinned 且未完成 → 补一条；反复调用时已有的行会被跳过（幂等）', async () => {
    const { repos } = await setup()
    const { goal, sub } = await seed(repos)
    const subs = await repos.subtasks.all()
    const goals = await repos.goals.all()

    const first: PinnedTodoDraft[] = planPinnedTodos(subs, goals, [])
    expect(first).toEqual([{ subtaskId: sub.id, text: '背单词', goalTitle: goal.title }])

    // 已有行（哪怕是勾选过的）→ 不再重复
    const existing = [{ subtaskId: sub.id, deleted: false }] as unknown as TodoRecord[]
    expect(planPinnedTodos(subs, goals, existing)).toEqual([])
    // 墓碑行不算「已有」
    const tomb = [{ subtaskId: sub.id, deleted: true }] as unknown as TodoRecord[]
    expect(planPinnedTodos(subs, goals, tomb)).toHaveLength(1)
  })

  it('没 pin、已完成、已删除、目标不存在 → 都不补', async () => {
    const { repos } = await setup()
    const goals = await repos.goals.all()
    // 未 pin
    const unpinned = await seed(repos, false)
    expect(planPinnedTodos([unpinned.sub], goals, [])).toEqual([])

    // 已完成（pin 自己会留在记录上，但完成即不该再出现）
    const doneSub = {
      ...unpinned.sub,
      id: 'done-1',
      pinned: true,
      done: true,
    } as SubtaskRecord
    expect(planPinnedTodos([doneSub], goals, [])).toEqual([])

    // 已软删
    const delSub = { ...unpinned.sub, id: 'del-1', pinned: true, deleted: true } as SubtaskRecord
    expect(planPinnedTodos([delSub], goals, [])).toEqual([])

    // 目标没了
    const ghost = { ...unpinned.sub, id: 'ghost-1', pinned: true, goalId: 'nope' } as SubtaskRecord
    expect(planPinnedTodos([ghost], goals, [])).toEqual([])
  })

  it('多条时按子任务 createdAt 升序（与详情页顺序一致）', async () => {
    const { repos, clock } = await setup()
    const goal = await repos.goals.create({ title: '考公', note: '' })
    clock.advance(1000)
    const a = await repos.subtasks.setPinned(
      (await repos.subtasks.create({ goalId: goal.id, title: '行测' })).id,
      true,
    )
    clock.advance(1000)
    const b = await repos.subtasks.setPinned(
      (await repos.subtasks.create({ goalId: goal.id, title: '申论' })).id,
      true,
    )
    const goals = await repos.goals.all()
    // 故意乱序传入（store.all 的顺序不可依赖）
    const drafts = planPinnedTodos([b, a], goals, [])
    expect(drafts.map((d) => d.text)).toEqual(['行测', '申论'])
    expect(drafts.map((d) => d.subtaskId)).toEqual([a.id, b.id])
  })

  it('setPinned 幂等：值未变时不写入新版本', async () => {
    const { repos } = await setup()
    const { sub } = await seed(repos, false)
    const on1 = await repos.subtasks.setPinned(sub.id, true)
    expect(on1.pinned).toBe(true)
    const on2 = await repos.subtasks.setPinned(sub.id, true)
    expect(on2.updatedAt).toBe(on1.updatedAt)
    const off = await repos.subtasks.setPinned(sub.id, false)
    expect(off.pinned).toBeUndefined()
  })
})
