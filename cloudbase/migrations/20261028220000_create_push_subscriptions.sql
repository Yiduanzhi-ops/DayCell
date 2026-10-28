-- v9.3 Web Push 订阅表：每个用户每台设备一条订阅，含早晚通知开关与时间档位
CREATE TABLE IF NOT EXISTS public.daycell_push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,            -- 网关身份 x-userid
  endpoint TEXT NOT NULL,           -- PushSubscription.endpoint（设备级唯一）
  p256dh TEXT NOT NULL,             -- PushSubscription keys.p256dh
  auth TEXT NOT NULL,               -- PushSubscription keys.auth
  morning_enabled BOOLEAN NOT NULL DEFAULT false,
  morning_time TEXT NOT NULL DEFAULT '08:00',   -- 上午档位：07:30/08:00/08:30/09:00/09:30
  evening_enabled BOOLEAN NOT NULL DEFAULT false,
  evening_time TEXT NOT NULL DEFAULT '21:00',   -- 晚上档位：19:00/19:30/20:00/20:30/21:00/21:30/22:00
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  last_morning_sent DATE,           -- 当天去重（早间）
  last_evening_sent DATE,           -- 当天去重（晚间）
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_user_endpoint ON public.daycell_push_subscriptions (user_id, endpoint);
CREATE INDEX IF NOT EXISTS idx_push_schedule ON public.daycell_push_subscriptions (morning_enabled, morning_time);
ALTER TABLE public.daycell_push_subscriptions ENABLE ROW LEVEL SECURITY;
