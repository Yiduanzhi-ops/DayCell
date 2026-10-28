// daycell-push-worker v0.1：DayCell 早间/晚间 Web Push 日报（timer 触发）
// 触发方式：TCB 定时触发器 cron "0 */30 7-9,18-22 * * * *"（北京时间窗口，半小时一档）
// 职责：扫描 push_subscriptions → 命中当前档位的用户 → 读最新快照 → 聚合日报文案
//       → web-push 发送 → 当天去重 + 失效订阅清理（404/410 NotRegistered）
// v1 约束：时间口径按北京时间（目标用户在中国，时区固定 Asia/Shanghai）；
//          农历特殊日暂不推送（云函数无农历库，公历特殊日同前端 annivHitsOn 口径）
const cloudbase = require('@cloudbase/node-sdk');
const webpush = require('web-push');

let app = null;
function getApp() {
  if (!app) {
    app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  }
  return app;
}

// ============ 时间工具（北京时间，固定 UTC+8）============
function chinaNow() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString(); // 形如 YYYY-MM-DDTHH:mm:ss.sssZ
}
function chinaDateKey() {
  return chinaNow().slice(0, 10);
}
function chinaHM() {
  return chinaNow().slice(11, 16); // 'HH:mm'
}
function addDays(key, n) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function keyOf(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}
// 与前端 dowOf 同口径：按"日历日"取星期（0=周日）
function dowOf(k) {
  const y = Number(k.slice(0, 4));
  const m = Number(k.slice(5, 7));
  const d = Number(k.slice(8, 10));
  return new Date(y, m - 1, d).getDay();
}

// ============ 聚合口径（与前端 aggregate 对齐）============
// 习惯当日判定：非删除/暂停、创建日不晚于目标日、daily 或 weekdays 命中
function habitNamesOn(habits, dateKey) {
  if (!Array.isArray(habits)) return [];
  const dow = dowOf(dateKey);
  return habits
    .filter((h) => !h.deleted && !h.paused)
    .filter((h) => keyOf(h.createdAt) <= dateKey)
    .filter((h) => h.freq.kind === 'daily' || (Array.isArray(h.freq.weekdays) && h.freq.weekdays.includes(dow)))
    .map((h) => h.name);
}

// 特殊日匹配（公历，同前端 annivHitsOn；农历 v1 返回 false）
function annivHitsOn(r, dateKey) {
  if (!r || r.deleted || r.isLunar) return false;
  switch (r.repeat) {
    case 'none':
      return /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date === dateKey;
    case 'weekly':
      return dowOf(r.date) === dowOf(dateKey);
    case 'monthly':
      return r.date.slice(8) === dateKey.slice(8);
    case 'yearly':
      return r.date.slice(5) === dateKey.slice(5);
    default:
      return false;
  }
}

// 活跃待办：非删除、未完成、未顺延出去
function activeTodos(todos) {
  return (todos || []).filter((t) => !t.deleted && !t.done && !t.rolledTo);
}
function todoLabel(t) {
  return t.time ? `${t.time} ${t.text}` : t.text;
}
// 待办排序：有具体时间按时刻升序（无时间垫底），再按 createdAt
function sortTodosByTime(list) {
  return list.slice().sort((a, b) => {
    const at = a.time || '99:99';
    const bt = b.time || '99:99';
    if (at !== bt) return at < bt ? -1 : 1;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
}

// ---- 早间日报：昨日遗留 + 今日待办（按时序）+ 今日习惯 + 今日特殊日 + 今日截止 ----
function buildMorningReport(snapshot, today) {
  const data = (snapshot && snapshot.data) || {};
  const todos = activeTodos(data.todos);
  const yesterday = addDays(today, -1);
  const lines = [];

  const leftover = todos.filter((t) => t.date === yesterday);
  if (leftover.length > 0) {
    const names = leftover.slice(0, 3).map((t) => t.text).join('、');
    lines.push(`昨日遗留 ${leftover.length} 条：${names}${leftover.length > 3 ? '…' : ''}`);
  }

  const todayTodos = sortTodosByTime(todos.filter((t) => t.date === today));
  if (todayTodos.length > 0) {
    // 今日截止：今日待办中截止型（timeType=due）+ 旧 deadline 字段今天到期但 date 不是今天的老待办
    const dueNow =
      todayTodos.filter((t) => t.timeType === 'due' || t.deadline === today).length +
      todos.filter((t) => t.deadline === today && t.date !== today).length;
    const items = todayTodos.slice(0, 4).map((t) => todoLabel(t));
    const suffix = dueNow > 0 ? `（${dueNow} 条今日截止）` : '';
    lines.push(`今日待办 ${todayTodos.length} 条${suffix}：${items.join('、')}${todayTodos.length > 4 ? '…' : ''}`);
  }

  const habits = habitNamesOn(data.habits, today);
  if (habits.length > 0) {
    lines.push(`今日习惯 ${habits.length} 项：${habits.slice(0, 4).join('、')}${habits.length > 4 ? '…' : ''}`);
  }

  const annivs = (data.anniversaries || []).filter((r) => annivHitsOn(r, today));
  if (annivs.length > 0) {
    lines.push(`特殊日：${annivs.map((r) => r.title).join('、')}`);
  }

  return lines;
}

// ---- 晚间日报：今日完成度 + 未完成 + 习惯打卡 + 即将截止 ----
function buildEveningReport(snapshot, today) {
  const data = (snapshot && snapshot.data) || {};
  const lines = [];

  // 完成度必须从原始 todos 数（排除删除/顺延），done 数单独数——activeTodos 已排除 done，不能复用
  const todayAll = (data.todos || []).filter((t) => !t.deleted && !t.rolledTo && t.date === today);
  const doneCount = todayAll.filter((t) => t.done).length;
  const totalCount = todayAll.length;
  lines.push(`今日待办完成 ${doneCount}/${totalCount}`);
  const undone = sortTodosByTime(todayAll.filter((t) => !t.done));
  if (undone.length > 0) {
    lines.push(`未完成：${undone.slice(0, 3).map((t) => todoLabel(t)).join('、')}${undone.length > 3 ? '…' : ''}`);
  }

  const habitNames = habitNamesOn(data.habits, today);
  if (habitNames.length > 0) {
    const checkins = (data.checkins || []).filter((c) => !c.deleted && c.date === today);
    const doneSet = new Set(checkins.map((c) => c.habitId));
    const allHabits = (data.habits || []).filter((h) => !h.deleted && !h.paused);
    const dueHabitIds = allHabits
      .filter((h) => keyOf(h.createdAt) <= today)
      .filter((h) => h.freq.kind === 'daily' || (Array.isArray(h.freq.weekdays) && h.freq.weekdays.includes(dowOf(today))))
      .map((h) => h.id);
    const checked = dueHabitIds.filter((id) => doneSet.has(id)).length;
    const missNames = dueHabitIds
      .filter((id) => !doneSet.has(id))
      .map((id) => {
        const h = allHabits.find((x) => x.id === id);
        return h ? h.name : null;
      })
      .filter(Boolean);
    lines.push(`习惯打卡 ${checked}/${dueHabitIds.length}`);
    if (missNames.length > 0) {
      lines.push(`未打卡：${missNames.slice(0, 3).join('、')}${missNames.length > 3 ? '…' : ''}`);
    }
  }

  // 即将截止：截止型（timeType='due'）的 date 或旧 deadline 字段落在 (今天, 今天+7]，且未完成
  const active = activeTodos(data.todos);
  const upcoming = active
    .filter((t) => {
      const dueDate = t.timeType === 'due' && t.date && t.date > today ? t.date : null;
      const d = dueDate || (t.deadline && t.deadline > today ? t.deadline : null);
      return !!d && d <= addDays(today, 7);
    })
    .sort((a, b) => {
      const da = (a.timeType === 'due' ? a.date : a.deadline) || '';
      const db = (b.timeType === 'due' ? b.date : b.deadline) || '';
      return da.localeCompare(db);
    });
  if (upcoming.length > 0) {
    const labels = upcoming.slice(0, 3).map((t) => {
      const d = (t.timeType === 'due' ? t.date : t.deadline) || '';
      return `${d === addDays(today, 1) ? '明天' : d} ${t.text}`;
    });
    lines.push(`即将截止 ${upcoming.length} 条：${labels.join('、')}${upcoming.length > 3 ? '…' : ''}`);
  }

  return lines;
}

// ============ 主入口（仅接受 timer 事件）============
exports.main = async (event) => {
  const isTimer = event && (event.Type === 'Timer' || event.TriggerName || event.triggerName || event.type === 'Timer');
  if (!isTimer) {
    return { ok: false, error: 'not_timer_event', eventType: event && event.Type };
  }

  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    console.error('[push] VAPID env missing');
    return { ok: false, error: 'vapid_not_configured' };
  }
  webpush.setVapidDetails(subject, pub, priv);

  const hm = chinaHM();
  const today = chinaDateKey();
  const db = getApp().rdb();

  const res = await db.from('daycell_push_subscriptions').select('*');
  const subs = res.data || [];
  let sent = 0;
  let failed = 0;
  let cleaned = 0;

  for (const s of subs) {
    const morningDue =
      s.morning_enabled === true &&
      s.morning_time === hm &&
      (s.last_morning_sent === null || s.last_morning_sent < today);
    const eveningDue =
      s.evening_enabled === true &&
      s.evening_time === hm &&
      (s.last_evening_sent === null || s.last_evening_sent < today);
    if (!morningDue && !eveningDue) continue;

    let snapshot = null;
    try {
      const snap = await db
        .from('daycell_snapshots')
        .select('snapshot')
        .eq('user_id', s.user_id)
        .order('created_at', { ascending: false })
        .limit(1);
      snapshot = snap.data && snap.data[0] ? snap.data[0].snapshot : null;
    } catch (e) {
      console.error('[push] snapshot read failed', s.user_id, e && e.message);
    }

    const kind = morningDue ? 'morning' : 'evening';
    const lines = snapshot
      ? kind === 'morning'
        ? buildMorningReport(snapshot, today)
        : buildEveningReport(snapshot, today)
      : [];
    const title = kind === 'morning' ? 'DayCell 早间日报' : 'DayCell 晚间日报';
    const body = lines.length > 0
      ? lines.join('\n')
      : kind === 'morning'
        ? '今天暂无安排，记得好好休息'
        : '今天全部完成，辛苦了';
    const payload = {
      title,
      body,
      data: { url: process.env.APP_URL || '/' },
    };

    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
      await db
        .from('daycell_push_subscriptions')
        .update(kind === 'morning' ? { last_morning_sent: today } : { last_evening_sent: today })
        .eq('user_id', s.user_id)
        .eq('endpoint', s.endpoint);
      sent += 1;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        try {
          await db
            .from('daycell_push_subscriptions')
            .delete()
            .eq('user_id', s.user_id)
            .eq('endpoint', s.endpoint);
          cleaned += 1;
        } catch (e2) {
          console.error('[push] cleanup failed', s.user_id, e2 && e2.message);
        }
      } else {
        failed += 1;
        console.error('[push] send failed', s.user_id, code || (e && e.message));
      }
    }
  }

  return { ok: true, hm, today, checked: subs.length, sent, failed, cleaned };
};
