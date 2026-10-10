/**
 * v7.9 目标/阶段模块测试。
 *
 * 覆盖用户拍板的行为口径：
 *  - 第一个阶段自动成为「当前」
 *  - 「设为当前」同目标互斥（自动取消原当前，并清 done）
 *  - 百分比与状态相互独立（可 100% 未标完成）
 *  - 删除目标连带删除其全部阶段（单事务）
 *  - 历史（已完成）阶段保留可回看；softDelete 只打墓碑不物理删
 *  - 备份合并含 goals/stages；旧备份（无这两段）仍可导入
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { GoalRecord, StageRecord, StoreName } from '../types'
import { createMemoryStore } from '../store/memory'
import type { RecordStore } from '../store/types'
import { createFakeClock, type FakeClock } from '../clock'
import { createSeqIdGen } from '../id'
import { NotFoundError, ValidationError } from '../errors'
import { createRepos, type Repos } from './index'
import { createAggregates, type Aggregates } from '../aggregate'
import { parseBackup, serializeBackup, mergeBackup } from '../backup'

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

// ---------------------------------------------------------------------------
// 目标 CRUD
// ---------------------------------------------------------------------------

describe('goals', () => {
  it('create：标题 trim、阐述可空', async () => {
    const g = await repos.goals.create({ title: '  复习考公  ', note: '每天 2 小时行测' })
    expect(g.title).toBe('复习考公')
    expect(g.note).toBe('每天 2 小时行测')
    expect(g.type).toBe('goal')
    expect(g.deleted).toBe(false)
    const g2 = await repos.goals.create({ title: '账单管理' })
    expect(g2.note).toBe('')
  })

  it('标题超长拒绝（LIMITS.goalTitle=50）', async () => {
    await expect(repos.goals.create({ title: 'x'.repeat(51) })).rejects.toThrow(ValidationError)
  })

  it('update：可只改阐述，标题不动', async () => {
    const g = await repos.goals.create({ title: '复习考公', note: '旧阐述' })
    const g2 = await repos.goals.update(g.id, { note: '新阐述' })
    expect(g2.title).toBe('复习考公')
    expect(g2.note).toBe('新阐述')
  })

  it('v8.10 progress：create 可带进度（pct/note 可只填其一）；update 改/清空；缺省兼容', async () => {
    // 两者都填
    const g = await repos.goals.create({ title: '目标', progress: { pct: 60, note: '已完成框架' } })
    expect(g.progress).toEqual({ pct: 60, note: '已完成框架' })
    // 只填 pct
    const g2 = await repos.goals.create({ title: '目标2', progress: { pct: 30 } })
    expect(g2.progress).toEqual({ pct: 30 })
    expect('note' in g2.progress!).toBe(false)
    // 只填 note
    const g3 = await repos.goals.create({ title: '目标3', progress: { note: '还在准备' } })
    expect(g3.progress).toEqual({ note: '还在准备' })
    expect('pct' in g3.progress!).toBe(false)
    // update 覆盖
    const g4 = await repos.goals.update(g.id, { progress: { pct: 80, note: '快完成了' } })
    expect(g4.progress).toEqual({ pct: 80, note: '快完成了' })
    // 显式传空对象 → 清空并删字段
    const g5 = await repos.goals.update(g.id, { progress: {} })
    expect(g5.progress).toBeUndefined()
    expect('progress' in g5).toBe(false)
    // 缺省创建 → 无 progress 字段（旧数据兼容形态）
    const plain = await repos.goals.create({ title: '无进度' })
    expect('progress' in plain).toBe(false)
  })

  it('v8.10 progress 非法：pct 越界/小数拒绝；note 超长拒绝', async () => {
    await expect(repos.goals.create({ title: 'x', progress: { pct: 101 } })).rejects.toThrow(ValidationError)
    await expect(repos.goals.create({ title: 'x', progress: { pct: -1 } })).rejects.toThrow(ValidationError)
    await expect(repos.goals.create({ title: 'x', progress: { pct: 1.5 } })).rejects.toThrow(ValidationError)
    await expect(repos.goals.create({ title: 'x', progress: { note: 'x'.repeat(201) } })).rejects.toThrow(ValidationError)
    const g = await repos.goals.create({ title: 'x' })
    await expect(repos.goals.update(g.id, { progress: { note: 'x'.repeat(201) } })).rejects.toThrow(ValidationError)
    await expect(repos.goals.update(g.id, { progress: { pct: 101 } })).rejects.toThrow(ValidationError)
  })

  it('setDone：目标整体完成/取消完成（v7.9 补）', async () => {
    const g = await repos.goals.create({ title: '复习考公' })
    expect(g.done).toBe(false)
    const done = await repos.goals.setDone(g.id, true)
    expect(done.done).toBe(true)
    expect(done.title).toBe('复习考公') // 只改 done，其他不动
    const undone = await repos.goals.setDone(g.id, false)
    expect(undone.done).toBe(false)
  })

  it('softDelete：软删并级联软删其全部阶段（单事务）', async () => {
    const g = await repos.goals.create({ title: '复习考公' })
    const s1 = await repos.stages.create({ goalId: g.id, title: '基础学习' })
    const s2 = await repos.stages.create({ goalId: g.id, title: '刷题阶段' })

    await repos.goals.softDelete(g.id)

    const all = await store.all<GoalRecord>('goals', { includeDeleted: true })
    expect(all.find((x) => x.id === g.id)?.deleted).toBe(true)
    const stages = await store.all<StageRecord>('stages', { includeDeleted: true })
    expect(stages.find((x) => x.id === s1.id)?.deleted).toBe(true)
    expect(stages.find((x) => x.id === s2.id)?.deleted).toBe(true)
    // 活数据不可见
    expect(await repos.goals.all()).toHaveLength(0)
    expect(await repos.stages.byGoal(g.id)).toHaveLength(0)
  })

  it('softDelete 不存在 → NotFoundError', async () => {
    await expect(repos.goals.softDelete('nope')).rejects.toThrow(NotFoundError)
  })
})

// ---------------------------------------------------------------------------
// 阶段 CRUD 与互斥
// ---------------------------------------------------------------------------

describe('stages', () => {
  it('create：目标必须存在，否则 NotFoundError', async () => {
    await expect(repos.stages.create({ goalId: 'ghost', title: 'x' })).rejects.toThrow(NotFoundError)
  })

  it('第一个阶段自动成为当前阶段', async () => {
    const g = await repos.goals.create({ title: '复习考公' })
    const s1 = await repos.stages.create({ goalId: g.id, title: '基础学习' })
    expect(s1.isCurrent).toBe(true)
    const s2 = await repos.stages.create({ goalId: g.id, title: '刷题阶段' })
    expect(s2.isCurrent).toBe(false)
  })

  it('pct：0–100 整数，越界拒绝；可不填', async () => {
    const g = await repos.goals.create({ title: 'x' })
    const s = await repos.stages.create({ goalId: g.id, title: 'a', pct: 60 })
    expect(s.pct).toBe(60)
    await expect(repos.stages.create({ goalId: g.id, title: 'b', pct: 101 })).rejects.toThrow(ValidationError)
    await expect(repos.stages.create({ goalId: g.id, title: 'c', pct: 1.5 })).rejects.toThrow(ValidationError)
    const no = await repos.stages.create({ goalId: g.id, title: 'd' })
    expect(no.pct).toBeUndefined()
  })

  it('update：pct 传 null 显式清空，传 undefined 不改', async () => {
    const g = await repos.goals.create({ title: 'x' })
    const s = await repos.stages.create({ goalId: g.id, title: 'a', pct: 60 })
    const cleared = await repos.stages.update(s.id, { pct: null })
    expect(cleared.pct).toBeUndefined()
    const untouched = await repos.stages.update(s.id, { title: '改名' })
    expect(untouched.pct).toBeUndefined()
    expect(untouched.title).toBe('改名')
  })

  it('setCurrent：同目标互斥，并清掉 done；其他目标不受影响', async () => {
    const g = await repos.goals.create({ title: '复习考公' })
    const g2 = await repos.goals.create({ title: '账单管理' })
    const a = await repos.stages.create({ goalId: g.id, title: '基础学习' })
    const b = await repos.stages.create({ goalId: g.id, title: '刷题阶段' })
    await repos.stages.setDone(b.id, true)
    const other = await repos.stages.create({ goalId: g2.id, title: '独立阶段' })
    expect(other.isCurrent).toBe(true)

    const cur = await repos.stages.setCurrent(a.id)
    expect(cur.isCurrent).toBe(true)
    expect(cur.done).toBe(false)

    const after = await repos.stages.byGoal(g.id)
    expect(after.find((x) => x.id === a.id)?.isCurrent).toBe(true)
    expect(after.find((x) => x.id === a.id)?.done).toBe(false) // 被设为当前 → 回到进行中
    expect(after.find((x) => x.id === b.id)?.isCurrent).toBe(false)
    expect(after.find((x) => x.id === b.id)?.done).toBe(true) // 原当前被取消，完成状态保留（历史可回看）
    // 其他目标不受影响
    const otherAfter = await repos.stages.byGoal(g2.id)
    expect(otherAfter[0]?.isCurrent).toBe(true)
  })

  it('setDone：与 isCurrent/百分比相互独立（100% 可不标完成）', async () => {
    const g = await repos.goals.create({ title: 'x' })
    const s = await repos.stages.create({ goalId: g.id, title: 'a', pct: 100 })
    const done = await repos.stages.setDone(s.id, true)
    expect(done.done).toBe(true)
    expect(done.pct).toBe(100)
    expect(done.isCurrent).toBe(true) // 标完成不清「当前」（repo 只做用户显式要的）
    const undo = await repos.stages.setDone(s.id, false)
    expect(undo.done).toBe(false)
  })

  it('softDelete：只打墓碑，历史可回看', async () => {
    const g = await repos.goals.create({ title: 'x' })
    const s = await repos.stages.create({ goalId: g.id, title: 'a' })
    await repos.stages.softDelete(s.id)
    expect(await repos.stages.byGoal(g.id)).toHaveLength(0)
    const raw = await store.all<StageRecord>('stages', { includeDeleted: true })
    expect(raw.find((x) => x.id === s.id)?.deleted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 聚合：列表摘要 + 详情排序
// ---------------------------------------------------------------------------

describe('aggregate.goals', () => {
  it('goalSummaries：阶段数 + 子任务数（v8.7）+ 当前阶段；无阶段目标 current 为 null', async () => {
    const g1 = await repos.goals.create({ title: '复习考公', note: '主线' })
    await repos.stages.create({ goalId: g1.id, title: '基础学习', pct: 100 })
    await repos.stages.create({ goalId: g1.id, title: '刷题阶段', pct: 60 })
    await repos.subtasks.create({ goalId: g1.id, title: '子任务 A' })
    await repos.subtasks.create({ goalId: g1.id, title: '子任务 B' })
    const g2 = await repos.goals.create({ title: '刚建的', note: '' })

    const list = await agg.goalSummaries()
    expect(list).toHaveLength(2)
    const a = list.find((x) => x.goal.id === g1.id)!
    expect(a.stageCount).toBe(2)
    expect(a.subtaskCount).toBe(2)
    expect(a.current?.title).toBe('基础学习') // 第一个是当前
    expect(a.current?.pct).toBe(100)
    const b = list.find((x) => x.goal.id === g2.id)!
    expect(b.stageCount).toBe(0)
    expect(b.subtaskCount).toBe(0)
    expect(b.current).toBeNull()
  })

  it('goalSummaries：排序按 createdAt 升序，墓碑排除', async () => {
    const g1 = await repos.goals.create({ title: '先建' })
    clock.set(clock() + 1000)
    const g2 = await repos.goals.create({ title: '后建' })
    const g3 = await repos.goals.create({ title: '要删的' })
    await repos.goals.softDelete(g3.id)

    const list = await agg.goalSummaries()
    expect(list.map((x) => x.goal.id)).toEqual([g1.id, g2.id])
  })

  it('goalSummaries：已完成的目标沉底（v7.9 补）', async () => {
    await repos.goals.create({ title: '进行中 A' })
    const g2 = await repos.goals.create({ title: '完成 B' })
    await repos.goals.setDone(g2.id, true)
    await repos.goals.create({ title: '进行中 C' })
    clock.set(clock() + 1000)
    const g4 = await repos.goals.create({ title: '完成 D' })
    await repos.goals.setDone(g4.id, true)

    const list = await agg.goalSummaries()
    // 进行中在前（createdAt 升序），已完成沉底（同为 createdAt 升序）
    expect(list.map((x) => x.goal.title)).toEqual(['进行中 A', '进行中 C', '完成 B', '完成 D'])
    // 归一化：全部都是 boolean
    expect(list.every((x) => typeof x.goal.done === 'boolean')).toBe(true)
  })

  it('stagesOfGoal：当前置顶，其余 createdAt 升序', async () => {
    const g = await repos.goals.create({ title: 'x' })
    const s1 = await repos.stages.create({ goalId: g.id, title: '一' })
    clock.set(clock() + 1000)
    const s2 = await repos.stages.create({ goalId: g.id, title: '二' })
    clock.set(clock() + 1000)
    const s3 = await repos.stages.create({ goalId: g.id, title: '三' })
    await repos.stages.setCurrent(s3.id)

    const list = await agg.stagesOfGoal(g.id)
    expect(list.map((x) => x.id)).toEqual([s3.id, s1.id, s2.id])
    // 只回活记录
    await repos.stages.softDelete(s2.id)
    const after = await agg.stagesOfGoal(g.id)
    expect(after.map((x) => x.id)).toEqual([s3.id, s1.id])
  })
})

// ---------------------------------------------------------------------------
// 备份：含 goals/stages；旧备份兼容
// ---------------------------------------------------------------------------

describe('backup goals/stages', () => {
  it('serialize/parse 往返保留目标与阶段', async () => {
    const g = await repos.goals.create({ title: '复习考公', note: '主线' })
    await repos.stages.create({ goalId: g.id, title: '刷题阶段', pct: 60, note: '复盘' })

    const file = await serializeBackup(store)
    expect(file.data.goals).toHaveLength(1)
    expect(file.data.stages).toHaveLength(1)

    const parsed = parseBackup(JSON.stringify(file))
    expect(parsed.data.goals[0]?.title).toBe('复习考公')
    expect(parsed.data.stages[0]?.pct).toBe(60)
  })

  it('旧备份（无 goals/stages 段）仍可导入，按空表处理', async () => {
    const old = {
      app: 'daycell' as const,
      version: 1,
      exportedAt: 1,
      schemaVersion: 1,
      data: {
        todos: [],
        notes: [],
        expenses: [],
        anniversaries: [],
        categories: [],
        settings: [],
      },
    }
    const parsed = parseBackup(JSON.stringify(old))
    expect(parsed.data.goals).toEqual([])
    expect(parsed.data.stages).toEqual([])
    // 合并到空库不炸
    const stats = await mergeBackup(store, parsed)
    expect(stats.added.goals).toBe(0)
    expect(stats.added.stages).toBe(0)
  })

  it('merge：备份中的目标/阶段补入，重复 id 保留本地', async () => {
    const g = await repos.goals.create({ title: '本地目标' })
    await repos.stages.create({ goalId: g.id, title: '本地阶段' })

    const fromBackup = await repos.goals.create({ title: '备份目标' })
    await repos.stages.create({ goalId: fromBackup.id, title: '备份阶段', pct: 80 })

    const file = await serializeBackup(store)
    // 清库后合并 → 两套目标都应在
    await store.clearAll()
    await store.init()
    repos = createRepos({ store, now: clock, idGen: createSeqIdGen() })
    agg = createAggregates({ store, repos, lunar: null })

    const stats = await mergeBackup(store, file)
    expect(stats.added.goals).toBe(2)
    expect(stats.added.stages).toBe(2)
    const list = await agg.goalSummaries()
    expect(list.map((x) => x.goal.title).sort()).toEqual(['备份目标', '本地目标'])
  })

  it('merge 的 added 统计含 goals/stages 键（契约：RecordTable 八表对齐）', async () => {
    const g = await repos.goals.create({ title: 'x' })
    await repos.stages.create({ goalId: g.id, title: 'y' })
    const file = await serializeBackup(store)
    await store.clearAll()
    await store.init()
    const stats = await mergeBackup(store, file)
    expect(stats.added.goals).toBe(1)
    expect(stats.added.stages).toBe(1)
    // 所有内容 store 键都必须在（否则 UI 统计会 undefined）
    const keys = Object.keys(stats.added) as StoreName[]
    for (const k of ['todos', 'notes', 'expenses', 'anniversaries', 'categories', 'goals', 'stages']) {
      expect(keys).toContain(k)
    }
  })
})

// ---------------------------------------------------------------------------
// 子任务（v8.5）
// ---------------------------------------------------------------------------

describe('subtasks', () => {
  it('create：标题 trim、初始未完成；目标必须存在（幽灵目标报 NotFound）', async () => {
    const g = await repos.goals.create({ title: '复习考公' })
    const st = await repos.subtasks.create({ goalId: g.id, title: '  做完教案第 3 章  ' })
    expect(st.title).toBe('做完教案第 3 章')
    expect(st.done).toBe(false)
    expect(st.type).toBe('subtask')
    expect(st.deleted).toBe(false)
    await expect(repos.subtasks.create({ goalId: 'ghost', title: 'x' })).rejects.toThrow(NotFoundError)
  })

  it('标题超长拒绝（LIMITS.subtaskTitle=50）', async () => {
    const g = await repos.goals.create({ title: '目标' })
    await expect(repos.subtasks.create({ goalId: g.id, title: 'x'.repeat(51) })).rejects.toThrow(ValidationError)
  })

  it('update：只改标题；setDone：勾选/取消', async () => {
    const g = await repos.goals.create({ title: '目标' })
    const st = await repos.subtasks.create({ goalId: g.id, title: '旧标题' })
    const st2 = await repos.subtasks.update(st.id, { title: '新标题' })
    expect(st2.title).toBe('新标题')
    expect(st2.done).toBe(false)
    const done = await repos.subtasks.setDone(st.id, true)
    expect(done.done).toBe(true)
    const undone = await repos.subtasks.setDone(st.id, false)
    expect(undone.done).toBe(false)
  })

  it('v8.9 desc：create 可带描述；update 可改/清空描述；缺省兼容', async () => {
    const g = await repos.goals.create({ title: '目标' })
    // create 带 desc
    const st = await repos.subtasks.create({ goalId: g.id, title: '子任务', desc: '  具体做法：\n每天 30 分钟  ' })
    expect(st.desc).toBe('具体做法：\n每天 30 分钟')
    // update 改 desc（多行保留）
    const st2 = await repos.subtasks.update(st.id, { desc: '新描述\n第二行' })
    expect(st2.desc).toBe('新描述\n第二行')
    // 标题与描述可同时保留
    expect(st2.title).toBe('子任务')
    // 清空 desc → 删除字段（无描述）
    const st3 = await repos.subtasks.update(st.id, { desc: '   ' })
    expect(st3.desc).toBeUndefined()
    // 缺省创建 → 无 desc 字段（旧数据兼容形态）
    const plain = await repos.subtasks.create({ goalId: g.id, title: '无描述' })
    expect(plain.desc).toBeUndefined()
    expect('desc' in plain).toBe(false)
  })

  it('v8.9 desc 超长拒绝（LIMITS.subtaskDesc=500）', async () => {
    const g = await repos.goals.create({ title: '目标' })
    await expect(repos.subtasks.create({ goalId: g.id, title: 'x', desc: 'x'.repeat(501) })).rejects.toThrow(ValidationError)
    const st = await repos.subtasks.create({ goalId: g.id, title: 'x' })
    await expect(repos.subtasks.update(st.id, { desc: 'x'.repeat(501) })).rejects.toThrow(ValidationError)
  })

  it('v8.10 progress：create 可带进度（pct/note 可只填其一）；update 改/清空；缺省兼容', async () => {
    const g = await repos.goals.create({ title: '目标' })
    // 两者都填
    const st = await repos.subtasks.create({ goalId: g.id, title: '子任务', progress: { pct: 40, note: '做到一半' } })
    expect(st.progress).toEqual({ pct: 40, note: '做到一半' })
    // 只填 note（覆盖旧 pct）
    const st2 = await repos.subtasks.update(st.id, { progress: { note: '只差收尾' } })
    expect(st2.progress).toEqual({ note: '只差收尾' })
    expect('pct' in st2.progress!).toBe(false)
    // 只填 pct
    const st3 = await repos.subtasks.update(st.id, { progress: { pct: 90 } })
    expect(st3.progress).toEqual({ pct: 90 })
    expect('note' in st3.progress!).toBe(false)
    // 显式传空对象 → 清空并删字段
    const st4 = await repos.subtasks.update(st.id, { progress: {} })
    expect(st4.progress).toBeUndefined()
    expect('progress' in st4).toBe(false)
    // 缺省创建 → 无 progress 字段
    const plain = await repos.subtasks.create({ goalId: g.id, title: '无进度' })
    expect('progress' in plain).toBe(false)
  })

  it('v8.10 progress 非法：pct 越界拒绝；note 超长拒绝', async () => {
    const g = await repos.goals.create({ title: '目标' })
    await expect(repos.subtasks.create({ goalId: g.id, title: 'x', progress: { pct: -1 } })).rejects.toThrow(ValidationError)
    await expect(repos.subtasks.create({ goalId: g.id, title: 'x', progress: { pct: 101 } })).rejects.toThrow(ValidationError)
    await expect(repos.subtasks.create({ goalId: g.id, title: 'x', progress: { note: 'x'.repeat(201) } })).rejects.toThrow(ValidationError)
    const st = await repos.subtasks.create({ goalId: g.id, title: 'x' })
    await expect(repos.subtasks.update(st.id, { progress: { note: 'x'.repeat(201) } })).rejects.toThrow(ValidationError)
    await expect(repos.subtasks.update(st.id, { progress: { pct: 101 } })).rejects.toThrow(ValidationError)
  })

  it('byGoal：只返回该目标的活子任务（软删的不算）', async () => {
    const g1 = await repos.goals.create({ title: 'A' })
    const g2 = await repos.goals.create({ title: 'B' })
    await repos.subtasks.create({ goalId: g1.id, title: 'a1' })
    const b1 = await repos.subtasks.create({ goalId: g2.id, title: 'b1' })
    await repos.subtasks.create({ goalId: g2.id, title: 'b2' })
    const g1list = await repos.subtasks.byGoal(g1.id)
    expect(g1list.map((x) => x.title)).toEqual(['a1'])
    await repos.subtasks.softDelete(b1.id)
    const g2list = await repos.subtasks.byGoal(g2.id)
    expect(g2list.map((x) => x.title)).toEqual(['b2'])
  })

  it('目标软删 → 连带软删其全部子任务（单事务，墓碑保留）', async () => {
    const g = await repos.goals.create({ title: '目标' })
    const st1 = await repos.subtasks.create({ goalId: g.id, title: 's1' })
    const st2 = await repos.subtasks.create({ goalId: g.id, title: 's2' })
    await repos.goals.softDelete(g.id)
    const list = await repos.subtasks.byGoal(g.id)
    expect(list).toHaveLength(0)
    const all = await store.all('subtasks', { includeDeleted: true })
    expect(all.filter((s) => s.id === st1.id || s.id === st2.id).every((s) => s.deleted)).toBe(true)
  })

  it('aggregate.subtasksOfGoal：未完成在前、完成后沉底，各组按 createdAt 升序', async () => {
    const g = await repos.goals.create({ title: '目标' })
    await repos.subtasks.create({ goalId: g.id, title: 'a' })
    const b = await repos.subtasks.create({ goalId: g.id, title: 'b' })
    await repos.subtasks.create({ goalId: g.id, title: 'c' })
    await repos.subtasks.setDone(b.id, true)
    const list = await agg.subtasksOfGoal(g.id)
    expect(list.map((x) => x.title)).toEqual(['a', 'c', 'b'])
  })

  it('merge 的 added 统计含 subtasks 键（契约：RecordTable 八表对齐）', async () => {
    const g = await repos.goals.create({ title: 'x' })
    await repos.subtasks.create({ goalId: g.id, title: 's' })
    const file = await serializeBackup(store)
    await store.clearAll()
    await store.init()
    const stats = await mergeBackup(store, file)
    expect(stats.added.subtasks).toBe(1)
  })
})
