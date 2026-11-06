/**
 * v7.9 目标模块 UI 冒烟测试（守"用户验收过的原型交互能跑"）：
 *  1. 底部 tab 第 4 个「目标」→ 空状态 + 新建入口
 *  2. 新建目标 → 列表卡片出现（标题 + 「当前」徽标随阶段）
 *  3. 打开详情 → 顶部主展示目标阐述，下方默认子任务列表（v8.7），可切「阶段」
 *  4. 添加第一个阶段 → 自动「当前」；第二个阶段「未开始」
 *  5. 点行展开 → 设为当前：原当前自动取消（互斥）
 *  6. 删除目标 → 连带阶段消失，回列表
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

afterEach(cleanup)

const TODAY = '2026-09-29' as DateKey

async function renderApp() {
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return store
}

describe('目标模块（v7.9）', () => {
  it('底部 tab 第 4 个「目标」：空状态 + 新建入口', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText(/进行中的目标/)).toBeInTheDocument())
    expect(screen.getByText(/还没有目标/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建目标' })).toBeInTheDocument()
  })

  it('新建目标 → 列表卡片出现', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    const nameInput = screen.getByPlaceholderText('如：复习考公')
    fireEvent.change(nameInput, { target: { value: '复习考公' } })
    const note = screen.getByPlaceholderText('这个阶段想做什么、为什么做、怎么衡量')
    fireEvent.change(note, { target: { value: '2026 下半年主线' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText('复习考公')).toBeInTheDocument()
    expect(screen.getByText('2026 下半年主线')).toBeInTheDocument()
    expect(screen.getByText(/0 个子任务 · 0 个阶段/)).toBeInTheDocument()
  })

  it('详情页：阐述在顶部主展示，阶段列表在下方；首个阶段自动「当前」', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    // 建目标 + 阐述
    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.change(screen.getByPlaceholderText('这个阶段想做什么、为什么做、怎么衡量'), {
      target: { value: '每天 2 小时行测，重点数量关系' },
    })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    // 进详情
    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => expect(screen.getByText('目标阐述')).toBeInTheDocument())
    // 阐述在主展示区
    expect(screen.getByText('每天 2 小时行测，重点数量关系')).toBeInTheDocument()
    // v8.7 默认子任务视图 → 切到阶段再断言阶段列表
    fireEvent.click(screen.getByRole('tab', { name: '阶段' }))
    expect(screen.getByText('阶段列表')).toBeInTheDocument()

    // 添加第一个阶段 → 自动「当前」
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加阶段' }))
    fireEvent.change(screen.getByPlaceholderText('如：刷题阶段'), { target: { value: '基础学习' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('基础学习').length).toBeGreaterThan(0))
    expect(screen.getByText('当前')).toBeInTheDocument()

    // 第二个阶段 → 未开始
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加阶段' }))
    fireEvent.change(screen.getByPlaceholderText('如：刷题阶段'), { target: { value: '刷题阶段' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('刷题阶段').length).toBeGreaterThan(0))
    expect(screen.getAllByText('未开始').length).toBeGreaterThan(0)
  })

  it('设为当前：同目标互斥（原「当前」自动取消）', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    // v8.7 默认子任务视图 → 切到阶段
    await waitFor(() => screen.getByRole('tab', { name: '阶段' }))
    fireEvent.click(screen.getByRole('tab', { name: '阶段' }))
    await waitFor(() => screen.getByText('阶段列表'))
    // 两个阶段
    for (const name of ['基础学习', '刷题阶段']) {
      fireEvent.click(screen.getByRole('button', { name: '＋ 添加阶段' }))
      fireEvent.change(screen.getByPlaceholderText('如：刷题阶段'), { target: { value: name } })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
      await waitFor(() => expect(screen.getAllByText(name).length).toBeGreaterThan(0))
    }
    // 当前是第一个
    expect(screen.getByText('当前')).toBeInTheDocument()

    // 展开第二个阶段行 → 设为当前
    fireEvent.click(screen.getAllByRole('button', { name: /刷题阶段/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '设为当前' }))
    await waitFor(() => {
      // 互斥后仍然只有一个「当前」徽标
      expect(screen.getAllByText('当前')).toHaveLength(1)
    })
  })

  it('标记完成 → 目标沉底到「已完成的目标」组，可恢复进行中（v7.9 补）', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    // 卡片上的「标记完成」→ 沉底
    fireEvent.click(screen.getByRole('button', { name: '标记完成：复习考公' }))
    await waitFor(() => expect(screen.getByText('已完成的目标（1）')).toBeInTheDocument())
    expect(screen.getByText('已完成')).toBeInTheDocument()
    expect(screen.getByText('进行中的目标（0）')).toBeInTheDocument()

    // 恢复进行中
    fireEvent.click(screen.getByRole('button', { name: '恢复进行中：复习考公' }))
    await waitFor(() => expect(screen.getByText('进行中的目标（1）')).toBeInTheDocument())
  })

  it('删除目标：连带阶段消失并回列表', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    // v8.7 默认子任务视图 → 切到阶段
    await waitFor(() => screen.getByRole('tab', { name: '阶段' }))
    fireEvent.click(screen.getByRole('tab', { name: '阶段' }))
    await waitFor(() => screen.getByText('阶段列表'))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加阶段' }))
    fireEvent.change(screen.getByPlaceholderText('如：刷题阶段'), { target: { value: '基础学习' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('基础学习').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '删除目标' }))
    // v9.14.3 删除目标二次确认：确认后 = 级联事务 + 列表刷新，异步链较长
    const delDialog = await screen.findByRole('dialog', { name: '删除目标' })
    fireEvent.click(within(delDialog).getByRole('button', { name: '删除目标' }))
    await waitFor(() => expect(screen.getByText(/还没有目标/)).toBeInTheDocument(), { timeout: 5000 })
  })

  // ---- v8.5 子任务双视图 ----

  it('双视图：默认「子任务」（v8.7），切到「阶段」显示阶段列表', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    // 默认子任务视图
    await waitFor(() => screen.getByText(/还没有子任务/))
    expect(screen.getByRole('button', { name: '＋ 添加子任务' })).toBeInTheDocument()

    // 切到阶段视图
    fireEvent.click(screen.getByRole('tab', { name: '阶段' }))
    await waitFor(() => screen.getByText('阶段列表'))
  })

  it('子任务：添加 → 勾选沉底 → 点文字就地编辑 → 删除', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    // v8.7 默认子任务视图
    await waitFor(() => screen.getByText(/还没有子任务/))

    // 添加两条
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '做完教案' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('做完教案').length).toBeGreaterThan(0))

    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '刷一套题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('刷一套题').length).toBeGreaterThan(0))

    // 进度文案出现
    expect(screen.getByText('已完成 0/2')).toBeInTheDocument()

    // 勾选「刷一套题」→ 沉底（「做完教案」在前）
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：刷一套题' }))
    await waitFor(() => expect(screen.getByText('已完成 1/2')).toBeInTheDocument())
    const rows = screen.getAllByRole('checkbox')
    expect(rows[0]).toHaveAttribute('aria-label', '标记完成：做完教案')
    expect(rows[1]).toHaveAttribute('aria-label', '取消完成：刷一套题')

    // 点文字就地编辑（列表行内的标题文本，图表区同名不参与）
    fireEvent.click(screen.getAllByText('做完教案')[0])
    const input = screen.getByDisplayValue('做完教案')
    fireEvent.change(input, { target: { value: '做完教案 v2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => screen.getByText('做完教案 v2'))

    // 删除
    fireEvent.click(screen.getByRole('button', { name: '删除子任务：刷一套题' }))
    await waitFor(() => expect(screen.queryByText('刷一套题')).not.toBeInTheDocument())
  })

  it('v8.60 子任务沉底：已完成排到未完成之后，已完成之间保持原完成顺序', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))

    const add = async (t: string): Promise<void> => {
      fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
      fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: t } })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
      await waitFor(() => expect(screen.getAllByText(t).length).toBeGreaterThan(0))
    }
    await add('任务甲')
    await add('任务乙')
    await add('任务丙')

    // 完成第一条「任务甲」→ 沉底：未完成在前 [任务乙,任务丙]，已完成沉底 [任务甲]
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：任务甲' }))
    await waitFor(() => {
      const rows = screen.getAllByRole('checkbox')
      expect(rows[0]).toHaveAttribute('aria-label', '标记完成：任务乙')
      expect(rows[1]).toHaveAttribute('aria-label', '标记完成：任务丙')
      expect(rows[2]).toHaveAttribute('aria-label', '取消完成：任务甲')
    })

    // 再完成「任务丙」→ 已完成组保持完成先后（甲先于丙）：[任务乙, 任务甲, 任务丙]
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：任务丙' }))
    await waitFor(() => {
      const rows = screen.getAllByRole('checkbox')
      expect(rows[0]).toHaveAttribute('aria-label', '标记完成：任务乙')
      expect(rows[1]).toHaveAttribute('aria-label', '取消完成：任务甲')
      expect(rows[2]).toHaveAttribute('aria-label', '取消完成：任务丙')
    })
  })

  it('v8.32 完成情况：横向进度条下沉到每个子任务/阶段行内（进度描述上方，空条常显）', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))

    // 两条子任务（无进度）→ 行内进度条各显 0% 空条（位于「＋ 添加进度」上方）
    for (const t of ['做完教案', '刷一套题']) {
      fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
      fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: t } })
      fireEvent.click(screen.getByRole('button', { name: '添加' }))
      await waitFor(() => expect(screen.getAllByText(t).length).toBeGreaterThan(0))
    }
    expect(screen.getAllByText('0%')).toHaveLength(2)

    // 勾选一条 → 该条按 done 口径记 100%
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：刷一套题' }))
    await waitFor(() => expect(screen.getAllByText('100%').length).toBeGreaterThan(0))
    expect(screen.getAllByText('0%')).toHaveLength(1)

    // 阶段视图：无 pct 的阶段也显示空条（「进度 —」保留在行脚）
    fireEvent.click(screen.getByRole('tab', { name: '阶段' }))
    await waitFor(() => screen.getByText('阶段列表'))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加阶段' }))
    fireEvent.change(screen.getByPlaceholderText('如：刷题阶段'), { target: { value: '基础学习' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('基础学习').length).toBeGreaterThan(0))
    expect(screen.getByText(/^进度/)).toBeInTheDocument()
  })

  it('子任务描述 v8.9：无描述显占位 → 就地编辑 → 常驻显示在标题下方 → Escape 取消', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '做题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('做题').length).toBeGreaterThan(0))

    // 无描述 → 显示占位
    expect(screen.getByText(/添加描述/)).toBeInTheDocument()

    // 点占位 → textarea 就地编辑（多行）→ blur 保存 → 常驻显示在标题下方
    fireEvent.click(screen.getByText('＋ 添加描述'))
    const ta = screen.getByPlaceholderText('子任务描述')
    fireEvent.change(ta, { target: { value: '每天 30 分钟\n先做 3 题' } })
    fireEvent.blur(ta)
    await waitFor(() => screen.getByText(/每天 30 分钟/))
    expect(screen.getByText(/先做 3 题/)).toBeInTheDocument()
    // 标题仍在
    expect(screen.getAllByText('做题').length).toBeGreaterThan(0)

    // 再点描述 → 改内容 → Escape 取消不保存
    fireEvent.click(screen.getByText(/每天 30 分钟/))
    const ta2 = screen.getByPlaceholderText('子任务描述')
    fireEvent.change(ta2, { target: { value: '改掉的内容' } })
    fireEvent.keyDown(ta2, { key: 'Escape' })
    await waitFor(() => screen.getByText(/每天 30 分钟/))
    expect(screen.queryByText('改掉的内容')).not.toBeInTheDocument()

    // 描述清空 → 回到占位
    fireEvent.click(screen.getByText(/每天 30 分钟/))
    const ta3 = screen.getByPlaceholderText('子任务描述')
    fireEvent.change(ta3, { target: { value: '' } })
    await act(async () => {
      fireEvent.blur(ta3)
    })
    await waitFor(() => screen.getByText(/添加描述/))
  })

  it('子任务当前进度 v8.10：无进度显占位 → 就地编辑（百分比+描述）→ 常驻显示在描述下方 → Escape 取消 → 清空回占位', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '做题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('做题').length).toBeGreaterThan(0))

    // 无进度 → 显示占位
    expect(screen.getByText('＋ 添加进度')).toBeInTheDocument()

    // 点占位 → 编辑态：pct 输入 + 描述 textarea → blur textarea 保存
    fireEvent.click(screen.getByText('＋ 添加进度'))
    const pct = screen.getByPlaceholderText('0-100')
    const note = screen.getByPlaceholderText('进度描述')
    fireEvent.change(pct, { target: { value: '40' } })
    fireEvent.change(note, { target: { value: '做到一半' } })
    await act(async () => {
      fireEvent.blur(note)
    })
    await waitFor(() => expect(screen.getAllByText('40%').length).toBeGreaterThan(0))
    expect(screen.getByText('做到一半')).toBeInTheDocument()
    // 标题仍在
    expect(screen.getAllByText('做题').length).toBeGreaterThan(0)

    // 再点进度 → 改内容 → Escape 取消不保存
    fireEvent.click(screen.getByText('做到一半'))
    const pct2 = screen.getByPlaceholderText('0-100')
    const note2 = screen.getByPlaceholderText('进度描述')
    fireEvent.change(pct2, { target: { value: '90' } })
    fireEvent.change(note2, { target: { value: '快完了' } })
    fireEvent.keyDown(note2, { key: 'Escape' })
    await waitFor(() => expect(screen.getAllByText('40%').length).toBeGreaterThan(0))
    expect(screen.queryByText('快完了')).not.toBeInTheDocument()

    // 清空 → 回到占位
    fireEvent.click(screen.getByText('做到一半'))
    const pct3 = screen.getByPlaceholderText('0-100')
    const note3 = screen.getByPlaceholderText('进度描述')
    fireEvent.change(pct3, { target: { value: '' } })
    fireEvent.change(note3, { target: { value: '' } })
    await act(async () => {
      fireEvent.blur(note3)
    })
    await waitFor(() => screen.getByText('＋ 添加进度'))
    expect(screen.queryByText('40%')).not.toBeInTheDocument()
  })

  it('子任务进度 v8.10.1 回归：填完百分比后点描述框不关闭编辑态，可继续输入文字', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '做题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => expect(screen.getAllByText('做题').length).toBeGreaterThan(0))

    // 进入编辑态，输入百分比
    fireEvent.click(screen.getByText('＋ 添加进度'))
    const pct = screen.getByPlaceholderText('0-100')
    fireEvent.change(pct, { target: { value: '40' } })
    // 焦点从百分比框移到描述框（relatedTarget 指向描述框）→ 编辑态必须保持
    const note = screen.getByPlaceholderText('进度描述')
    fireEvent.blur(pct, { relatedTarget: note })
    expect(screen.getByPlaceholderText('进度描述')).toBeInTheDocument()
    // 描述框仍可输入文字
    fireEvent.change(note, { target: { value: '做到一半' } })
    // 焦点离开编辑区 → 保存并退出编辑态
    await act(async () => {
      fireEvent.blur(note)
    })
    await waitFor(() => expect(screen.getAllByText('40%').length).toBeGreaterThan(0))
    expect(screen.getByText('做到一半')).toBeInTheDocument()
  })

  it('目标当前进度 v8.10：详情页与阐述同级（阐述上、进度下）→ 编辑保存 → 只填百分比也可', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    // 阐述区块（空态）+ 当前进度区块（空态，与阐述同级）
    await waitFor(() => screen.getByText(/还没有写阐述/))
    expect(screen.getByText('当前进度')).toBeInTheDocument()
    expect(screen.getByText(/还没有写当前进度/)).toBeInTheDocument()

    // 点「编辑」（当前进度行的按钮）→ pct + note → 保存 → 显示在阐述下方
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1])
    const pct = screen.getByPlaceholderText('0-100')
    const note = screen.getByPlaceholderText('进度描述（可空）')
    fireEvent.change(pct, { target: { value: '60' } })
    fireEvent.change(note, { target: { value: '已完成框架' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => screen.getByText('60%'))
    expect(screen.getByText('已完成框架')).toBeInTheDocument()

    // 只填百分比（note 可空）：再编辑只改 pct
    fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[1])
    const pct2 = screen.getByPlaceholderText('0-100')
    const note2 = screen.getByPlaceholderText('进度描述（可空）')
    fireEvent.change(pct2, { target: { value: '80' } })
    fireEvent.change(note2, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => screen.getByText('80%'))
    expect(screen.queryByText('已完成框架')).not.toBeInTheDocument()
  })
})

// ===========================================================================
// v9.14 目标文件夹（chips 区 / 新建选夹 / 卡片标签 / 详情移动 / 删夹移出未分类）
// ===========================================================================

describe('目标文件夹（v9.14）', () => {
  it('v9.27 文件夹组头：点文件夹名本身也能折叠/展开（箭头+标题合并为一个按钮）', async () => {
    const { store } = await renderAppWrap()
    await store.getState().createFolder('学习')
    const fid = store.getState().folderList[0].folder.id
    await store.getState().createGoal('英语', '', fid)
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('英语')).toBeInTheDocument())

    // 组头整体是一个按钮，语义为「折叠文件夹「学习」」；点它（不是箭头）就收起
    const head = screen.getByRole('button', { name: '折叠文件夹「学习」' })
    expect(head).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(head)
    await waitFor(() => expect(screen.queryByText('英语')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '展开文件夹「学习」' })).toHaveAttribute('aria-expanded', 'false')

    // 再点一次（展开态按钮）→ 卡片回来
    fireEvent.click(screen.getByRole('button', { name: '展开文件夹「学习」' }))
    await waitFor(() => expect(screen.getByText('英语')).toBeInTheDocument())
  })

  it('新建文件夹 → chips 出现；新建目标可选放入 → 卡片显示文件夹标签', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText(/进行中的目标/)).toBeInTheDocument())

    // 无文件夹时仍显示「新建文件夹」入口（v9.28 顶部工具条：新建文件夹 + 新建目标）
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建目标' })).toBeInTheDocument()

    // 新建文件夹
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    fireEvent.change(screen.getByPlaceholderText(/2026 考证/), { target: { value: '2026 考证' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '2026 考证 0' })).toBeInTheDocument())

    // 新建目标（顶部工具条入口，默认未分类）→ 表单里选「放入文件夹」→ 卡片带标签
    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText(/复习考公/), { target: { value: '考公刷题' } })
    fireEvent.click(screen.getByRole('button', { name: '2026 考证' }))
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByText('考公刷题')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '2026 考证 1' })).toBeInTheDocument()
    // 分组视图：组头「2026 考证（1）」+ chips「2026 考证 1」均含文件夹名（卡片小标签已隐藏）
    expect(screen.getAllByText(/2026 考证/).length).toBeGreaterThan(0)
  })

  it('详情页「移动到文件夹」：从未分类移入 → 卡片标签出现', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('学习')
    await s.createGoal('英语', '', null)
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('英语')).toBeInTheDocument())

    fireEvent.click(screen.getByText('英语'))
    await waitFor(() => expect(screen.getByRole('button', { name: '移动到文件夹' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '移动到文件夹' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: '移动到文件夹' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '学习' }))
    fireEvent.click(screen.getByRole('button', { name: '移动' }))
    // 回列表，卡片带「学习」标签
    await waitFor(() => expect(screen.getAllByText('学习').length).toBeGreaterThan(0))
  })

  it('过滤视图：组头折叠持久化 + 删除文件夹 → 目标自动移出到未分类', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('工作')
    const fid = store.getState().folderList[0]?.folder.id
    expect(fid).toBeTruthy()
    await s.createGoal('交付上线', '', fid)
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /工作 \d/ })).toBeInTheDocument())

    // 进过滤视图 → 组头出现 → 折叠（无占位行，目标隐藏、组头仍在）
    fireEvent.click(screen.getByRole('button', { name: /工作 \d/ }))
    await waitFor(() => expect(screen.getByText('工作（1）')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '折叠文件夹「工作」' }))
    await waitFor(() => expect(screen.queryByText('交付上线')).not.toBeInTheDocument())
    expect(screen.getByText('工作（1）')).toBeInTheDocument()

    // 菜单 → 删除文件夹 → 确认
    fireEvent.click(screen.getByRole('button', { name: '文件夹菜单' }))
    await waitFor(() => expect(screen.getByText('删除文件夹')).toBeInTheDocument())
    fireEvent.click(screen.getByText('删除文件夹'))
    await waitFor(() => expect(screen.getByText(/自动移出到未分类/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '删除文件夹' }))
    // 回到「全部」，该夹 chip 消失，目标仍在（未分类）
    await waitFor(() => expect(screen.getByText('交付上线')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /工作 \d/ })).not.toBeInTheDocument()
  })

  it('文件夹视图内新建目标 → 自动归属该文件夹（无需手动选夹）', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('工作')
    const fid = store.getState().folderList[0]?.folder.id
    expect(fid).toBeTruthy()
    await s.createGoal('既有目标', '', fid)
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /工作 \d/ })).toBeInTheDocument())

    // 进入文件夹视图 → 顶部「新建目标」默认归该夹（组头不再重复挂按钮）
    fireEvent.click(screen.getByRole('button', { name: /工作 \d/ }))
    await waitFor(() => expect(screen.getByText('文件夹中的目标（1）')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '在「工作」下新建目标' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText(/复习考公/), { target: { value: '文件夹内新建' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    // 自动归属：文件夹视图计数 +1、新目标可见、chips 计数同步
    await waitFor(() => expect(screen.getByText('文件夹中的目标（2）')).toBeInTheDocument())
    expect(screen.getByText('文件夹内新建')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /工作 2/ })).toBeInTheDocument()
  })

  it('空文件夹视图：空态里提供「新建目标」入口，新建后自动归属', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('空夹')
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /空夹 \d/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /空夹 \d/ }))
    await waitFor(() => expect(screen.getByText('这个文件夹还没有目标')).toBeInTheDocument())
    // 空态框里保留一个作用域入口（aria-label 指明归哪个夹）
    const btn = screen.getByRole('button', { name: '在「空夹」下新建目标' })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    fireEvent.change(screen.getByPlaceholderText(/复习考公/), { target: { value: '空夹首个目标' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    // 自动归属：空态消失 → 文件夹视图出现该目标
    await waitFor(() => expect(screen.getByText('文件夹中的目标（1）')).toBeInTheDocument())
    expect(screen.getByText('空夹首个目标')).toBeInTheDocument()
  })

  it('全部视图分组：文件夹组顺序 + 折叠 + 未分类沉底 + 组内新建自动归属', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('甲夹')
    const fidA = store.getState().folderList.find((f) => f.folder.name === '甲夹')?.folder.id
    await s.createFolder('乙夹')
    const fidB = store.getState().folderList.find((f) => f.folder.name === '乙夹')?.folder.id
    await s.createGoal('甲目标', '', fidA ?? null)
    await s.createGoal('乙目标', '', fidB ?? null)
    await s.createGoal('散目标', '', null)
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    // 分组组头：甲夹 → 乙夹 → 未分类（沉底）
    await waitFor(() => expect(screen.getByText('甲夹（1）')).toBeInTheDocument())
    const body = (): string => document.body.textContent ?? ''
    expect(body().indexOf('乙夹（1）')).toBeGreaterThan(body().indexOf('甲夹（1）'))
    expect(body().indexOf('未分类（1）')).toBeGreaterThan(body().indexOf('乙夹（1）'))
    // 折叠乙夹 → 乙目标隐藏；组头仍在（▸ + 名称（N）），无占位行
    fireEvent.click(screen.getByRole('button', { name: '折叠文件夹「乙夹」' }))
    await waitFor(() => expect(screen.queryByText('乙目标')).not.toBeInTheDocument())
    expect(screen.getByText('乙夹（1）')).toBeInTheDocument()
    expect(screen.queryByText(/已折叠/)).not.toBeInTheDocument()
    // 展开乙夹 → 目标回来
    fireEvent.click(screen.getByRole('button', { name: '展开文件夹「乙夹」' }))
    await waitFor(() => expect(screen.getByText('乙目标')).toBeInTheDocument())
    // 甲夹组头的「新建目标」→ 自动归属甲夹
    fireEvent.click(screen.getByRole('button', { name: '在「甲夹」下新建目标' }))
    fireEvent.change(screen.getByPlaceholderText(/复习考公/), { target: { value: '甲夹新建' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByText('甲夹（2）')).toBeInTheDocument())
    expect(screen.getByText('甲夹新建')).toBeInTheDocument()
  })

  it('v9.28 全部视图：空文件夹也入列 + 未分类常驻 + 顶部新建目标默认未分类', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('有内容的夹')
    const fid = store.getState().folderList.find((f) => f.folder.name === '有内容的夹')?.folder.id
    await s.createGoal('夹内目标', '', fid ?? null)
    await s.createFolder('空夹')
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))

    // 空文件夹也在列表里（组头 + 轻量提示）；未分类 0 条时也常驻
    await waitFor(() => expect(screen.getByText('有内容的夹（1）')).toBeInTheDocument())
    expect(screen.getByText('空夹（0）')).toBeInTheDocument()
    expect(screen.getByText('这个文件夹还没有目标')).toBeInTheDocument()
    expect(screen.getByText('未分类（0）')).toBeInTheDocument()
    expect(screen.getByText('还没有未分类的目标')).toBeInTheDocument()

    // 顶部「新建目标」：全部视图下默认归未分类，不用先借某个文件夹的按钮
    fireEvent.click(screen.getByRole('button', { name: '新建目标' }))
    fireEvent.change(screen.getByPlaceholderText(/复习考公/), { target: { value: '散落目标' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByText('未分类（1）')).toBeInTheDocument())
    expect(screen.getByText('散落目标')).toBeInTheDocument()
    expect(screen.getByText('有内容的夹（1）')).toBeInTheDocument()

    // 顶部「新建文件夹」：新建后立刻入列（0 目标也看得见，不再"建完消失"）
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    fireEvent.change(screen.getByPlaceholderText(/2026 考证/), { target: { value: '新建的夹' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await waitFor(() => expect(screen.getByText('新建的夹（0）')).toBeInTheDocument())
  })

  it('v9.29 入口去冗余：文件夹组头保留作用域入口，未分类组头不再挂按钮', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createFolder('学习')
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('学习（0）')).toBeInTheDocument())

    // 顶部两个入口：文案去 + 号，全局唯二
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建目标' })).toBeInTheDocument()
    expect(screen.queryByText(/＋ 新建目标/)).not.toBeInTheDocument()

    // 文件夹组头：保留一个作用域入口（aria-label 指明归属该夹）
    expect(screen.getByRole('button', { name: '在「学习」下新建目标' })).toBeInTheDocument()

    // 未分类组头：不再常驻新建按钮（顶部在全部视图默认就是未分类，属完全冗余）
    expect(screen.getByText('未分类（0）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '在「未分类」下新建目标' })).not.toBeInTheDocument()
  })

  it('删除目标二次确认：取消不删，确认后删除并回列表', async () => {
    const { store } = await renderAppWrap()
    const s = store.getState()
    await s.createGoal('待删', '', null)
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => expect(screen.getByText('待删')).toBeInTheDocument())
    fireEvent.click(screen.getByText('待删'))
    await waitFor(() => screen.getByRole('tab', { name: '阶段' }))
    fireEvent.click(screen.getByRole('button', { name: '删除目标' }))
    const delDialog = await screen.findByRole('dialog', { name: '删除目标' })
    // 取消 → 弹层关闭、目标仍在
    fireEvent.click(within(delDialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('待删')).toBeInTheDocument()
    // 再次删除并确认 → 删除成功回列表
    fireEvent.click(screen.getByRole('button', { name: '删除目标' }))
    const delDialog2 = await screen.findByRole('dialog', { name: '删除目标' })
    fireEvent.click(within(delDialog2).getByRole('button', { name: '删除目标' }))
    await waitFor(() => expect(screen.queryByText('待删')).not.toBeInTheDocument())
    expect(screen.getByText(/还没有目标/)).toBeInTheDocument()
  })
})
async function renderAppWrap() {
  localStorage.clear()
  const bundle = await initCore({ store: createMemoryStore(), skipLunar: true })
  const store = createAppStore(bundle, { today: TODAY, isNarrow: () => false })
  await store.getState().init()
  render(<App store={store} />)
  return { store }
}
