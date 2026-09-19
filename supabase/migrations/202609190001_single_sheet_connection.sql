begin;

-- ---------------------------------------------------------------------
-- One tracker per account.
--
-- Reconnecting a spreadsheet could leave more than one row in
-- sheet_connections for the same user: the client only replaced the first
-- saved connection and never removed the others, and a tab rename
-- (e.g. "Sheet1" -> "Fresh Grad") made the next save look like a new
-- (spreadsheet, tab) pair. This migration collapses every user down to a
-- single connection and enforces that with a unique constraint.
-- ---------------------------------------------------------------------

-- Keep the most recently updated connection for each user.
create temp table keep_connections as
select distinct on (user_id)
  user_id,
  id as keep_id,
  spreadsheet_id as keep_spreadsheet_id,
  sheet_name as keep_sheet_name
from public.sheet_connections
order by user_id, updated_at desc, created_at desc, id asc;

-- Job URL normalisation matching src/lib/sheets/import.ts (lowercased,
-- fragment and one trailing slash removed when it looks like a URL).
create function pg_temp.normalized_url(value text) returns text
language sql immutable as $$
  select lower(case
    when value ~* '^https?://'
      then regexp_replace(regexp_replace(value, '#.*$', ''), '/$', '')
    else coalesce(value, '')
  end);
$$;

-- 1. Remove applications of dropped connections that duplicate an
--    application already tracked under the kept connection.
delete from public.applications a
using keep_connections k
where a.user_id = k.user_id
  and a.sheet_connection_id is not null
  and a.sheet_connection_id <> k.keep_id
  and exists (
    select 1
    from public.applications kept
    where kept.user_id = k.user_id
      and kept.sheet_connection_id = k.keep_id
      and lower(kept.company) = lower(a.company)
      and lower(kept.role) = lower(a.role)
      and kept.date_applied is not distinct from a.date_applied
      and pg_temp.normalized_url(kept.job_url) = pg_temp.normalized_url(a.job_url)
  );

-- 2. Among the remaining rows of dropped connections, keep only the
--    earliest copy of each application.
delete from public.applications a
using keep_connections k
where a.user_id = k.user_id
  and a.sheet_connection_id is not null
  and a.sheet_connection_id <> k.keep_id
  and exists (
    select 1
    from public.applications earlier
    where earlier.user_id = a.user_id
      and earlier.sheet_connection_id is not null
      and earlier.sheet_connection_id <> k.keep_id
      and lower(earlier.company) = lower(a.company)
      and lower(earlier.role) = lower(a.role)
      and earlier.date_applied is not distinct from a.date_applied
      and pg_temp.normalized_url(earlier.job_url) = pg_temp.normalized_url(a.job_url)
      and (earlier.created_at, earlier.id) < (a.created_at, a.id)
  );

-- 3. Re-home the survivors under the kept connection and recompute their
--    import keys so future imports keep matching them.
create extension if not exists pgcrypto;

update public.applications a
set sheet_connection_id = k.keep_id,
    import_key = encode(digest(
      k.keep_spreadsheet_id || chr(31) ||
      k.keep_sheet_name || chr(31) ||
      coalesce(to_char(a.date_applied, 'YYYY-MM-DD'), '') || chr(31) ||
      lower(a.company) || chr(31) ||
      lower(a.role) || chr(31) ||
      pg_temp.normalized_url(a.job_url),
      'sha256'
    ), 'hex')
from keep_connections k
where a.user_id = k.user_id
  and a.sheet_connection_id is not null
  and a.sheet_connection_id <> k.keep_id;

-- 4. Delete the dropped connections (their import issues cascade away).
delete from public.sheet_connections c
using keep_connections k
where c.user_id = k.user_id
  and c.id <> k.keep_id;

-- 5. Enforce one connection per account.
-- Drop every existing unique constraint on the table first. The composite
-- (user_id, spreadsheet_id, sheet_name) constraint can carry a different
-- auto-generated name on databases whose schema predates the migration
-- file, so resolve the names dynamically instead of hard-coding them.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.sheet_connections'::regclass
      and contype = 'u'
  loop
    execute format(
      'alter table public.sheet_connections drop constraint %I',
      constraint_name
    );
  end loop;
end $$;

alter table public.sheet_connections
  add constraint sheet_connections_user_id_key unique (user_id);

commit;
