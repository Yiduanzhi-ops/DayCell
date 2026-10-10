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
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: '＋ 新建目标' })).toBeInTheDocument()
  })

  it('新建目标 → 列表卡片出现', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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
    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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
    await waitFor(() => expect(screen.getByText('基础学习')).toBeInTheDocument())
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

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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
      await waitFor(() => screen.getByText(name))
    }
    // 当前是第一个
    expect(screen.getByText('当前')).toBeInTheDocument()

    // 展开第二个阶段行 → 设为当前
    fireEvent.click(screen.getByText('刷题阶段'))
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

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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
    await waitFor(() => screen.getByText('基础学习'))

    fireEvent.click(screen.getByRole('button', { name: '删除目标' }))
    // 删除 = 级联事务 + 列表刷新，异步链较长
    await waitFor(() => expect(screen.getByText(/还没有目标/)).toBeInTheDocument(), { timeout: 5000 })
  })

  // ---- v8.5 子任务双视图 ----

  it('双视图：默认「子任务」（v8.7），切到「阶段」显示阶段列表', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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
    await waitFor(() => screen.getByText('做完教案'))

    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '刷一套题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await screen.findByText('刷一套题')

    // 进度文案出现
    expect(screen.getByText('已完成 0/2')).toBeInTheDocument()

    // 勾选「刷一套题」→ 沉底（「做完教案」在前）
    fireEvent.click(screen.getByRole('checkbox', { name: '标记完成：刷一套题' }))
    await waitFor(() => expect(screen.getByText('已完成 1/2')).toBeInTheDocument())
    const rows = screen.getAllByRole('checkbox')
    expect(rows[0]).toHaveAttribute('aria-label', '标记完成：做完教案')
    expect(rows[1]).toHaveAttribute('aria-label', '取消完成：刷一套题')

    // 点文字就地编辑
    fireEvent.click(screen.getByText('做完教案'))
    const input = screen.getByDisplayValue('做完教案')
    fireEvent.change(input, { target: { value: '做完教案 v2' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => screen.getByText('做完教案 v2'))

    // 删除
    fireEvent.click(screen.getByRole('button', { name: '删除子任务：刷一套题' }))
    await waitFor(() => expect(screen.queryByText('刷一套题')).not.toBeInTheDocument())
  })

  it('子任务描述 v8.9：无描述显占位 → 就地编辑 → 常驻显示在标题下方 → Escape 取消', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '做题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => screen.getByText('做题'))

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
    expect(screen.getByText('做题')).toBeInTheDocument()

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

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText(/还没有子任务/))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加子任务' }))
    fireEvent.change(screen.getByPlaceholderText('如：做完教案第 3 章'), { target: { value: '做题' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => screen.getByText('做题'))

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
    await waitFor(() => screen.getByText('40%'))
    expect(screen.getByText('做到一半')).toBeInTheDocument()
    // 标题仍在
    expect(screen.getByText('做题')).toBeInTheDocument()

    // 再点进度 → 改内容 → Escape 取消不保存
    fireEvent.click(screen.getByText('做到一半'))
    const pct2 = screen.getByPlaceholderText('0-100')
    const note2 = screen.getByPlaceholderText('进度描述')
    fireEvent.change(pct2, { target: { value: '90' } })
    fireEvent.change(note2, { target: { value: '快完了' } })
    fireEvent.keyDown(note2, { key: 'Escape' })
    await waitFor(() => screen.getByText('40%'))
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

  it('目标当前进度 v8.10：详情页与阐述同级（阐述上、进度下）→ 编辑保存 → 只填百分比也可', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText(/进行中的目标/))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
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
