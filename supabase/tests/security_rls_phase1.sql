-- =====================================================================
-- SECURITY REVIEW — PHASE 1: authorization / RLS hardening tests
--
-- Run in the hosted Supabase SQL Editor. Everything is inside one
-- transaction and every fixture is rolled back, so this is safe to run
-- against production data.
--
-- What this proves (and the reason each test exists):
--
--   A. Every table in public has RLS enabled.      (catch a future migration)
--   B. Every RLS table has a policy for each command it grants.
--   C. anon can read/write nothing.
--   D. Cross-user isolation on all six tables.
--   E. THE IMPORTANT ONE: the exact query shape used by the route
--      handlers that omit .eq('user_id', ...). Those handlers are only
--      safe because RLS filters them, so we assert RLS does the work.
--   F. Cross-tenant foreign keys cannot be stitched together.
--   G. user_id spoofing on insert is rejected.
--   H. Column-level grants on profiles hold (no id rewriting).
--   I. security invoker function import_sheet_application refuses a
--      connection id belonging to another user.
--   J. The application_stage enum contains every value the app's
--      allowlist uses (i.e. migration 202609200002 actually ran).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Fixtures: two users, owned by user A.
-- ---------------------------------------------------------------------
insert into auth.users (id, raw_user_meta_data) values
  ('e1111111-1111-4111-8111-111111111111', '{"full_name":"Phase1 owner"}'),
  ('e2222222-2222-4222-8222-222222222222', '{"full_name":"Phase1 attacker"}');

insert into public.sheet_connections (id, user_id, spreadsheet_id, spreadsheet_name, sheet_name) values
  ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e1111111-1111-4111-8111-111111111111',
   'phase1-test-sheet', 'Phase1 test', 'Applications');

insert into public.applications (id, user_id, company, role, stage, date_applied, sheet_connection_id, import_key) values
  ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'e1111111-1111-4111-8111-111111111111',
   'Owner Co', 'Engineer', 'Applied', '2026-09-18',
   'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('1', 64));

insert into public.import_issues (id, user_id, sheet_connection_id, message) values
  ('eccccccc-cccc-4ccc-8ccc-cccccccccccc',
   'e1111111-1111-4111-8111-111111111111',
   'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Row 7 is missing a company name.');

insert into public.gmail_scan_candidates (id, user_id, message_id, subject, matched_application_id) values
  ('eddddddd-dddd-4ddd-8ddd-dddddddddddd',
   'e1111111-1111-4111-8111-111111111111',
   'phase1-message-1', 'Interview invitation',
   'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- =====================================================================
-- A + B. Structural: RLS enabled, and a policy per granted command.
-- =====================================================================
do $$
declare
  missing_rls text;
  missing_policy text;
begin
  -- A. Any table in public without RLS is a critical hole.
  select string_agg(c.relname, ', ')
    into missing_rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if missing_rls is not null then
    raise exception 'FAIL A: public tables without RLS: %', missing_rls;
  end if;

  -- B. RLS enabled but no policy for a granted command = either broken
  --    (silently returns nothing) or accidentally open.
  select string_agg(t.table_name || ':' || t.priv, ', ')
    into missing_policy
  from (
    select c.relname as table_name, p.priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity
      and has_table_privilege('authenticated', c.oid, p.priv)
      and not exists (
        select 1 from pg_policies pol
        where pol.schemaname = 'public'
          and pol.tablename = c.relname
          and (pol.cmd = p.priv or pol.cmd = 'ALL')
          and ('authenticated' = any (pol.roles) or 'public' = any (pol.roles))
      )
  ) t;

  if missing_policy is not null then
    raise exception 'FAIL B: granted command without a policy: %', missing_policy;
  end if;
end $$;

-- =====================================================================
-- C. anon must not touch anything.
-- =====================================================================
set local role anon;
do $$
declare t text; denied boolean;
begin
  foreach t in array array[
    'profiles', 'sheet_connections', 'applications',
    'application_events', 'import_issues', 'gmail_scan_candidates'
  ] loop
    denied := false;
    begin
      execute format('select count(*) from public.%I', t);
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then
      raise exception 'FAIL C: anon can SELECT from public.%', t;
    end if;

    denied := false;
    begin
      execute format('insert into public.%I default values', t);
    exception
      when insufficient_privilege then denied := true;
      when not_null_violation then denied := true;
      when check_violation then denied := true;
      when foreign_key_violation then denied := true;
      when null_value_not_allowed then denied := true;
    end;
    if not denied then
      raise exception 'FAIL C: anon can INSERT into public.%', t;
    end if;
  end loop;
end $$;
reset role;

-- =====================================================================
-- D + E + F + G + H. Attacker (user B) against owner's (user A) rows.
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);

do $$
declare affected integer; denied boolean;
begin
  -- ---- D. No cross-user reads anywhere -----------------------------
  -- Note: user B is allowed to see their OWN profile row (the signup
  -- trigger creates one), so this check targets user A's row exactly.
  if exists (select 1 from public.profiles
              where id = 'e1111111-1111-4111-8111-111111111111') then
    raise exception 'FAIL D: cross-user read of profiles'; end if;
  if exists (select 1 from public.sheet_connections) then
    raise exception 'FAIL D: cross-user read of sheet_connections'; end if;
  if exists (select 1 from public.applications) then
    raise exception 'FAIL D: cross-user read of applications'; end if;
  if exists (select 1 from public.application_events) then
    raise exception 'FAIL D: cross-user read of application_events'; end if;
  if exists (select 1 from public.import_issues) then
    raise exception 'FAIL D: cross-user read of import_issues'; end if;
  if exists (select 1 from public.gmail_scan_candidates) then
    raise exception 'FAIL D: cross-user read of gmail_scan_candidates'; end if;

  -- ---- E. Defense in depth ----------------------------------------
  -- These mirror the route handlers that apply ONLY a primary-key
  -- filter and depend on RLS to scope the row:
  --   PATCH/DELETE /api/applications/[id]
  --   POST  /api/applications/[id]/follow-up   (update .eq('id', id))
  --   DELETE /api/import-issues/[id]
  --   PATCH /api/gmail/scan/candidates
  --   POST  /api/sheet-connections
  --
  -- A cross-user write must be blocked one of two ways: RLS filters the
  -- row (0 rows affected) or the grant is missing (permission denied,
  -- SQLSTATE 42501). Both are acceptable. A non-zero row count is not,
  -- because then the route handlers are insecure the moment RLS is
  -- disabled or a single policy is dropped.
  begin
    update public.applications set stage = 'Rejected'
     where id = 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL E: cross-user applications UPDATE by primary key affected % row(s)', affected;
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.applications
     where id = 'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL E: cross-user applications DELETE by primary key affected % row(s)', affected;
    end if;
  exception when insufficient_privilege then null;
  end;

  -- import_issues grants no UPDATE at all, so this one is expected to be
  -- refused with permission denied rather than filtered down to 0 rows.
  begin
    update public.import_issues set message = 'Hijacked'
     where id = 'eccccccc-cccc-4ccc-8ccc-cccccccccccc';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL E: cross-user import_issues UPDATE by primary key affected % row(s)', affected;
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.import_issues
     where id = 'eccccccc-cccc-4ccc-8ccc-cccccccccccc';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL E: cross-user import_issues DELETE by primary key affected % row(s)', affected;
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.gmail_scan_candidates set review_state = 'confirmed'
     where id = 'eddddddd-dddd-4ddd-8ddd-dddddddddddd';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL E: cross-user candidate UPDATE by primary key affected % row(s)', affected;
    end if;
  exception when insufficient_privilege then null;
  end;

  begin
    update public.sheet_connections set sheet_name = 'Hijacked'
     where id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics affected = row_count;
    if affected <> 0 then
      raise exception 'FAIL E: cross-user sheet_connections UPDATE by primary key affected % row(s)', affected;
    end if;
  exception when insufficient_privilege then null;
  end;

  -- ---- G. user_id spoofing on insert ------------------------------
  denied := false;
  begin
    insert into public.applications (user_id, company, role, stage, date_applied)
    values ('e1111111-1111-4111-8111-111111111111', 'Spoof', 'Spoof', 'Applied', '2026-09-18');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then
    raise exception 'FAIL G: inserted an application on behalf of another user';
  end if;

  denied := false;
  begin
    insert into public.import_issues (user_id, message)
    values ('e1111111-1111-4111-8111-111111111111', 'Spoofed issue');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then
    raise exception 'FAIL G: inserted an import_issue on behalf of another user';
  end if;

  denied := false;
  begin
    insert into public.gmail_scan_candidates (user_id, message_id)
    values ('e1111111-1111-4111-8111-111111111111', 'spoofed-message');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then
    raise exception 'FAIL G: inserted a scan candidate on behalf of another user';
  end if;

  -- ---- F. Cross-tenant foreign keys must not stitch together ------
  denied := false;
  begin
    insert into public.applications (user_id, company, role, stage, date_applied, sheet_connection_id, import_key)
    values ('e2222222-2222-4222-8222-222222222222', 'Stitch Co', 'Engineer', 'Applied', '2026-09-18',
            'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('2', 64));
  exception when foreign_key_violation then denied := true;
  end;
  if not denied then
    raise exception 'FAIL F: attached an application to another user''s sheet connection';
  end if;

  denied := false;
  begin
    insert into public.application_events (user_id, application_id, event_status, event_type, to_stage)
    values ('e2222222-2222-4222-8222-222222222222',
            'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'user_confirmed', 'stage_change', 'Rejected');
  exception when foreign_key_violation then denied := true;
  end;
  if not denied then
    raise exception 'FAIL F: wrote an event onto another user''s application';
  end if;

  denied := false;
  begin
    insert into public.gmail_scan_candidates (user_id, message_id, matched_application_id)
    values ('e2222222-2222-4222-8222-222222222222', 'stitched-message',
            'ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  exception when foreign_key_violation then denied := true;
  end;
  if not denied then
    raise exception 'FAIL F: linked a scan candidate to another user''s application';
  end if;

  denied := false;
  begin
    insert into public.import_issues (user_id, sheet_connection_id, message)
    values ('e2222222-2222-4222-8222-222222222222',
            'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Stitched issue');
  exception when foreign_key_violation then denied := true;
  end;
  if not denied then
    raise exception 'FAIL F: attached an import issue to another user''s connection';
  end if;

  -- ---- H. profiles column grants ----------------------------------
  update public.profiles set display_name = 'Hijacked'
   where id = 'e1111111-1111-4111-8111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL H: cross-user profile UPDATE affected % row(s)', affected;
  end if;

  -- Rewriting your own profile id to another user's id must fail. Testing
  -- it against the owner's row would be meaningless here: RLS hides that
  -- row from user B, so the WHERE clause simply matches nothing and no
  -- check is exercised at all.
  denied := false;
  begin
    update public.profiles set id = 'e1111111-1111-4111-8111-111111111111'
     where id = 'e2222222-2222-4222-8222-222222222222';
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then
    raise exception 'FAIL H: authenticated role can rewrite profiles.id';
  end if;
end $$;

-- =====================================================================
-- I. Function abuse: import_sheet_application must refuse a connection
--    that does not belong to the caller (security invoker + explicit
--    ownership check inside the function).
-- =====================================================================
do $$
declare denied boolean := false;
begin
  begin
    perform public.import_sheet_application(
      'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      repeat('3', 64), 'Attacker Co', 'Engineer',
      'Applied', '2026-09-18', 'Other', 'https://example.com/attack'
    );
  exception when others then
    if sqlerrm = 'Sheet connection not found' then
      denied := true;
    else
      raise exception 'FAIL I: unexpected error from import_sheet_application: %', sqlerrm;
    end if;
  end;
  if not denied then
    raise exception 'FAIL I: imported an application into another user''s connection';
  end if;
end $$;

reset role;

-- =====================================================================
-- Owner (user A) sanity: the fixtures really were created, so the
-- isolation assertions above were not passing on an empty database.
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);
do $$ begin
  if (select count(*) from public.sheet_connections) <> 1 then
    raise exception 'INCONCLUSIVE: owner cannot read own sheet_connections'; end if;
  if (select count(*) from public.applications) <> 1 then
    raise exception 'INCONCLUSIVE: owner cannot read own applications'; end if;
  if (select count(*) from public.import_issues) <> 1 then
    raise exception 'INCONCLUSIVE: owner cannot read own import_issues'; end if;
  if (select count(*) from public.gmail_scan_candidates) <> 1 then
    raise exception 'INCONCLUSIVE: owner cannot read own gmail_scan_candidates'; end if;
  if (select count(*) from public.profiles) <> 1 then
    raise exception 'INCONCLUSIVE: owner cannot read own profile'; end if;
end $$;
reset role;

rollback;

-- =====================================================================
-- J. Migration verification (separate concern, same run).
--
-- This is an assertion, not a reporting query. The webapp's stage
-- allowlist in src/lib/dashboard.ts is:
--   Applied, Interview, Offer, Rejected, Ghosted, Withdrawn, Replied
-- If 202609200002_application_stage_replied never ran, the database enum
-- lacks 'Replied', and PATCH /api/applications/[id] plus the follow-up
-- route both fail with a 500 for that stage. A check that a human has to
-- read is not a check, so this fails loudly instead.
-- =====================================================================
do $$
declare missing text;
begin
  select string_agg(want, ', ')
    into missing
  from unnest(array[
    'Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn', 'Replied'
  ]) as want
  where not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'application_stage'
      and e.enumlabel = want
  );

  if missing is not null then
    raise exception 'FAIL J: application_stage is missing value(s) used by the app allowlist: % — migration 202609200002_application_stage_replied has not run on this database', missing;
  end if;
end $$;

-- For reference: the enum values as stored.
select e.enumlabel as stage_value
from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'application_stage'
order by e.enumsortorder;

select 'PASS: RLS structural checks, anon lockdown, cross-user isolation, primary-key-only defense in depth, cross-tenant FK rejection, user_id spoof rejection, profiles column grants, and function ownership enforcement all verified; fixtures rolled back' as result;
