alter table public.projects add column if not exists prompts jsonb not null default '{}'::jsonb;
