-- Scene projects: project type, script, ordered location map, and the shots table
-- for the agentic scene planner / self-correcting loop.

alter table public.projects
  add column if not exists project_type text not null default 'shot',
  add column if not exists script text not null default '',
  add column if not exists location_map jsonb not null default '[]'::jsonb;
-- location_map: [{ "asset_id": uuid, "url": text, "label": text, "notes": text }] in path order

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'projects_project_type_check'
  ) then
    alter table public.projects
      add constraint projects_project_type_check check (project_type in ('shot','scene'));
  end if;
end $$;

create table if not exists public.shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'shot' check (kind in ('shot','transition')),
  sort_order integer not null default 0,
  title text not null default '',
  script_excerpt text not null default '',
  spec jsonb not null default '{}'::jsonb,
  location_asset_id uuid references public.assets(id) on delete set null,
  prompts jsonb not null default '{}'::jsonb,
  status text not null default 'planned'
    check (status in ('planned','approved','generating','judging','fixing','passed','escalated','accepted')),
  revision_count integer not null default 0,
  judge jsonb not null default '{}'::jsonb,
  start_asset_id uuid references public.assets(id) on delete set null,
  end_asset_id uuid references public.assets(id) on delete set null,
  video_asset_id uuid references public.assets(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shots_project on public.shots(project_id, sort_order);

drop trigger if exists trg_shots_updated_at on public.shots;
create trigger trg_shots_updated_at
before update on public.shots
for each row execute function public.set_updated_at();

alter table public.shots enable row level security;

do $$
begin
  execute 'drop policy if exists "own rows select" on public.shots';
  execute 'drop policy if exists "own rows insert" on public.shots';
  execute 'drop policy if exists "own rows update" on public.shots';
  execute 'drop policy if exists "own rows delete" on public.shots';
  execute 'create policy "own rows select" on public.shots for select using (auth.uid() = user_id)';
  execute 'create policy "own rows insert" on public.shots for insert with check (auth.uid() = user_id)';
  execute 'create policy "own rows update" on public.shots for update using (auth.uid() = user_id)';
  execute 'create policy "own rows delete" on public.shots for delete using (auth.uid() = user_id)';
end $$;
