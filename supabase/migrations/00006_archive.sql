-- Project archiving: hide finished projects without deleting them.
alter table public.projects
  add column if not exists archived boolean not null default false;
