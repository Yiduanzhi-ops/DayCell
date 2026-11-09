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
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { App } from './App'

afterEach(cleanup)

const TODAY = '2026-09-29' as DateKey

async function renderApp() {
  localStorage.clear()
  const bundle = await initCore({
    store: createMemoryStore(),
    skipLunar: true,
    // v8.57：注入与 TODAY 一致的递增假时钟——createdAt 落在 9/29，
    // 习惯「只从设定那天起出现」的过滤语义才自洽（此前用真实时钟，createdAt 晚于视图日被过滤）。
    now: (() => { let t = new Date(2026, 8, 29, 12).getTime(); return () => (t += 1) })(),
  })
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

  it('原地编辑习惯：改名 + 改频率 → 列表与今日区块同步更新', async () => {
    await renderApp()
    await openHabitSettings()
    await createHabit('喝水', null) // 每天

    // 打开编辑：名称与频率预填
    fireEvent.click(screen.getByRole('button', { name: '编辑习惯：喝水' }))
    expect(await screen.findByRole('dialog', { name: '编辑习惯' })).toBeInTheDocument()
    const input = screen.getByPlaceholderText('如：多喝水 / 运动 30 分钟') as HTMLInputElement
    expect(input.value).toBe('喝水')

    // 改名 + 改成每周周三
    fireEvent.change(input, { target: { value: '阅读' } })
    fireEvent.click(screen.getByRole('button', { name: '每周' }))
    fireEvent.click(screen.getByRole('button', { name: '周三' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByText('喝水')).not.toBeInTheDocument())
    expect(screen.getByText('阅读')).toBeInTheDocument()
    expect(screen.getByText(/每周/)).toBeInTheDocument() // 频率徽标更新

    // 回今天：9/29 是周二，周三习惯不出现 → 今日区块无「阅读」（改频率生效）
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(screen.queryByText('阅读')).not.toBeInTheDocument()
  })

  it('长按拖动换序：松手后顺序持久化到列表与今日区块', async () => {
    const store = await renderApp()
    await openHabitSettings()
    await createHabit('喝水', null)
    await createHabit('运动', null)
    expect(store.getState().habitList.map((h) => h.name)).toEqual(['喝水', '运动'])

    // jsdom 缺 setPointerCapture → 打桩
    if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, writable: true })
    }
    const overlay = screen.getByRole('dialog', { name: '习惯设置' })
    const row = within(overlay).getByText('喝水').closest('li')!
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 0, clientY: 0 })
    await new Promise((r) => setTimeout(r, 260)) // 长按激活拖拽
    // jsdom rect 全 0 → 指针落点判为末尾 → 喝水拖到最后
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(row, { pointerId: 1, clientX: 0, clientY: 0 })

    await waitFor(() => expect(store.getState().habitList.map((h) => h.name)).toEqual(['运动', '喝水']), {
      timeout: 5000,
    })
    // 今日区块与列表同源（refreshHabits 排序后全量下发），回今天确认渲染不报错
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    expect(await screen.findByText('运动')).toBeInTheDocument()
    expect(screen.getByText('喝水')).toBeInTheDocument()
  })

  it('按住拖拽柄立即换序：无需长按停顿（v8.71）', async () => {
    const store = await renderApp()
    await openHabitSettings()
    await createHabit('喝水', null)
    await createHabit('运动', null)
    expect(store.getState().habitList.map((h) => h.name)).toEqual(['喝水', '运动'])

    if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, writable: true })
    }
    const overlay = screen.getByRole('dialog', { name: '习惯设置' })
    const handle = within(overlay).getByRole('button', { name: '拖动排序：喝水' })
    // 按下手柄即激活（无 180ms 等待），立刻拖动换序
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 0, clientY: 0 })
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 0, clientY: 0 })

    await waitFor(() => expect(store.getState().habitList.map((h) => h.name)).toEqual(['运动', '喝水']), {
      timeout: 5000,
    })
  })

  // v9.37 拖拽三连回归：插入位偏移（拖过一格）、同位置反复 move 抖动、松手弹回旧序
  it('拖拽中间插入不过冲，且同一位置反复 move 顺序稳定、松手不弹回', async () => {
    const store = await renderApp()
    await openHabitSettings()
    await createHabit('A', null)
    await createHabit('B', null)
    await createHabit('C', null)
    // 给每行真实坐标（行高 50）：A=0~50 / B=50~100 / C=100~150
    HTMLLIElement.prototype.getBoundingClientRect = function () {
      const idx = this.parentElement ? Array.prototype.indexOf.call(this.parentElement.children, this) : 0
      const top = idx * 50
      return { top, height: 50, bottom: top + 50, left: 0, right: 300, width: 300, x: 0, y: top } as DOMRect
    }
    const proto = HTMLLIElement.prototype as unknown as Record<string, unknown>
    if (typeof HTMLElement.prototype.setPointerCapture !== 'function') {
      Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => {}, writable: true })
    }
    const overlay = screen.getByRole('dialog', { name: '习惯设置' })
    const order = () =>
      [...overlay.querySelectorAll('li[data-hid]')].map(
        (li) => li.querySelector('[class*="itemTitle"]')?.textContent ?? '',
      )
    const handle = within(overlay).getByRole('button', { name: '拖动排序：A' })
    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 0, clientY: 10 })
    // 指针落在 B 中心(75)以下、C 中心(125)以上 → 应插到 B、C 之间
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 0, clientY: 90 })
    expect(order()).toEqual(['B', 'A', 'C'])
    // 指针不动再派发两次 move：必须维持同一顺序，不能来回跳
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 0, clientY: 90 })
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 0, clientY: 90 })
    expect(order()).toEqual(['B', 'A', 'C'])
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 0, clientY: 90 })
    // 松手瞬间不能弹回 [A,B,C]
    expect(order()).toEqual(['B', 'A', 'C'])
    await waitFor(() => expect(store.getState().habitList.map((h) => h.name)).toEqual(['B', 'A', 'C']))
    delete proto.getBoundingClientRect
  })

  it('换序后外层（今日习惯数据源）跟随同一顺序', async () => {
    const store = await renderApp()
    await openHabitSettings()
    await createHabit('A', null)
    await createHabit('B', null)
    await createHabit('C', null)
    const idOf = (n: string) => store.getState().habitList.find((h) => h.name === n)!.id
    await store.getState().reorderHabits([idOf('C'), idOf('A'), idOf('B')])
    await waitFor(() => expect(store.getState().habitList.map((h) => h.name)).toEqual(['C', 'A', 'B']))
    // 今日习惯区块 / 周视图 / 侧页统一走 aggregate 的 buildHabitItems
    await waitFor(() => expect(store.getState().habitDay?.items.map((i) => i.name)).toEqual(['C', 'A', 'B']))
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
