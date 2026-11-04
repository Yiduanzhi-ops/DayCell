/**
 * daycell-api 路由级自动化测试（#122，后端零测试补齐第一块）。
 *
 * 策略：
 *  - 云依赖包名经 vitest.config alias 指到 cloudbase/functions/__mocks__（CJS require 无法被 vi.mock 拦截）
 *  - 测试前把 globalThis.__daycell_test_db 设为链式 mock db（cloudbase-node-sdk 替身的 rdb() 返回它）
 *  - 直接构造网关 event（httpMethod/path/headers/body）调 exports.main，断言 statusCode/body
 *  - 双副本一致性：functions/daycell-api/index.js 与 cloudbase 副本 md5 必须一致（防漂移铁律）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const mod = await import('./index.js')
const { main } = mod

/** 链式 mock db：from(table) → select/eq/limit/... → await 返回 { data, error:null } */
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

const ev = (httpMethod, path, headers = {}, body = undefined) => ({
  httpMethod,
  path,
  headers,
  body,
  isBase64Encoded: false,
})

describe('daycell-api 路由（网关事件 → exports.main）', () => {
  beforeEach(() => {
    globalThis.__daycell_test_db = makeDb({ tables: { daycell_members: [] } })
    process.env.DEEPSEEK_API_KEY = 'test-key'
  })

  it('/health GET → 200 ok', async () => {
    const r = await main(ev('GET', '/health'))
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).ok).toBe(true)
  })

  it('OPTIONS 预检 → 204', async () => {
    const r = await main(ev('OPTIONS', '/push/subscribe'))
    expect(r.statusCode).toBe(204)
  })

  it('/me GET → 从 x-userid 头提取 uid（绝不接受自报）', async () => {
    const r = await main(ev('GET', '/me', { 'x-userid': 'u-123' }))
    expect(r.statusCode).toBe(200)
    const b = JSON.parse(r.body)
    expect(b.uid).toBe('u-123')
  })

  it('无 uid 时业务路由一律 401', async () => {
    for (const e of [
      ev('GET', '/member'),
      ev('GET', '/ai/quota'),
      ev('POST', '/sync/upload'),
      ev('POST', '/sync/device/unbind'),
      ev('POST', '/ai/import'),
      ev('POST', '/ai/review'),
      ev('POST', '/push/subscribe'),
    ]) {
      const r = await main(e)
      expect(r.statusCode).toBe(401)
      expect(JSON.parse(r.body).error).toBe('unauthorized')
    }
  })

  it('/codes/generate 无任何凭证 → 403 admin_only（不依赖用户登录，仅认平台侧凭证）', async () => {
    const r = await main(ev('POST', '/codes/generate', {}, JSON.stringify({ count: 3 })))
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).error).toBe('admin_only')
  })

  it('/codes/generate 普通登录用户 → 403 admin_only（生成码仅平台侧可调）', async () => {
    const r = await main(ev('POST', '/codes/generate', { 'x-userid': 'u-1' }, JSON.stringify({ count: 3 })))
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).error).toBe('admin_only')
  })

  it('/codes/generate 平台侧（x-usertype=B_SIDE_USER）→ 生成 3 个 30 天月卡码', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: { daycell_members: [], daycell_redeem_codes: [] },
    })
    const r = await main(
      ev(
        'POST',
        '/codes/generate',
        { 'x-userid': 'admin-1', 'x-usertype': 'B_SIDE_USER' },
        JSON.stringify({ count: 3 }),
      ),
    )
    expect(r.statusCode).toBe(200)
    const b = JSON.parse(r.body)
    expect(b.ok).toBe(true)
    expect(b.count).toBe(3)
    expect(b.plan).toBe('member_month')
    expect(b.days).toBe(30)
    expect(b.codes).toHaveLength(3)
    // 码格式：DC-XXXX-XXXX-XXXX（大写，不含 0O1I）
    for (const c of b.codes) expect(c).toMatch(/^DC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    // 入库行：code/plan/duration_days/status=unused
    const inserts = globalThis.__daycell_test_db._calls?.().filter((c) => c.op === 'insert') ?? []
    expect(inserts.length).toBe(1)
    expect(inserts[0].args[0]).toHaveLength(3)
    expect(inserts[0].args[0][0]).toMatchObject({ plan: 'member_month', duration_days: 30, status: 'unused' })
  })

  it('/ai/quota 非会员 → trial_total 模式（FREE_AI_TOTAL_LIMIT=5，读 ai_usage_total）', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: { daycell_members: [], ai_usage_total: [{ total_count: 3 }] },
    })
    const r = await main(ev('GET', '/ai/quota', { 'x-userid': 'u-1' }))
    expect(r.statusCode).toBe(200)
    const b = JSON.parse(r.body)
    expect(b.member).toBe(false)
    expect(b.mode).toBe('trial_total')
    expect(b.limit).toBe(5)
    expect(b.used).toBe(3)
    expect(b.remaining).toBe(2)
  })

  it('/ai/review 非会员 → 403 ai_review_requires_member 且不扣配额', async () => {
    globalThis.__daycell_test_db = makeDb({ tables: { daycell_members: [] } })
    const r = await main(ev('POST', '/ai/review', { 'x-userid': 'u-1' }, JSON.stringify({ feed: { week: [] } })))
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).error).toBe('ai_review_requires_member')
    // 不扣配额：ai_usage 不应被读取（连读都不发生，更不会 bump）
    const dbCalls = globalThis.__daycell_test_db._calls?.() ?? []
    expect(dbCalls.filter((c) => c.table === 'ai_usage').length).toBe(0)
  })

  it('/push/subscribe 缺 endpoint/p256dh/auth → 400 subscription_required', async () => {
    const r = await main(ev('POST', '/push/subscribe', { 'x-userid': 'u-1' }, JSON.stringify({ endpoint: 'x' })))
    expect(r.statusCode).toBe(400)
    expect(JSON.parse(r.body).error).toBe('subscription_required')
  })

  it('/push/subscribe 合法订阅 → upsert 写入，周报字段随体上报（weekly_time 缺省跟随晚间）', async () => {
    const upsertRows = []
    globalThis.__daycell_test_db = makeDb({
      tables: { daycell_members: [] },
    })
    // 捕获 upsert 行
    const orig = globalThis.__daycell_test_db.upsert
    globalThis.__daycell_test_db.upsert = (...args) => {
      upsertRows.push(args[0])
      return orig(...args)
    }
    const r = await main(
      ev(
        'POST',
        '/push/subscribe',
        { 'x-userid': 'u-1' },
        JSON.stringify({
          endpoint: 'https://push.example/e1',
          keys: { p256dh: 'p', auth: 'a' },
          morning: { enabled: true, time: '08:30' },
          evening: { enabled: true, time: '21:00' },
          weekly: { enabled: true, time: '20:30' },
        }),
      ),
    )
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).ok).toBe(true)
    const row = upsertRows[0]
    expect(row.morning_time).toBe('08:30')
    expect(row.evening_time).toBe('21:00')
    expect(row.weekly_enabled).toBe(true)
    expect(row.weekly_time).toBe('20:30')
  })

  it('/push/subscribe 周报未传 time → weekly_time 默认跟随晚间日报时间', async () => {
    const upsertRows = []
    globalThis.__daycell_test_db = makeDb({ tables: { daycell_members: [] } })
    const orig = globalThis.__daycell_test_db.upsert
    globalThis.__daycell_test_db.upsert = (...args) => {
      upsertRows.push(args[0])
      return orig(...args)
    }
    const r = await main(
      ev(
        'POST',
        '/push/subscribe',
        { 'x-userid': 'u-1' },
        JSON.stringify({
          endpoint: 'https://push.example/e2',
          keys: { p256dh: 'p', auth: 'a' },
          morning: { enabled: false },
          evening: { enabled: true, time: '22:00' },
          weekly: { enabled: true },
        }),
      ),
    )
    expect(r.statusCode).toBe(200)
    expect(upsertRows[0].weekly_time).toBe('22:00')
  })

  it('/sync/upload 新设备登记：insert 落库 device_id + device_name（设备名随上传上报）', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: { daycell_members: [], daycell_devices: [], daycell_snapshots: [] },
    })
    const r = await main(
      ev(
        'POST',
        '/sync/upload',
        { 'x-userid': 'u-1' },
        JSON.stringify({ snapshot: { todos: [] }, version: '1', deviceId: 'dev-new', deviceName: 'macOS · Chrome' }),
      ),
    )
    expect(r.statusCode).toBe(200)
    const calls = globalThis.__daycell_test_db._calls()
    const ins = calls.filter((c) => c.op === 'insert' && c.table === 'daycell_devices')
    expect(ins.length).toBe(1)
    expect(ins[0].args[0]).toMatchObject({ user_id: 'u-1', device_id: 'dev-new', device_name: 'macOS · Chrome' })
  })

  it('/sync/upload 已登记设备：update 刷新 last_seen 并补写 device_name', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_members: [],
        daycell_devices: [{ device_id: 'dev-old', device_name: '旧名' }],
        daycell_snapshots: [],
      },
    })
    const r = await main(
      ev(
        'POST',
        '/sync/upload',
        { 'x-userid': 'u-1' },
        JSON.stringify({ snapshot: { todos: [] }, version: '1', deviceId: 'dev-old', deviceName: 'iPhone · Safari' }),
      ),
    )
    expect(r.statusCode).toBe(200)
    const calls = globalThis.__daycell_test_db._calls()
    const upd = calls.filter((c) => c.op === 'update' && c.table === 'daycell_devices')
    expect(upd.length).toBe(1)
    expect(upd[0].args[0]).toMatchObject({ device_name: 'iPhone · Safari' })
    expect(upd[0].args[0].last_seen_at).toBeTruthy()
  })

  it('未知路径 → 404 not_found', async () => {
    const r = await main(ev('GET', '/nope'))
    expect(r.statusCode).toBe(404)
    expect(JSON.parse(r.body).error).toBe('not_found')
  })

  it('/sync/device/unbind 缺 deviceId → 400 device_id_required', async () => {
    const r = await main(ev('POST', '/sync/device/unbind', { 'x-userid': 'u-1' }, JSON.stringify({})))
    expect(r.statusCode).toBe(400)
    expect(JSON.parse(r.body).error).toBe('device_id_required')
  })

  it('/sync/device/unbind 合法解绑 → 200 ok，删除仅限本账号该设备', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: { daycell_members: [] },
    })
    const r = await main(
      ev(
        'POST',
        '/sync/device/unbind',
        { 'x-userid': 'u-1' },
        JSON.stringify({ deviceId: 'dev-b' }),
      ),
    )
    expect(r.statusCode).toBe(200)
    const b = JSON.parse(r.body)
    expect(b.ok).toBe(true)
    expect(b.deviceId).toBe('dev-b')
    expect(b.devices).toBe(0) // mock 静态数据，删除后重查仍返回 0 行
    expect(b.limit).toBe(1) // 非会员 FREE_DEVICE_LIMIT=1
    const dbCalls = globalThis.__daycell_test_db._calls?.() ?? []
    const del = dbCalls.filter((c) => c.op === 'delete' && c.table === 'daycell_devices')
    expect(del.length).toBe(1)
    // delete().eq('user_id', uid).eq('device_id', deviceId) 两次 eq 参数
    const eqs = dbCalls.filter((c) => c.op === 'eq' && c.table === 'daycell_devices')
    expect(eqs.some((c) => c.args[0] === 'user_id' && c.args[1] === 'u-1')).toBe(true)
    expect(eqs.some((c) => c.args[0] === 'device_id' && c.args[1] === 'dev-b')).toBe(true)
  })

  it('/sync/device/unbind 会员账号 → limit=5（MEMBER_DEVICE_LIMIT）', async () => {
    globalThis.__daycell_test_db = makeDb({
      tables: {
        daycell_members: [{ member_expires_at: '2099-01-01T00:00:00.000Z' }],
      },
    })
    const r = await main(
      ev(
        'POST',
        '/sync/device/unbind',
        { 'x-userid': 'u-1' },
        JSON.stringify({ deviceId: 'dev-a' }),
      ),
    )
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).limit).toBe(5)
  })
})

describe('双副本一致性（防漂移铁律）', () => {
  it('functions/daycell-api/index.js 与 cloudbase 副本 md5 一致', () => {
    const md5 = (p) => createHash('md5').update(readFileSync(p)).digest('hex')
    expect(md5(new URL('../../../functions/daycell-api/index.js', import.meta.url))).toBe(
      md5(new URL('./index.js', import.meta.url)),
    )
  })
})
