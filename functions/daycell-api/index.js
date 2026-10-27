// daycell-api 云函数 v0.3：HTTP 总入口 + 云同步（PostgreSQL 快照）
// 架构：网关已开启「身份认证」→ 请求必须带 Authorization: Bearer <accessToken|API Key>
//       → 网关通过 HTTP 头注入调用者身份（x-userid，/me 实测确认）→ 云函数用 uid 存取快照
// 安全底线：user_id 一律取自网关注入的登录身份，绝不接受请求方自报
const cloudbase = require('@cloudbase/node-sdk');

let app = null;
function getApp() {
  if (!app) {
    // 云函数内自动使用当前环境凭证（service_role，BYPASSRLS 可读写业务表）
    app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  }
  return app;
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: cors,
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  if (typeof event.body === 'object') return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

// 从 event 提取登录用户 uid
// 实测（/me 带 API Key 验证）：网关「身份认证」开启后，云函数不拿 event.userInfo/auth，
// 而是通过 HTTP 头注入身份 —— x-userid（登录用户 uid / API Key 管理员 uid）、
// x-usertype（B_SIDE_USER=平台侧）、x-authmethod、x-administrator。
// 登录用户访问时 x-userid 即该用户的 uid，云同步以此作为 user_id。
function extractUid(event) {
  const headers = event.headers || {};
  const hid =
    headers['x-userid'] ||
    headers['X-Userid'] ||
    headers['X-USERID'] ||
    headers['x-cloudbase-userid'];
  if (hid) return String(hid);
  // 兜底：部分形态下的旧字段兼容
  const sources = [
    event.userInfo,
    event.auth,
    event.requestContext && event.requestContext.identity,
  ];
  for (const s of sources) {
    if (!s) continue;
    const uid = s.uid || s.openId || s.openid || s.userId || s.sub;
    if (uid) return String(uid);
  }
  return null;
}

// 上传整包快照
async function uploadSnapshot(event, uid) {
  const body = parseBody(event);
  const snapshot = body.snapshot;
  const version = body.version || '1';
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return json(400, { ok: false, error: 'snapshot_required' });
  }
  const db = getApp().rdb();
  try {
    const res = await db
      .from('daycell_snapshots')
      .insert({ user_id: uid, snapshot, version })
      .select('*');
    const row = res.data && res.data[0];
    // 立即回查，验证写入是否真正落库（诊断用）
    let check = { rows: 0, firstId: null };
    try {
      const c = await db.from('daycell_snapshots').select('*').eq('user_id', uid);
      check = { rows: (c.data || []).length, firstId: c.data && c.data[0] ? c.data[0].id : null };
    } catch (e2) {
      check.error = String((e2 && e2.message) || e2);
    }
    return json(200, {
      ok: true,
      id: row ? row.id : null,
      insertError: res.error ? JSON.stringify(res.error) : null,
      insertStatus: res.status || null,
      check,
    });
  } catch (e) {
    return json(500, { ok: false, error: 'db_write_failed', detail: String(e && e.message || e) });
  }
}

// 拉取最新整包快照
async function downloadSnapshot(uid) {
  const db = getApp().rdb();
  try {
    const res = await db
      .from('daycell_snapshots')
      .select('snapshot, version, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(1);
    const row = res.data && res.data[0];
    if (!row) {
      return json(404, { ok: false, error: 'no_snapshot' });
    }
    return json(200, { ok: true, snapshot: row.snapshot, version: row.version, savedAt: row.created_at });
  } catch (e) {
    return json(500, { ok: false, error: 'db_read_failed', detail: String(e && e.message || e) });
  }
}

exports.main = async (event, context) => {
  const method = event.httpMethod || 'GET';
  const path = (event.path || '/').split('?')[0];

  // CORS 预检
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  // 健康检查（网关鉴权已开启，需带有效 token）
  if (path === '/health' && method === 'GET') {
    return json(200, { ok: true, service: 'daycell-api', version: 'v0.3', time: new Date().toISOString() });
  }

  // 调试：返回 event 结构 + 提取到的 uid（实测确认字段用，可随时移除）
  if (path === '/me' && method === 'GET') {
    const headers = event.headers || {};
    return json(200, {
      ok: true,
      uid: extractUid(event),
      eventKeys: Object.keys(event || {}),
      identity: {
        x_userid: headers['x-userid'] || null,
        x_usertype: headers['x-usertype'] || null,
        x_authmethod: headers['x-authmethod'] || null,
        x_administrator: headers['x-administrator'] || null,
      },
    });
  }

  // 调试：返回当前数据库角色（诊断权限问题用，可随时移除）
  if (path === '/dbwho' && method === 'GET') {
    try {
      const res = await getApp().rdb().rpc('whoami');
      return json(200, { ok: true, dbRole: res.data, rpcError: res.error ? JSON.stringify(res.error) : null });
    } catch (e) {
      return json(500, { ok: false, error: 'rpc_failed', detail: String(e && e.message || e) });
    }
  }

  // 云同步：上传
  if (path === '/sync/upload' && method === 'POST') {
    const uid = extractUid(event);
    if (!uid) return json(401, { ok: false, error: 'unauthorized' });
    return uploadSnapshot(event, uid);
  }

  // 云同步：下载
  if (path === '/sync/download' && method === 'GET') {
    const uid = extractUid(event);
    if (!uid) return json(401, { ok: false, error: 'unauthorized' });
    return downloadSnapshot(uid);
  }

  return json(404, { ok: false, error: 'not_found', path });
};
