alter table public.projects add column if not exists scene_meta jsonb not null default '{}'::jsonb;
