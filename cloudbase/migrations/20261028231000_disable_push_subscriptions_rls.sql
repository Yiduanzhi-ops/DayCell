-- v9.3 修复：禁用 push_subscriptions 的 RLS
-- 背景：建表迁移误开 ENABLE ROW LEVEL SECURITY 且未建任何 policy，
--       导致云函数（service_role，无 BYPASSRLS 属性）INSERT 被拒、静默 200、
--       订阅始终无法落库；本迁移关闭 RLS，恢复服务端函数直读写。
--       数据隔离由应用层 user_id 过滤 + 网关身份认证承担（前端不直连数据库）。
ALTER TABLE public.daycell_push_subscriptions DISABLE ROW LEVEL SECURITY;
