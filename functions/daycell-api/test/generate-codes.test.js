// daycell-api /codes/generate 批量生成兑换码接口单测（node:test + mock @cloudbase/node-sdk）
// 运行：node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');

function makeFakeDb() {
  const state = {
    selectRows: [], // .select() 时返回的 data
    inserted: null, // .insert(rows) 收到的 rows
    calls: [],
  };
  const chain = {
    data: null,
    error: null,
    from() { state.calls.push('from'); return chain; },
    select() { state.calls.push('select'); chain.data = state.selectRows; return chain; },
    eq() { return chain; },
    limit() { return chain; },
    insert(rows) { state.calls.push('insert'); state.inserted = rows; chain.data = null; return chain; },
    update() { return chain; },
    delete() { return chain; },
  };
  return { chain, state };
}

function loadApi(existingCodes) {
  const db = makeFakeDb();
  db.state.selectRows = (existingCodes || []).map((code) => ({ code }));
  const fakeCloudbase = {
    SYMBOL_CURRENT_ENV: 'sym',
    init() {
      return { rdb: () => db.chain };
    },
  };
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@cloudbase/node-sdk') return fakeCloudbase;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve('../index.js')];
  const api = require('../index.js');
  Module._load = origLoad;
  return { api, db };
}

function callGenerate(api, headers, body) {
  return api.main({
    httpMethod: 'POST',
    path: '/codes/generate',
    headers,
    body: JSON.stringify(body),
  });
}

const CODE_RE = /^DC-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

test('非平台侧调用返回 403 admin_only', async () => {
  const { api } = loadApi([]);
  const res = await callGenerate(api, { 'x-userid': 'u1' }, { count: 5, days: 30 });
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(body.error, 'admin_only');
});

test('平台侧生成 3 个 30 天月卡码：格式正确 + 插入行正确', async () => {
  const { api, db } = loadApi([]);
  const res = await callGenerate(
    api,
    { 'x-userid': 'admin', 'x-usertype': 'B_SIDE_USER' },
    { count: 3, days: 30 }
  );
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.count, 3);
  assert.strictEqual(body.plan, 'member_month');
  assert.strictEqual(body.days, 30);
  assert.strictEqual(body.codes.length, 3);
  for (const c of body.codes) assert.match(c, CODE_RE);
  const rows = db.state.inserted;
  assert.strictEqual(rows.length, 3);
  for (const r of rows) {
    assert.match(r.code, CODE_RE);
    assert.strictEqual(r.plan, 'member_month');
    assert.strictEqual(r.duration_days, 30);
    assert.strictEqual(r.status, 'unused');
  }
});

test('365 天年卡码（plan=member_year）正常生成', async () => {
  const { api, db } = loadApi([]);
  const res = await callGenerate(
    api,
    { 'x-userid': 'admin', 'x-usertype': 'B_SIDE_USER' },
    { count: 2, days: 365, plan: 'member_year' }
  );
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(body.days, 365);
  assert.strictEqual(body.plan, 'member_year');
  assert.strictEqual(db.state.inserted[0].duration_days, 365);
});

test('非法天数返回 400 days_must_be_30_or_365', async () => {
  const { api } = loadApi([]);
  const res = await callGenerate(
    api,
    { 'x-userid': 'admin', 'x-usertype': 'B_SIDE_USER' },
    { count: 2, days: 100 }
  );
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(body.error, 'days_must_be_30_or_365');
});

test('count 上限截断到 500 且无重复', async () => {
  const { api, db } = loadApi([]);
  const res = await callGenerate(
    api,
    { 'x-userid': 'admin', 'x-usertype': 'B_SIDE_USER' },
    { count: 999, days: 30 }
  );
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(body.count, 500);
  assert.strictEqual(body.codes.length, 500);
  assert.strictEqual(new Set(body.codes).size, 500);
  assert.strictEqual(db.state.inserted.length, 500);
});

test('与已有码不重复（避开 PK 冲突）', async () => {
  const existing = ['DC-AAAA-BBBB-CCCC', 'DC-DDDD-EEEE-FFFF'];
  const { api } = loadApi(existing);
  const res = await callGenerate(
    api,
    { 'x-userid': 'admin', 'x-usertype': 'B_SIDE_USER' },
    { count: 10, days: 30 }
  );
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  for (const c of body.codes) {
    assert.ok(!existing.includes(c), `生成的码 ${c} 与已有码重复`);
  }
});

test('管理端通过 x-administrator 头也可生成', async () => {
  const { api } = loadApi([]);
  const res = await callGenerate(
    api,
    { 'x-userid': 'admin', 'x-administrator': '1' },
    { count: 1, days: 30 }
  );
  const body = JSON.parse(res.body);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(body.count, 1);
});
