/**
 * v9.19 会员差异可视化：会员状态卡 / 配额金条 / AI 复盘锁定条 / 周报徽标 渲染与跳转测试。
 *
 * 覆盖四条打标链路（会员态 / 非会员态）：
 *  1. 账号设置页会员卡：会员态（金色卡+到期日+权益清单+账号徽标）/ 非会员态（试用剩余+未解锁+升级按钮聚焦兑换码）
 *  2. AI 智能导入配额金条：非会员「试用剩余 N 次」+「升级会员」→ 打开账号页
 *  3. 回顾页 AI 深度复盘锁定条：非会员「升级解锁」→ 打开账号页
 *  4. 通知设置周日周报「会员专属」金色徽标
 */
// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryStore, type DateKey } from '@core'
import { initCore } from '@/app/bootstrap'
import { createAppStore } from '@/app/store'
import { AppStoreContext } from '@/app/context'
import { AccountSettingsView } from './AccountSettingsView'
import { PurchaseView } from './PurchaseView'
import { AIImportView } from './AIImportView'
import { ReportView } from './ReportView'
import { NotificationSettingsView } from './NotificationSettingsView'

/** cloudbase mock：返回值由 CLOUD 变量控制（vi.hoisted 供 mock 工厂读取） */
const CLOUD = vi.hoisted(() => ({
  member: false,
  expires: null as string | null,
  deviceLimit: 1,
  mode: 'trial_total' as 'trial_total' | 'daily',
  remaining: 7,
}))

vi.mock('./cloudbase', () => ({
  ensureSession: vi.fn(async () => 'email'),
  getAccessToken: vi.fn(async () => 'tk'),
  getDeviceId: vi.fn(() => 'dev-1'),
  isCloudLoggedIn: vi.fn(() => true),
  fetchMember: vi.fn(async () => ({
    ok: true,
    member: CLOUD.member,
    memberExpiresAt: CLOUD.expires,
    deviceLimit: CLOUD.deviceLimit,
  })),
  fetchSyncStatus: vi.fn(async () => ({ ok: true, status: null })),
  aiQuota: vi.fn(async () => ({
    ok: true,
    member: CLOUD.member,
    mode: CLOUD.mode,
    remaining: CLOUD.remaining,
  })),
  aiImport: vi.fn(async () => ({ ok: false, error: 'x' })),
  aiReview: vi.fn(async () => ({ ok: false, error: 'x' })),
  redeemCode: vi.fn(async () => ({ ok: false, error: 'invalid_code' })),
  uploadSnapshot: vi.fn(async () => ({ ok: false, error: 'x' })),
  downloadSnapshot: vi.fn(async () => ({ ok: false, error: 'x' })),
  unbindDevice: vi.fn(async () => ({ ok: false, error: 'x' })),
  getCloudApp: vi.fn(() => ({ auth: () => ({ signOut: vi.fn(), signInWithOtp: vi.fn() }) })),
}))

afterEach(cleanup)

async function renderWithStore(node: ReactNode) {
  localStorage.clear()
  localStorage.setItem('daycell_skip_login', String(Date.now()))
  const bundle = await initCore({
    store: createMemoryStore(),
    skipLunar: true,
    now: (() => {
      let t = new Date(2026, 8, 29, 12).getTime()
      return () => (t += 1)
    })(),
  })
  const store = createAppStore(bundle, { today: '2026-09-29' as DateKey, isNarrow: () => false })
  await store.getState().init()
  render(<AppStoreContext.Provider value={store}>{node}</AppStoreContext.Provider>)
  return store
}

describe('v9.19 会员差异可视化', () => {
  it('账号页会员卡·会员态：金色卡 + 到期日 + 权益清单 + 账号「会员」徽标 + 续期按钮', async () => {
    CLOUD.member = true
    CLOUD.expires = '2026-11-28T00:00:00Z'
    CLOUD.deviceLimit = 5
    CLOUD.mode = 'daily'
    CLOUD.remaining = 100
    const store = await renderWithStore(<AccountSettingsView />)
    await waitFor(() => expect(screen.getByTestId('member-card-gold')).toBeInTheDocument())
    expect(screen.getByText('DayCell 会员')).toBeInTheDocument()
    // 到期日按 zh-CN 本地化：2026/11/28
    expect(screen.getByText(/有效期至/)).toBeInTheDocument()
    expect(screen.getByText('每日可用')).toBeInTheDocument()
    expect(screen.getByText('已解锁')).toBeInTheDocument()
    expect(screen.getByText('已开启')).toBeInTheDocument()
    expect(screen.getByText('5 台')).toBeInTheDocument()
    // 账号卡上的「会员」徽标
    expect(screen.getByTestId('member-badge')).toBeInTheDocument()
    // 兑换码行保留（续期入口）
    expect(screen.getByTestId('redeem-input')).toBeInTheDocument()
    // v9.20：续期会员按钮 → 打开购买说明页
    fireEvent.click(screen.getByTestId('renew-btn'))
    await waitFor(() => expect(store.getState().purchaseOpen).toBe(true))
  })

  it('账号页会员卡·非会员态：试用剩余 + 未解锁项 + 主按钮打开购买页 + 次按钮聚焦兑换码', async () => {
    CLOUD.member = false
    CLOUD.expires = null
    CLOUD.deviceLimit = 1
    CLOUD.mode = 'trial_total'
    CLOUD.remaining = 7
    const store = await renderWithStore(<AccountSettingsView />)
    await waitFor(() => expect(screen.getByTestId('member-card-free')).toBeInTheDocument())
    expect(screen.getByText('DayCell 免费版')).toBeInTheDocument()
    expect(screen.getByText('AI 整理试用剩余 7 次')).toBeInTheDocument()
    expect(screen.getAllByText('未解锁')).toHaveLength(2)
    expect(screen.getByText('仅 1 台')).toBeInTheDocument()
    expect(screen.queryByTestId('member-badge')).not.toBeInTheDocument()
    // v9.20：主按钮「获取兑换码 · 前往购买」→ 打开购买说明页
    fireEvent.click(screen.getByTestId('upgrade-btn'))
    await waitFor(() => expect(store.getState().purchaseOpen).toBe(true))
    // 次按钮「我有兑换码，去激活」→ 聚焦兑换码输入框（重新渲染，避免上一次残留 DOM）
    cleanup()
    await renderWithStore(<AccountSettingsView />)
    await waitFor(() => expect(screen.getByTestId('member-card-free')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('redeem-focus-btn'))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('redeem-input')))
  })

  it('购买说明页：¥4.9 定价卡 + 四项权益 + 爱发电外链 + FAQ 三条 + 兑换回填', async () => {
    CLOUD.member = false
    CLOUD.deviceLimit = 1
    CLOUD.mode = 'trial_total'
    CLOUD.remaining = 7
    const store = await renderWithStore(<PurchaseView />)
    await waitFor(() => expect(screen.getByTestId('purchase-card')).toBeInTheDocument())
    expect(screen.getByText('DayCell 会员 · 月卡')).toBeInTheDocument()
    expect(screen.getByText('¥4.9')).toBeInTheDocument()
    expect(screen.getByText('/ 30 天')).toBeInTheDocument()
    expect(screen.getByText('每日可用')).toBeInTheDocument()
    expect(screen.getByText('已解锁')).toBeInTheDocument()
    expect(screen.getByText('已开启')).toBeInTheDocument()
    expect(screen.getByText('最多 5 台')).toBeInTheDocument()
    // 外链 CTA：跳爱发电（新窗口）
    const cta = screen.getByTestId('purchase-cta') as HTMLAnchorElement
    expect(cta.href).toContain('afdian.net')
    expect(cta.target).toBe('_blank')
    // FAQ 三条
    expect(screen.getByText('付款后兑换码在哪里看？')).toBeInTheDocument()
    expect(screen.getByText('没收到码 / 码无效怎么办？')).toBeInTheDocument()
    expect(screen.getByText('兑换后有效期怎么算？')).toBeInTheDocument()
    // 兑换回填
    expect(screen.getByTestId('purchase-redeem-input')).toBeInTheDocument()
    expect(screen.getByTestId('purchase-redeem-btn')).toBeInTheDocument()
    // 返回按钮关闭购买页
    fireEvent.click(screen.getByText('← 返回'))
    expect(store.getState().purchaseOpen).toBe(false)
  })

  it('AI 导入配额金条：非会员「试用剩余 N 次」+ 升级会员 → 打开账号页', async () => {
    CLOUD.member = false
    CLOUD.mode = 'trial_total'
    CLOUD.remaining = 7
    const store = await renderWithStore(<AIImportView />)
    await waitFor(() => expect(screen.getByTestId('ai-quota')).toBeInTheDocument())
    expect(screen.getByText('AI 试用剩余 7 次')).toBeInTheDocument()
    const upgrade = screen.getByTestId('quota-upgrade')
    expect(upgrade).toBeInTheDocument()
    fireEvent.click(upgrade)
    await waitFor(() => expect(store.getState().accountOpen).toBe(true))
  })

  it('回顾页 AI 复盘锁定条：非会员「升级解锁」→ 打开账号页', async () => {
    CLOUD.member = false
    const store = await renderWithStore(<ReportView />)
    await waitFor(() => expect(screen.getByTestId('ai-lock')).toBeInTheDocument())
    expect(screen.getByText('AI 深度复盘（会员）')).toBeInTheDocument()
    expect(screen.getByText('让 AI 总结本周得失、给出下周建议')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ai-upgrade'))
    await waitFor(() => expect(store.getState().accountOpen).toBe(true))
  })

  it('通知设置周日周报：非会员显示金色「会员专属」徽标', async () => {
    CLOUD.member = false
    await renderWithStore(<NotificationSettingsView />)
    await waitFor(() => expect(screen.getByTestId('weekly-vip-tag')).toBeInTheDocument())
    expect(screen.getByText('会员专属')).toBeInTheDocument()
  })
})
