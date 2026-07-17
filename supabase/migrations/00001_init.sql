-- Action Leopard — initial schema
-- Projects, elements (art-direction entities), assets (generated media), agent messages.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Untitled project',
  intent text not null default '',
  art_direction text not null default '',
  reference_image_url text,
  canvas_snapshot jsonb,
  image_model text not null default 'nano-banana-pro',
  video_model text not null default 'grok-imagine-1.5-720p',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.elements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('character','prop','vehicle','location','set-dressing','other')),
  name text not null,
  notes text not null default '',
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('image','video','canvas-shot','drawing','reference','art-direction')),
  url text not null,
  thumbnail_url text,
  prompt text,
  model text,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_user on public.projects(user_id, updated_at desc);
create index if not exists idx_elements_project on public.elements(project_id, created_at);
create index if not exists idx_assets_project on public.assets(project_id, sort_order, created_at);
create index if not exists idx_agent_messages_project on public.agent_messages(project_id, created_at);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- Row level security: every row is owned by user_id
alter table public.projects enable row level security;
alter table public.elements enable row level security;
alter table public.assets enable row level security;
alter table public.agent_messages enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects','elements','assets','agent_messages'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);
    execute format('create policy "own rows select" on public.%I for select using (auth.uid() = user_id)', t);
    execute format('create policy "own rows insert" on public.%I for insert with check (auth.uid() = user_id)', t);
    execute format('create policy "own rows update" on public.%I for update using (auth.uid() = user_id)', t);
    execute format('create policy "own rows delete" on public.%I for delete using (auth.uid() = user_id)', t);
  end loop;
end $$;
