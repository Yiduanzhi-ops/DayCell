/**
 * daycell-push-worker 自动化测试（#122 第二块）。
 *
 * 策略：
 *  - vi.mock 掉 web-push（sendNotification 打桩）与 @cloudbase/node-sdk（db 打桩）
 *  - 纯函数直接测：buildMorningReport / buildEveningReport / buildWeeklyReport / 时间工具
 *  - main() 用测试模式 event.test 驱动：断言档位匹配、去重、会员门控、404/410 清理
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 云依赖经 vitest.config alias 指到 __mocks__（CJS require 无法被 vi.mock 拦截）：
//  - @cloudbase/node-sdk → rdb() 返回 globalThis.__daycell_test_db
//  - web-push → sendNotification 记录到 globalThis.__daycell_sent，可经 __daycell_send_error 注入 410/404
const mod = await import('./index.js')
const { main } = mod
const { buildMorningReport, buildEveningReport, buildWeeklyReport, weekMonday, dowOf } = mod

/** 链式 mock db：from(table) → select/eq/limit/order/... → await 返回 { data, error:null } */
function makeDb({ tables = {} } = {}) {
  const calls = []
  const chain = {
    then(resolve) {
      const last = calls[calls.length - 1]
      const table = last && last.table
      const data = tables[table] ?? []
      resolve({ data, error: null })
    },
  }
  for (const m of ['select', 'eq', 'limit', 'order', 'insert', 'update', 'delete', 'upsert', 'rpc']) {
    chain[m] = (...args) => {
      calls.push({ table: chain._table, op: m, args })
      return chain
    }
  }
  chain.from = (table) => {
    chain._table = table
    return chain
  }
  chain._calls = () => calls
  return chain
}

/** 最小快照工厂：只填要断言的字段 */
function snap(overrides = {}) {
  return {
    data: {
      todos: [],
      habits: [],
      checkins: [],
      anniversaries: [],
      goals: [],
      ...overrides,
    },
  }
}

const SUB = {
  user_id: 'u-1',
  endpoint: 'https://push.example/e1',
  p256dh: 'p',
  auth: 'a',
  morning_enabled: true,
  morning_time: '08:00',
  evening_enabled: true,
  evening_time: '21:00',
  weekly_enabled: true,
  weekly_time: '21:00',
  timezone: 'Asia/Shanghai',
}

describe('push-worker 纯函数', () => {
  it('早间日报：昨日遗留 + 今日待办 + 今日习惯 + 特殊日', () => {
    const r = buildMorningReport(
      snap({
        todos: [
          { date: '2026-11-01', text: '跑步', done: false, time: null },
          { date: '2026-11-02', text: '写周报', done: false, time: '09:00' },
          { date: '2026-11-02', text: '买菜', done: true, time: null },
        ],
        habits: [{ id: 'h1', name: '喝水', createdAt: 0, freq: { kind: 'daily' } }],
        anniversaries: [{ id: 'a1', title: '纪念日X', date: '2026-11-02', repeat: 'yearly' }],
      }),
      '2026-11-02',
    )
    expect(r[0]).toContain('昨日遗留 1 条')
    // activeTodos 排除已完成（done）——「买菜」不计数，语义：今日待办 = 尚未完成
    expect(r[1]).toContain('今日待办 1 条')
    expect(r[1]).toContain('09:00 写周报')
    expect(r[2]).toContain('今日习惯 1 项')
    expect(r[3]).toContain('纪念日X')
  })

  it('晚间日报：完成度 + 未完成 + 习惯打卡 + 即将截止', () => {
    const r = buildEveningReport(
      snap({
        todos: [
          { date: '2026-11-02', text: 'A', done: true, time: null },
          { date: '2026-11-02', text: 'B', done: false, time: '19:00' },
          { date: '2026-11-09', text: 'DDL', done: false, timeType: 'due' },
        ],
        habits: [
          { id: 'h1', name: '喝水', createdAt: 0, freq: { kind: 'daily' } },
          { id: 'h2', name: '阅读', createdAt: 0, freq: { kind: 'daily' } },
        ],
        checkins: [{ habitId: 'h1', date: '2026-11-02' }],
      }),
      '2026-11-02',
    )
    expect(r[0]).toBe('今日待办完成 1/2')
    expect(r[1]).toContain('未完成')
    expect(r.join('\n')).toContain('习惯打卡 1/2')
    expect(r.join('\n')).toContain('即将截止')
  })

  it('周报：本周完成率 + 习惯打卡 + 进行中目标 + 本周特殊日（周日口径）', () => {
    // 2026-11-01 是周日；本周 = 10-26（周一）~ 11-01
    expect(dowOf('2026-11-01')).toBe(0)
    expect(weekMonday('2026-11-01')).toBe('2026-10-26')
    const r = buildWeeklyReport(
      snap({
        todos: [
          { date: '2026-10-27', text: 'A', done: true },
          { date: '2026-10-29', text: 'B', done: true },
          { date: '2026-11-01', text: 'C', done: false },
        ],
        habits: [{ id: 'h1', name: '喝水', createdAt: 0, freq: { kind: 'daily' } }],
        checkins: [
          { habitId: 'h1', date: '2026-10-27' },
          { habitId: 'h1', date: '2026-10-29' },
          { habitId: 'h1', date: '2026-11-01' },
        ],
        goals: [{ id: 'g1', title: 'G', done: false }, { id: 'g2', title: 'D', done: true }],
        anniversaries: [{ id: 'a1', title: '纪念日X', date: '2026-10-28', repeat: 'yearly' }],
      }),
      '2026-11-01',
    )
    expect(r[0]).toBe('本周待办完成 2/3')
    expect(r.join('\n')).toContain('习惯打卡 3/7 次')
    expect(r.join('\n')).toContain('进行中目标 1 个')
    expect(r.join('\n')).toContain('纪念日X')
  })
})

describe('push-worker main（测试模式）', () => {
  beforeEach(() => {
    globalThis.__daycell_sent = []
    process.env.VAPID_PUBLIC_KEY = 'pub'
    process.env.VAPID_PRIVATE_KEY = 'priv'
    process.env.VAPID_SUBJECT = 'mailto:test@example.com'
    process.env.APP_URL = '/'
  })

  it('测试模式连发早+晚，且不写 last_*_sent（不污染去重状态）', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_push_subscriptions: [SUB],
        daycell_snapshots: [{ snapshot: snap() }],
      },
    })
    const r = await main({ test: { time: '21:00', date: '2026-11-02', morning: true, evening: true } })
    expect(r.ok).toBe(true)
    expect(r.sent).toBe(2)
    const titles = globalThis.__daycell_sent.map((x) => x.payload.title)
    expect(titles).toContain('DayCell 早间日报')
    expect(titles).toContain('DayCell 晚间日报')
    // 测试模式不 update：db 上没有 update 调用
    const calls = globalThis.__daycell_test_db._calls()
    expect(calls.filter((c) => c.op === 'update').length).toBe(0)
  })

  it('非 timer 非 test 事件 → 拒绝', async () => {
    const r = await main({ Type: 'HTTP' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not_timer_event')
  })

  it('测试模式全关 → 一条不发（morning/evening/weekly 分支的短路路径）', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_push_subscriptions: [SUB],
        daycell_snapshots: [{ snapshot: snap() }],
      },
    })
    const r = await main({
      test: { time: '21:00', date: '2026-11-02', morning: false, evening: false, weekly: false },
    })
    expect(r.ok).toBe(true)
    expect(r.sent).toBe(0)
    expect(globalThis.__daycell_sent.length).toBe(0)
  })

  it('周日晚周报：会员命中 → 发送并记 weeklySent；非会员 → 跳过不推', async () => {
    // 周日 2026-11-01，weekly_time=21:00 命中 hm
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_push_subscriptions: [SUB],
        daycell_snapshots: [{ snapshot: snap({ todos: [{ date: '2026-10-27', text: 'A', done: true }] }) }],
        daycell_members: [{ user_id: 'u-1', member_expires_at: '2027-01-01' }],
      },
    })
    const r = await main({ test: { time: '21:00', date: '2026-11-01', morning: false, evening: false, weekly: true } })
    expect(r.ok).toBe(true)
    expect(r.weeklySent).toBe(1)
    expect(globalThis.__daycell_sent[0].payload.title).toBe('DayCell 周报')
    expect(globalThis.__daycell_sent[0].payload.body).toContain('本周待办完成 1/1')

    // 非会员：member 表空 → 跳过
    globalThis.__daycell_sent = []
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_push_subscriptions: [SUB],
        daycell_snapshots: [{ snapshot: snap() }],
        daycell_members: [],
      },
    })
    const r2 = await main({ test: { time: '21:00', date: '2026-11-01', morning: false, evening: false, weekly: true } })
    expect(r2.weeklySent).toBe(0)
    expect(r2.weeklySkippedNonMember).toBe(1)
    expect(globalThis.__daycell_sent.length).toBe(0)
  })

  it('404/410 → 清理失效订阅', async () => {
    globalThis.__daycell_send_error = { statusCode: 410 }
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_push_subscriptions: [SUB],
        daycell_snapshots: [{ snapshot: snap() }],
      },
    })
    const r = await main({ test: { time: '21:00', date: '2026-11-02', morning: true, evening: false } })
    expect(r.ok).toBe(true)
    expect(r.cleaned).toBe(1)
    const calls = globalThis.__daycell_test_db._calls()
    expect(calls.filter((c) => c.op === 'delete').length).toBe(1)
  })
})
