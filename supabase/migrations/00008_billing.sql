-- Billing: Stripe subscription state per user + metered usage events.
-- billing rows are written only via the service key (webhook/checkout sync);
-- users can read their own row. usage_events are inserted by the user's own
-- server calls under RLS.

create table if not exists public.billing (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  plan text not null default 'none',
  status text not null default 'none',
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_billing_updated_at on public.billing;
create trigger trg_billing_updated_at
before update on public.billing
for each row execute function public.set_updated_at();

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  model text,
  credits integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_usage_events_user
  on public.usage_events(user_id, created_at desc);

alter table public.billing enable row level security;
alter table public.usage_events enable row level security;

drop policy if exists "own row select" on public.billing;
create policy "own row select" on public.billing
  for select using (auth.uid() = user_id);

drop policy if exists "own rows select" on public.usage_events;
create policy "own rows select" on public.usage_events
  for select using (auth.uid() = user_id);
drop policy if exists "own rows insert" on public.usage_events;
create policy "own rows insert" on public.usage_events
  for insert with check (auth.uid() = user_id);

-- Sum of credits spent since p_start for the calling user (avoids row-limit
-- undercounting when summing client-side).
create or replace function public.usage_total(p_start timestamptz)
returns bigint
language sql stable security invoker
as $$
  select coalesce(sum(credits), 0)::bigint
  from public.usage_events
  where user_id = auth.uid() and created_at >= p_start;
$$;
