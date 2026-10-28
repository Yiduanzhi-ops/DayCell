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

// ========== AI 智能导入（v9.2）：自由文本 → 结构化 JSON ==========
// 架构：前端把一段话 POST 到这里 → 本函数直连 DeepSeek 官方 API（OpenAI 兼容）
//       → 模型返回结构化 JSON → 前端预览、用户确认后才写入本地（本函数不落库）
// 安全：DeepSeek key 只存在于云函数环境变量（process.env.DEEPSEEK_API_KEY），
//       不写入代码、不进 git、不返回给前端。
// v0.5 限额：每人每天 15 次（ai_usage 表按 user_id+usage_date 计数；免费额度 v1，
//       将来会员差分只改 AI_DAILY_LIMIT 或按用户分档）。失败不消耗次数。
const AI_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const AI_DAILY_LIMIT = 15;

// 中国时区日期（云函数默认 UTC，直接 toISOString 会差半天）
function chinaDateKey() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 读某用户当天已用次数（读失败按 0 处理，宽松不阻塞）
async function readAiUsage(db, uid, todayKey) {
  try {
    const res = await db
      .from('ai_usage')
      .select('count')
      .eq('user_id', uid)
      .eq('usage_date', todayKey)
      .limit(1);
    const row = res.data && res.data[0];
    return row ? Number(row.count) || 0 : 0;
  } catch (e) {
    return 0;
  }
}

// AI 成功调用后 +1（显式 INSERT/UPDATE，不依赖 upsert 特定语法；
// 失败 console.error 留痕，但不阻塞主流程）
async function bumpAiUsage(db, uid, todayKey) {
  try {
    const used = await readAiUsage(db, uid, todayKey);
    const next = used + 1;
    if (used === 0) {
      // 当天无记录：先尝试 INSERT，若并发已存在则改 UPDATE
      const ins = await db.from('ai_usage').insert({ user_id: uid, usage_date: todayKey, count: 1 });
      if (ins.error) {
        await db.from('ai_usage').update({ count: next }).eq('user_id', uid).eq('usage_date', todayKey);
      }
    } else {
      await db.from('ai_usage').update({ count: next }).eq('user_id', uid).eq('usage_date', todayKey);
    }
    return true;
  } catch (e) {
    console.error('[ai_usage] bump failed:', e && e.message || e);
    return false;
  }
}

function buildImportPrompt(text, today) {
  return {
    role: 'system',
    content:
      '你是 DayCell 待办/习惯/笔记/目标应用的智能整理助手。' +
      '用户会发来一段日常流水账（可能混有今天的待办、想法、想养成的习惯、目标等）。' +
      '你的任务：把它整理成结构化 JSON，供用户确认后导入。\n' +
      '【输出格式】只输出一个 JSON 对象，不要任何解释文字或 Markdown 代码块，结构如下：\n' +
      '{\n' +
      '  "todos": [{"text": "待办内容", "date": "YYYY-MM-DD", "deadline": null | "YYYY-MM-DD"}],\n' +
      '  "habits": [{"name": "习惯名", "freq": {"kind": "daily"} | {"kind": "weekly", "weekdays": [0-6]}}],\n' +
      '  "notes": [{"text": "想法/笔记内容"}],\n' +
      '  "goals": [{"title": "目标标题", "note": "一句话阐述"}]\n' +
      '}\n' +
      '【规则】\n' +
      '1. 日期语义：今天用 "' + today + '"；"明天/后天/下周一"等按今天 ' + today + ' 推算成具体 YYYY-MM-DD；没提时间的待办默认今天。\n' +
      '2. 习惯：重复性动作（每天/每周几/隔天）归 habits；"每周一三五"→ {"kind":"weekly","weekdays":[1,3,5]}；星期映射 0=周日 6=周六。\n' +
      '3. 想法、感慨、模糊内容归 notes；明确的长期目标/想达成的方向归 goals。' +
      '4. **纪念日/周年等周期性日期（如"妈妈生日"）、复盘/回顾类内容（如"今天过得怎么样"）、' +
      '某目标下的子任务（如"为减肥每周跑三次"）一律归 notes，不要新增其他分类**。\n' +
      '5. 无法识别或空内容：对应数组给空数组，不要编造。\n' +
      '6. 所有 text/name/title 保留用户原意，适度精简但不要改写语义。',
  };
}

async function aiImport(event, uid) {
  const body = parseBody(event);
  const text = (body.text || '').toString().trim();
  const todayKey = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : chinaDateKey();
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const db = getApp().rdb();

  if (!text) return json(400, { ok: false, error: 'text_required' });
  if (!apiKey) return json(503, { ok: false, error: 'ai_not_configured', detail: 'DEEPSEEK_API_KEY 未配置' });

  // v0.5 每日限额：>=15 直接拒绝（不消耗次数）
  const used = await readAiUsage(db, uid, todayKey);
  if (used >= AI_DAILY_LIMIT) {
    return json(429, {
      ok: false,
      error: 'ai_quota_exceeded',
      limit: AI_DAILY_LIMIT,
      remaining: 0,
      date: todayKey,
    });
  }

  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          buildImportPrompt(text, todayKey),
          { role: 'user', content: text },
        ],
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' }, // 非思考模式：省 token、快，结构化抽取足够
        max_tokens: 2000,
      }),
      timeout: 25000,
    });

    const data = await resp.json();
    if (!resp.ok) {
      return json(502, { ok: false, error: 'ai_upstream_error', detail: String(data.error && data.error.message || data) });
    }
    const content = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : null;
    if (!content) return json(502, { ok: false, error: 'ai_empty_response' });

    // 容错：模型可能用 ```json 包裹
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let structured;
    try {
      structured = JSON.parse(cleaned);
    } catch (e) {
      return json(502, { ok: false, error: 'ai_bad_json', detail: String(e && e.message || e) });
    }

    // 成功后计数 +1（失败不消耗；bump 失败宽容处理）
    await bumpAiUsage(db, uid, todayKey);

    return json(200, {
      ok: true,
      today: todayKey,
      structured: {
        todos: Array.isArray(structured.todos) ? structured.todos : [],
        habits: Array.isArray(structured.habits) ? structured.habits : [],
        notes: Array.isArray(structured.notes) ? structured.notes : [],
        goals: Array.isArray(structured.goals) ? structured.goals : [],
      },
      usage: data.usage || null,
      quota: {
        limit: AI_DAILY_LIMIT,
        remaining: Math.max(0, AI_DAILY_LIMIT - used - 1),
        date: todayKey,
      },
    });
  } catch (e) {
    // 调用失败不计数
    return json(500, { ok: false, error: 'ai_call_failed', detail: String(e && e.message || e) });
  }
}

// ========== Web Push 订阅（v9.3）：/push/subscribe + /push/unsubscribe ==========
// 订阅与早晚通知开关一体 upsert：前端每次保存设置都带完整 PushSubscription 重传；
// 实际推送由独立函数 daycell-push-worker（timer 触发）执行，本函数只负责存储。
function isHHmm(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

async function pushSubscribe(event, uid) {
  const body = parseBody(event);
  const endpoint = (body.endpoint || '').toString();
  const keys = body.keys || {};
  const p256dh = (keys.p256dh || '').toString();
  const auth = (keys.auth || '').toString();
  if (!endpoint || !p256dh || !auth) {
    return json(400, { ok: false, error: 'subscription_required' });
  }
  const morning = body.morning || {};
  const evening = body.evening || {};
  const morningTime = isHHmm(morning.time) ? morning.time : '08:00';
  const eveningTime = isHHmm(evening.time) ? evening.time : '21:00';
  const timezone =
    typeof body.timezone === 'string' && body.timezone ? body.timezone : 'Asia/Shanghai';
  const db = getApp().rdb();
  const now = new Date();
  try {
    const existing = await db
      .from('daycell_push_subscriptions')
      .select('id')
      .eq('user_id', uid)
      .eq('endpoint', endpoint)
      .limit(1);
    if (existing.data && existing.data[0]) {
      await db
        .from('daycell_push_subscriptions')
        .update({
          p256dh,
          auth,
          morning_enabled: !!morning.enabled,
          morning_time: morningTime,
          evening_enabled: !!evening.enabled,
          evening_time: eveningTime,
          timezone,
          updated_at: now,
        })
        .eq('user_id', uid)
        .eq('endpoint', endpoint);
    } else {
      const ins = await db
        .from('daycell_push_subscriptions')
        .insert({
          user_id: uid,
          endpoint,
          p256dh,
          auth,
          morning_enabled: !!morning.enabled,
          morning_time: morningTime,
          evening_enabled: !!evening.enabled,
          evening_time: eveningTime,
          timezone,
          updated_at: now,
        });
      if (ins.error) {
        // 并发唯一冲突（同 endpoint 双端同时写）→ 兜底走 update
        await db
          .from('daycell_push_subscriptions')
          .update({
            p256dh,
            auth,
            morning_enabled: !!morning.enabled,
            morning_time: morningTime,
            evening_enabled: !!evening.enabled,
            evening_time: eveningTime,
            timezone,
            updated_at: now,
          })
          .eq('user_id', uid)
          .eq('endpoint', endpoint);
      }
    }
    return json(200, { ok: true, savedAt: now.toISOString() });
  } catch (e) {
    return json(500, {
      ok: false,
      error: 'db_write_failed',
      detail: String((e && e.message) || e),
    });
  }
}

async function pushUnsubscribe(event, uid) {
  const body = parseBody(event);
  const endpoint = (body.endpoint || '').toString();
  if (!endpoint) return json(400, { ok: false, error: 'endpoint_required' });
  const db = getApp().rdb();
  try {
    await db
      .from('daycell_push_subscriptions')
      .delete()
      .eq('user_id', uid)
      .eq('endpoint', endpoint);
    return json(200, { ok: true });
  } catch (e) {
    return json(500, {
      ok: false,
      error: 'db_delete_failed',
      detail: String((e && e.message) || e),
    });
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
    return json(200, { ok: true, service: 'daycell-api', version: 'v0.5', time: new Date().toISOString() });
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

  // AI 智能导入：一段话 → 结构化 JSON（DeepSeek 官方 API）
  if (path === '/ai/import' && method === 'POST') {
    const uid = extractUid(event);
    if (!uid) return json(401, { ok: false, error: 'unauthorized' });
    return aiImport(event, uid);
  }

  // Web Push：保存/更新订阅（含早晚通知开关与时间档位）
  if (path === '/push/subscribe' && method === 'POST') {
    const uid = extractUid(event);
    if (!uid) return json(401, { ok: false, error: 'unauthorized' });
    return pushSubscribe(event, uid);
  }

  // Web Push：删除订阅（用户关闭通知 / 设备失效）
  if (path === '/push/unsubscribe' && method === 'POST') {
    const uid = extractUid(event);
    if (!uid) return json(401, { ok: false, error: 'unauthorized' });
    return pushUnsubscribe(event, uid);
  }

  return json(404, { ok: false, error: 'not_found', path });
};
