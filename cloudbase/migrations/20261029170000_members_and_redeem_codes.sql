-- v9.7 第 3 步：会员状态落库
-- 1) daycell_members：会员到期时间（member = member_expires_at > now()）
-- 2) daycell_redeem_codes：兑换码（爱发电/兑换码付费，第 6 步接购买闭环）
-- RLS 策略：只放行云函数管理角色（服务端函数直读写），禁止 public 直接改（用户不能自开会员）。
CREATE TABLE IF NOT EXISTS public.daycell_members (
  user_id TEXT PRIMARY KEY,
  member_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.daycell_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY daycell_members_fn_all ON public.daycell_members
  FOR ALL TO cloudbase_functions_admin_postgres_navjvt8i
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.daycell_redeem_codes (
  code TEXT PRIMARY KEY,
  plan TEXT NOT NULL DEFAULT 'member_month',
  duration_days INT NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'redeemed')),
  redeemed_by TEXT,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_redeem_status ON public.daycell_redeem_codes (status);
ALTER TABLE public.daycell_redeem_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY daycell_redeem_fn_all ON public.daycell_redeem_codes
  FOR ALL TO cloudbase_functions_admin_postgres_navjvt8i
  USING (true) WITH CHECK (true);
