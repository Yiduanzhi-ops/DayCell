/**
 * v9.46 目标详情页 UI 测试（严格对齐《阶段与待办联动原型》）：
 *  - 详情页只保留标题 / 时间范围 / 不分阶段 / 阶段卡；阐述与进度下线
 *  - 目标级三操作收进「…」：完成、移动文件夹、删除
 *  - 标题改名只在编辑态；阶段/子任务改名、删除也在编辑态
 *  - 勾选子任务 = 完成 + 今天打卡；＋/－每日待办
 *  - 当前阶段全部子任务完成 → 收尾提示 → 进入下一段
 *  - 删除子任务/阶段可 5 秒撤销
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

afterEach(cleanup)

const TODAY = '2026-09-29' as DateKey

type Bundle = Awaited<ReturnType<typeof initCore>>

async function renderApp(): Promise<{ store: ReturnType<typeof createAppStore>; bundle: Bundle }> {
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return { store, bundle }
}

/** 建一个目标并返回 id（不打开详情） */
async function seedGoal(store: ReturnType<typeof createAppStore>, title = '复习考公'): Promise<string> {
  await store.getState().createGoal(title, '')
  const id = store.getState().goalList[0]?.goal.id
  if (!id) throw new Error('目标创建失败')
  return id
}

/** 进入目标 tab 并打开指定目标详情 */
async function openGoalUI(title = '复习考公'): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: '目标' }))
  await waitFor(() => screen.getByText(title))
  fireEvent.click(screen.getByText(title))
  await waitFor(() => screen.getByRole('button', { name: '返回目标列表' }))
}

/** 在已打开详情的 store 中建阶段，返回阶段 id */
async function addStage(store: ReturnType<typeof createAppStore>, title: string): Promise<string> {
  await store.getState().createStage({ goalId: store.getState().goalDetail!.goal.id, title })
  const stage = store.getState().goalDetail!.stages.find((x) => x.title === title)
  if (!stage) throw new Error('阶段创建失败')
  return stage.id
}

async function addSub(store: ReturnType<typeof createAppStore>, title: string, stageId: string | null = null): Promise<string> {
  await store.getState().createSubtask({ goalId: store.getState().goalDetail!.goal.id, title, stageId })
  const sub = store.getState().goalDetail!.subtasks.find((x) => x.title === title)
  if (!sub) throw new Error('子任务创建失败')
  return sub.id
}

describe('目标详情（v9.46 原型口径）', () => {
  it('详情页结构：顶栏「‹ 目标」+「…／编辑」、时间范围、不分阶段卡；阐述/进度/旧 tab 下线', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()

    expect(screen.getByText('复习考公')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '目标操作' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(screen.getByText('时间范围未设')).toBeInTheDocument()
    expect(screen.getByText('不分阶段')).toBeInTheDocument()
    expect(screen.queryByText('目标阐述')).not.toBeInTheDocument()
    expect(screen.queryByText('当前进度')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '阶段' })).not.toBeInTheDocument()
    expect(screen.queryByText('＋ 添加阶段')).not.toBeInTheDocument()
  })

  it('阶段与子任务：第N阶段前缀、当前徽标、排序不加「第X阶段」重复前缀', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    await waitFor(() => screen.getByText('第一阶段 · 基础学习'))

    await addStage(store, '刷题阶段')
    await waitFor(() => screen.getByText('第二阶段 · 刷题阶段'))
    // 第一个阶段是当前，第二个未开始
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('未开始')).toBeInTheDocument()
  })

  it('编辑态：目标标题改名；常态标题不可点；空格/原值不提交', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()

    expect(screen.queryByRole('button', { name: /重命名目标/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '重命名目标：复习考公' }))
    const input = screen.getByDisplayValue('复习考公')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(screen.getByText('复习考公')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '重命名目标：复习考公' }))
    const input2 = screen.getByDisplayValue('复习考公')
    fireEvent.change(input2, { target: { value: '考公上岸' } })
    fireEvent.keyDown(input2, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('考公上岸')).toBeInTheDocument())
    expect(store.getState().goalDetail?.goal.title).toBe('考公上岸')
  })

  it('编辑态：阶段改名 / 子任务改名 / 删除子任务可撤销', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    await addSub(store, '做完教案')
    await waitFor(() => screen.getByText('第一阶段 · 基础学习'))

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    // Esc 取消：输入不改库、退出后仍是原名
    fireEvent.click(screen.getByRole('button', { name: '第一阶段 · 基础学习' }))
    const escInput = screen.getByDisplayValue('第一阶段 · 基础学习')
    fireEvent.change(escInput, { target: { value: '不该保存的名字' } })
    fireEvent.keyDown(escInput, { key: 'Escape' })
    await waitFor(() => expect(screen.getByText('第一阶段 · 基础学习')).toBeInTheDocument())
    expect(screen.queryByText('第一阶段 · 不该保存的名字')).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByText('第一阶段 · 基础学习').closest('div')!).getByRole('button', { name: '改名' }))
    const stageInput = screen.getByDisplayValue('第一阶段 · 基础学习')
    fireEvent.change(stageInput, { target: { value: '打基础' } })
    fireEvent.keyDown(stageInput, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('第一阶段 · 打基础')).toBeInTheDocument())

    fireEvent.click(screen.getByText('做完教案'))
    const subInput = screen.getByDisplayValue('做完教案')
    fireEvent.change(subInput, { target: { value: '做完教案 v2' } })
    fireEvent.keyDown(subInput, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('做完教案 v2')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '删除子任务：做完教案 v2' }))
    await waitFor(() => expect(screen.queryByText('做完教案 v2')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(screen.getByText('做完教案 v2')).toBeInTheDocument())
  })

  it('删除当前阶段：子任务移入不分阶段、下一段接任并重排序号；撤销完整恢复', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    const aId = store.getState().goalDetail!.stages[0].id
    await addSub(store, '做完教案', aId)
    await addStage(store, '打通回写')
    const bId = store.getState().goalDetail!.stages[1].id
    await waitFor(() => screen.getByText('第二阶段 · 打通回写'))

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    // 编辑态不出现任何「＋子任务」新增入口（含不分阶段卡）
    expect(screen.queryAllByRole('button', { name: /＋子任务/ })).toHaveLength(0)
    const headA = screen.getByText('第一阶段 · 基础学习').closest('div')!
    fireEvent.click(within(headA).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(
        screen.getByText('已删除「第一阶段 · 基础学习」，1 个子任务移入不分阶段'),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('第一阶段 · 基础学习')).not.toBeInTheDocument()
    // 剩余阶段重排为「第一阶段」
    expect(screen.getByText('第一阶段 · 打通回写')).toBeInTheDocument()
    expect(screen.queryByText('第二阶段 · 打通回写')).not.toBeInTheDocument()
    expect(screen.getByText('进行中')).toBeInTheDocument()
    expect(screen.getByText('做完教案')).toBeInTheDocument()
    expect(store.getState().goalDetail!.stages[0].isCurrent).toBe(true)
    expect(store.getState().goalDetail!.subtasks.find((x) => x.title === '做完教案')?.stageId ?? null).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(screen.getByText('第二阶段 · 打通回写')).toBeInTheDocument())
    expect(screen.getByText('第一阶段 · 基础学习')).toBeInTheDocument()
    expect(store.getState().goalDetail!.stages.find((x) => x.id === aId)?.isCurrent).toBe(true)
    expect(store.getState().goalDetail!.stages.find((x) => x.id === bId)?.isCurrent).toBe(false)
  })

  it('勾选子任务 = 完成 + 当天打卡；副行显示打卡天数与完成日；再取消撤当天打卡', async () => {
    const { store, bundle } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    const sid = await addSub(store, '做完教案')
    await waitFor(() => screen.getByText('做完教案'))

    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：做完教案' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '取消完成：做完教案' })).toBeInTheDocument())
    const sub = (await bundle.repos.subtasks.byGoal(store.getState().goalDetail!.goal.id)).find((x) => x.id === sid)!
    expect(sub.done).toBe(true)
    expect(sub.workDates).toContain(TODAY)
    expect(screen.getByText(/打卡 1 天 · .*完成/)).toBeInTheDocument()
    expect(screen.getByText('已做')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: '取消完成：做完教案' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '标记完成：做完教案' })).toBeInTheDocument())
    const after = (await bundle.repos.subtasks.byGoal(store.getState().goalDetail!.goal.id)).find((x) => x.id === sid)!
    expect(after.done).toBe(false)
    expect(after.workDates ?? []).not.toContain(TODAY)
  })

  it('＋每日待办 / －每日待办：加入后出现在今日待办，移除会撤销当天打卡', async () => {
    const { store, bundle } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    const sid = await addSub(store, '做完教案')
    await waitFor(() => screen.getByText('做完教案'))

    fireEvent.click(screen.getByRole('button', { name: '＋每日待办' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '- 每日待办' })).toBeInTheDocument())
    expect(store.getState().subtaskTodayIds).toContain(sid)

    // 模拟今天已完成打卡，再从目标详情移除
    await store.getState().toggleSubtaskWork(sid)
    fireEvent.click(screen.getByRole('button', { name: '- 每日待办' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '＋每日待办' })).toBeInTheDocument())
    expect(store.getState().subtaskTodayIds).not.toContain(sid)
    const sub = (await bundle.repos.subtasks.byGoal(store.getState().goalDetail!.goal.id)).find((x) => x.id === sid)!
    expect(sub.workDates ?? []).not.toContain(TODAY)
  })

  it('编辑态强制展开已完成阶段；退出后恢复默认收起', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    const sid = store.getState().goalDetail!.stages[0].id
    await addSub(store, '子任务一', sid)
    await store.getState().setStageDone(sid, true)
    await waitFor(() => expect(screen.getByText(/完成于/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '标记完成：子任务一' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '子任务一' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '子任务一' })).not.toBeInTheDocument(),
    )
  })

  it('当前阶段最后一条子任务完成 → 自动标完成并进入下一段，不再弹收尾提示', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    const s1 = await addStage(store, '基础学习')
    await addStage(store, '刷题阶段')
    await addSub(store, '任务 A', s1)
    await addSub(store, '任务 B', s1)
    await waitFor(() => screen.getByText('任务 A'))

    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：任务 A' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: '取消完成：任务 A' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：任务 B' }))

    // 不再出现确认句与两个按钮
    expect(screen.queryByText('这一段的事都做完了，要标完成并进入下一段吗？')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '标完成，进入下一段' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '先留着' })).not.toBeInTheDocument()

    await waitFor(() => expect(screen.getByText(/完成于/)).toBeInTheDocument())
    expect(screen.getByText('2/2')).toBeInTheDocument()
    // 自动交接下一位当前
    await waitFor(() => expect(screen.getByText('进行中')).toBeInTheDocument())
    expect(screen.getByText('已进入下一段')).toBeInTheDocument()
    // 已完成阶段不再有 ＋子任务
    const doneCard = screen.getByText('第一阶段 · 基础学习').closest('div')!
    expect(within(doneCard).queryByText('＋子任务')).not.toBeInTheDocument()
  })

  it('删除阶段：子任务移入不分阶段；撤销后阶段与归属恢复', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    const s1 = await addStage(store, '基础学习')
    await addSub(store, '做完教案', s1)
    await waitFor(() => screen.getByText('做完教案'))

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const card = screen.getByText('第一阶段 · 基础学习').closest('div')!
    fireEvent.click(within(card).getByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByText('第一阶段 · 基础学习')).not.toBeInTheDocument())
    expect(screen.getByText('已删除「第一阶段 · 基础学习」，1 个子任务移入不分阶段')).toBeInTheDocument()
    // 子任务仍在，挂在不分阶段
    expect(screen.getByText('做完教案')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await waitFor(() => expect(screen.getByText('第一阶段 · 基础学习')).toBeInTheDocument())
    const sub = store.getState().goalDetail!.subtasks.find((x) => x.title === '做完教案')!
    expect(sub.stageId).toBe(s1)
  })

  it('时间范围：起止反了自动交换；保存与清除都有 toast', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()
    fireEvent.click(screen.getByText('时间范围未设'))
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-20' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('10/01 – 10/20')).toBeInTheDocument())
    expect(store.getState().goalDetail?.goal.startOn).toBe('2026-10-01')
    expect(store.getState().goalDetail?.goal.endOn).toBe('2026-10-20')
    expect(screen.getByText('目标时间范围已更新')).toBeInTheDocument()

    fireEvent.click(screen.getByText('10/01 – 10/20'))
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    await waitFor(() => expect(screen.getByText('时间范围未设')).toBeInTheDocument())
    expect(screen.getByText('已清除目标时间范围')).toBeInTheDocument()
  })
})

describe('目标级三操作（… Sheet）', () => {
  it('标记完成 / 恢复进行中：标题出现已完成胶囊，列表完成态同步', async () => {
    const { store } = await renderApp()
    await seedGoal(store)
    await openGoalUI()

    fireEvent.click(screen.getByRole('button', { name: '目标操作' }))
    const sheet = screen.getByRole('dialog', { name: '目标操作' })
    expect(within(sheet).getByText('标记完成')).toBeInTheDocument()
    expect(within(sheet).getByText('移动到文件夹')).toBeInTheDocument()
    expect(within(sheet).getByText('删除目标')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByText('标记完成'))

    await waitFor(() => expect(screen.getByText('已完成')).toBeInTheDocument())
    expect(store.getState().goalDetail?.goal.done).toBe(true)
    expect(screen.getByText('目标已完成')).toBeInTheDocument()

    // 改名输入时隐藏完成胶囊（原型 renamingGoal 分支只渲染 input）
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '重命名目标：复习考公' }))
    expect(screen.queryByText('已完成')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByDisplayValue('复习考公'), { key: 'Escape' })
    await waitFor(() => expect(screen.getByText('已完成')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    fireEvent.click(screen.getByRole('button', { name: '目标操作' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '目标操作' })).getByText('恢复进行中'))
    await waitFor(() => expect(screen.queryByText('已完成')).not.toBeInTheDocument())
    expect(screen.getByText('已恢复进行中')).toBeInTheDocument()
  })

  it('移动到文件夹：列出真实文件夹 + 未分类，当前项打勾，成功后卡片标签更新', async () => {
    const { store } = await renderApp()
    await store.getState().createFolder('学习')
    const gid = await seedGoal(store)
    await openGoalUI()

    fireEvent.click(screen.getByRole('button', { name: '目标操作' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '目标操作' })).getByText('移动到文件夹'))
    const folderSheet = screen.getByRole('dialog', { name: '移动到文件夹' })
    const uncat = within(folderSheet).getByRole('button', { name: /未分类/ })
    expect(uncat).toHaveTextContent('✓')
    const study = within(folderSheet).getByRole('button', { name: '学习' })
    fireEvent.click(study)

    await waitFor(() => expect(store.getState().goalDetail?.goal.folderId).toBeTruthy())
    expect(store.getState().goalDetail?.goal.folderId).not.toBeNull()
    expect(screen.getByText('已移动到「学习」')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回目标列表' }))
    await waitFor(() => expect(screen.getByLabelText('折叠文件夹「学习」')).toBeInTheDocument())

    const goal = store.getState().goalList.find((x) => x.goal.id === gid)!
    expect(goal.goal.folderId).toBe(store.getState().folderList[0]!.folder.id)
  })

  it('删除目标：取消不删；确认后软删、清详情、回列表，且阶段/子任务不残留', async () => {
    const { store, bundle } = await renderApp()
    const gid = await seedGoal(store)
    await openGoalUI()
    await addStage(store, '基础学习')
    await addSub(store, '做完教案')

    fireEvent.click(screen.getByRole('button', { name: '目标操作' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '目标操作' })).getByText('删除目标'))
    const del = screen.getByRole('dialog', { name: '删除目标' })
    expect(within(del).getByText('删除「复习考公」将同时删除它的全部阶段与子任务，此操作不可恢复。')).toBeInTheDocument()
    fireEvent.click(within(del).getByRole('button', { name: '取消' }))
    expect(store.getState().goalDetail?.goal.id).toBe(gid)

    fireEvent.click(screen.getByRole('button', { name: '目标操作' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '目标操作' })).getByText('删除目标'))
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除目标' })).getByRole('button', { name: '删除目标' }))
    await waitFor(() => expect(screen.getByText('已删除目标')).toBeInTheDocument())
    expect(store.getState().goalDetail).toBeNull()
    expect(store.getState().goalList.find((x) => x.goal.id === gid)).toBeUndefined()
    expect(await bundle.repos.stages.byGoal(gid)).toHaveLength(0)
    expect(await bundle.repos.subtasks.byGoal(gid)).toHaveLength(0)
  })
})
