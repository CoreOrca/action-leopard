-- 00007: element images get their own asset type.
-- They were stored as type 'art-direction' rows tagged with
-- metadata.element_id, which leaked character/prop/vehicle references into
-- the art direction UI and — worse — into prompting as "style only, do not
-- copy content" references. Elements define WHO/WHAT is in the scene; art
-- direction defines only the look.

do $$
declare c text;
begin
  select conname into c
  from pg_constraint
  where conrelid = 'public.assets'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%type%';
  if c is not null then
    execute format('alter table public.assets drop constraint %I', c);
  end if;
end $$;

alter table public.assets add constraint assets_type_check
  check (type in ('image','video','canvas-shot','drawing','reference','art-direction','element'));

-- Backfill: every element-tagged "art direction" row becomes an element row.
update public.assets
set type = 'element'
where type = 'art-direction' and metadata ? 'element_id';
