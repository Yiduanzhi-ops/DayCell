-- v9 云同步快照表：整包 JSON 快照，按登录用户存取
CREATE TABLE IF NOT EXISTS public.daycell_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_latest ON public.daycell_snapshots (user_id, created_at DESC);
ALTER TABLE public.daycell_snapshots ENABLE ROW LEVEL SECURITY;
