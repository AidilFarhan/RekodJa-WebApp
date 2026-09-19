-- Run in the hosted Supabase SQL Editor AFTER migration
-- 202609190001_single_sheet_connection.sql.
-- Verifies one-connection-per-account enforcement and cross-user isolation
-- for sheet_connections. All fixture rows are rolled back.
begin;
insert into auth.users (id, raw_user_meta_data) values
('e1111111-1111-4111-8111-111111111111', '{"full_name":"SC test owner"}'),
('e2222222-2222-4222-8222-222222222222', '{"full_name":"SC test other"}');

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.sheet_connections'::regclass) then
    raise exception 'FAIL: sheet_connections RLS disabled';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1111111-1111-4111-8111-111111111111', true);

-- Positive: the owner can create and read their own connection.
insert into public.sheet_connections(id, spreadsheet_id, spreadsheet_name, sheet_name)
values ('eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sc-test-sheet', 'SC test', 'Applications');
do $$ begin
  if (select count(*) from public.sheet_connections) <> 1 then raise exception 'FAIL: owner connection write/read'; end if;
end $$;

-- Positive: the owner can update their own connection.
do $$
declare affected integer;
begin
  update public.sheet_connections set spreadsheet_name = 'SC test updated'
  where id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: owner update denied'; end if;
end $$;

-- Enforcement: a second connection for the same account must be rejected by
-- the one-per-account unique constraint added by the migration.
do $$
declare denied boolean := false;
begin
  begin
    insert into public.sheet_connections(id, spreadsheet_id, spreadsheet_name, sheet_name)
    values ('ebbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'sc-test-sheet-2', 'Second', 'Sheet2');
  exception when unique_violation then denied := true;
  end;
  if not denied then raise exception 'FAIL: second connection was allowed'; end if;
end $$;

-- Negative: another user sees nothing and cannot read, modify or delete the
-- owner's connection, and cannot insert on the owner's behalf.
select set_config('request.jwt.claim.sub', 'e2222222-2222-4222-8222-222222222222', true);
do $$
declare affected integer; denied boolean := false;
begin
  if exists(select 1 from public.sheet_connections) then raise exception 'FAIL: cross-user connection read'; end if;
  update public.sheet_connections set spreadsheet_name = 'Hacked'
  where id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user connection update'; end if;
  delete from public.sheet_connections where id = 'eaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user connection delete'; end if;
  begin
    insert into public.sheet_connections(user_id, spreadsheet_id, spreadsheet_name, sheet_name)
    values ('e1111111-1111-4111-8111-111111111111', 'Spoof', 'Spoof', 'Spoof');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: cross-user insert was allowed'; end if;
end $$;

reset role;
rollback;
select 'PASS: one-connection-per-account enforced; owner create/read/update OK; cross-user read/update/delete/insert denied; fixtures rolled back' as result;
