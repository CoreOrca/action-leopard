alter table public.projects add column if not exists current_prompt text not null default '';
