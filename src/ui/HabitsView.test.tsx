/**
 * v8.0 习惯模块 UI 冒烟测试（守"用户验收过的原型交互能跑"）：
 *  1. 今天视图显示「今日习惯」区块；空状态给出去设置的入口
 *  2. 菜单 → 习惯设置：新建习惯（每天）→ 出现在今日区块，勾选打卡
 *  3. 每周频率：只在命中的星期几出现（用非命中日验证隔离）
 *  4. 暂停习惯 → 今日区块消失、设置列表仍可见；恢复后回来
 *  5. 删除习惯 → 列表与今日区块都消失
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
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

/** 打开习惯设置页（右上角菜单 → 习惯设置） */
async function openHabitSettings() {
  fireEvent.click(screen.getByRole('button', { name: '菜单' }))
  fireEvent.click(screen.getByRole('menuitem', { name: '习惯设置' }))
  await screen.findByRole('dialog', { name: '习惯设置' })
}

/** 在设置页新建一个习惯 */
async function createHabit(name: string, weekly: number[] | null) {
  fireEvent.click(screen.getByRole('button', { name: '＋ 新建习惯' }))
  fireEvent.change(screen.getByPlaceholderText('如：多喝水 / 运动 30 分钟'), { target: { value: name } })
  if (weekly) {
    fireEvent.click(screen.getByRole('button', { name: '每周' }))
    for (const d of weekly) fireEvent.click(screen.getByRole('button', { name: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d] }))
  }
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await screen.findByText(name)
}

describe('习惯模块（v8.0）', () => {
  it('今天视图有「今日习惯」区块；空状态引导去设置', async () => {
    await renderApp()
    expect(screen.getByText('今日习惯')).toBeInTheDocument()
    expect(screen.getByText(/还没有习惯，点这里去添加/)).toBeInTheDocument()
    // 点击空状态 → 打开习惯设置
    fireEvent.click(screen.getByRole('button', { name: /还没有习惯/ }))
    expect(await screen.findByRole('dialog', { name: '习惯设置' })).toBeInTheDocument()
  })

  it('新建习惯（每天）→ 今日区块出现，勾选打卡，计数更新', async () => {
    const store = await renderApp()
    await openHabitSettings()
    await createHabit('多喝水', null)

    // 关闭设置页 → 今天视图出现习惯行
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await screen.findByText('多喝水')
    expect(screen.getByText(/0\/1/)).toBeInTheDocument()

    // 勾选打卡
    fireEvent.click(screen.getByRole('button', { name: '打卡：多喝水' }))
    await waitFor(() => expect(screen.getByText(/1\/1/)).toBeInTheDocument())
    expect(store.getState().habitDay?.doneCount).toBe(1)
    // 再点 = 取消打卡
    fireEvent.click(screen.getByRole('button', { name: '取消打卡：多喝水' }))
    await waitFor(() => expect(screen.getByText(/0\/1/)).toBeInTheDocument())
  })

  it('每周习惯：只在命中的星期几出现在今日区块', async () => {
    await renderApp()
    await openHabitSettings()
    await createHabit('阅读', [1, 3]) // 周一、周三

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    // 2026-09-29 是周二 → 今日区块不显示「阅读」
    expect(screen.queryByText('阅读')).not.toBeInTheDocument()
    expect(screen.getByText(/0\/0/)).toBeInTheDocument()
  })

  it('暂停习惯 → 今日区块消失，设置列表仍可见可恢复', async () => {
    await renderApp()
    await openHabitSettings()
    await createHabit('运动 30 分钟', null)

    // 暂停
    fireEvent.click(screen.getByRole('switch', { name: '暂停习惯：运动 30 分钟' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '恢复习惯：运动 30 分钟' })).toBeInTheDocument())

    // 回今天：不显示；设置列表里仍可见
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.queryByText('运动 30 分钟')).not.toBeInTheDocument()

    // 恢复
    await openHabitSettings()
    fireEvent.click(screen.getByRole('switch', { name: '恢复习惯：运动 30 分钟' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: '暂停习惯：运动 30 分钟' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText('运动 30 分钟')).toBeInTheDocument()
  })

  it('删除习惯 → 今日区块回到空状态', async () => {
    await renderApp()
    await openHabitSettings()
    await createHabit('喝水', null)

    // 删除（confirm 弹窗 stub 为确认）
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '删除习惯：喝水' }))
    await waitFor(() => expect(screen.queryByText('喝水')).not.toBeInTheDocument())
    confirmSpy.mockRestore()

    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText(/还没有习惯，点这里去添加/)).toBeInTheDocument()
  })
})
