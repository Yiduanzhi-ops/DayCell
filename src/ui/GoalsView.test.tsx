/**
 * v7.9 目标模块 UI 冒烟测试（守"用户验收过的原型交互能跑"）：
 *  1. 底部 tab 第 4 个「目标」→ 空状态 + 新建入口
 *  2. 新建目标 → 列表卡片出现（标题 + 「当前」徽标随阶段）
 *  3. 打开详情 → 顶部主展示目标阐述，下方阶段列表
 *  4. 添加第一个阶段 → 自动「当前」；第二个阶段「未开始」
 *  5. 点行展开 → 设为当前：原当前自动取消（互斥）
 *  6. 删除目标 → 连带阶段消失，回列表
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
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
    await waitFor(() => expect(screen.getByText('进行中的目标')).toBeInTheDocument())
    expect(screen.getByText(/还没有目标/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '＋ 新建目标' })).toBeInTheDocument()
  })

  it('新建目标 → 列表卡片出现', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText('进行中的目标'))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
    const nameInput = screen.getByPlaceholderText('如：复习考公')
    fireEvent.change(nameInput, { target: { value: '复习考公' } })
    const note = screen.getByPlaceholderText('这个阶段想做什么、为什么做、怎么衡量')
    fireEvent.change(note, { target: { value: '2026 下半年主线' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))

    expect(await screen.findByText('复习考公')).toBeInTheDocument()
    expect(screen.getByText('2026 下半年主线')).toBeInTheDocument()
    expect(screen.getByText(/0 个阶段/)).toBeInTheDocument()
  })

  it('详情页：阐述在顶部主展示，阶段列表在下方；首个阶段自动「当前」', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText('进行中的目标'))

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
    await waitFor(() => screen.getByText('进行中的目标'))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
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

  it('删除目标：连带阶段消失并回列表', async () => {
    await renderApp()
    fireEvent.click(screen.getByRole('tab', { name: '目标' }))
    await waitFor(() => screen.getByText('进行中的目标'))

    fireEvent.click(screen.getByRole('button', { name: '＋ 新建目标' }))
    fireEvent.change(screen.getByPlaceholderText('如：复习考公'), { target: { value: '复习考公' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    await screen.findByText('复习考公')

    fireEvent.click(screen.getByText('复习考公'))
    await waitFor(() => screen.getByText('阶段列表'))
    fireEvent.click(screen.getByRole('button', { name: '＋ 添加阶段' }))
    fireEvent.change(screen.getByPlaceholderText('如：刷题阶段'), { target: { value: '基础学习' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    await waitFor(() => screen.getByText('基础学习'))

    fireEvent.click(screen.getByRole('button', { name: '删除目标' }))
    // 删除 = 级联事务 + 列表刷新，异步链较长
    await waitFor(() => expect(screen.getByText(/还没有目标/)).toBeInTheDocument(), { timeout: 5000 })
  })
})
