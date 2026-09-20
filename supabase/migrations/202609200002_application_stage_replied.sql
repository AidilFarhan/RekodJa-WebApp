begin;

-- The Gmail scan can now suggest a 'Replied' stage (employer reached out /
-- asked for confirmation). Add the value to the stage enum if missing.
do $$ begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'application_stage'
      and e.enumlabel = 'Replied'
  ) then
    alter type public.application_stage add value 'Replied';
  end if;
end $$;

commit;
