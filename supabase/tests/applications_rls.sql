-- Run in the hosted Supabase SQL Editor AFTER the milestone 2 migration
-- AND migrations 202609180002_replied_events and 202609180003_follow_up_events.
-- All fixture rows are rolled back.
begin;
insert into auth.users (id, raw_user_meta_data) values
('d1111111-1111-4111-8111-111111111111', '{"full_name":"M2 test owner"}'),
('d2222222-2222-4222-8222-222222222222', '{"full_name":"M2 test other"}');

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.applications'::regclass) then raise exception 'FAIL: applications RLS disabled'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.application_events'::regclass) then raise exception 'FAIL: application_events RLS disabled'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.sheet_connections'::regclass) then raise exception 'FAIL: sheet_connections RLS disabled'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
insert into public.sheet_connections(id, spreadsheet_id, spreadsheet_name, sheet_name)
values ('daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hosted-test-sheet', 'Hosted test', 'Applications');
insert into public.applications(id, company, role, stage, date_applied, sheet_connection_id, import_key)
values ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Owner Co', 'Engineer', 'Applied', '2026-09-18', 'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('a',64));
insert into public.application_events(id, application_id, event_status, event_type, to_stage)
values ('dccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user_confirmed', 'stage_change', 'Applied');
do $$ begin
  if (select count(*) from public.sheet_connections) <> 1 then raise exception 'FAIL: owner connection write/read'; end if;
  if (select count(*) from public.applications) <> 1 then raise exception 'FAIL: owner application write/read'; end if;
  if (select count(*) from public.application_events) <> 1 then raise exception 'FAIL: owner event write/read'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'd2222222-2222-4222-8222-222222222222', true);
do $$
declare affected integer; denied boolean := false;
begin
  if exists(select 1 from public.sheet_connections) then raise exception 'FAIL: cross-user connection read'; end if;
  if exists(select 1 from public.applications) then raise exception 'FAIL: cross-user application read'; end if;
  if exists(select 1 from public.application_events) then raise exception 'FAIL: cross-user event read'; end if;
  update public.applications set role = 'Hacked' where id = 'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user application update'; end if;
  update public.application_events set source = 'Hacked' where id = 'dccccccc-cccc-4ccc-8ccc-cccccccccccc';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user event update'; end if;
  begin
    insert into public.applications(user_id,company,role,stage,date_applied)
    values ('d1111111-1111-4111-8111-111111111111','Spoof','Spoof','Applied','2026-09-18');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: cross-user insert was allowed'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'd1111111-1111-4111-8111-111111111111', true);
select * from public.import_sheet_application(
  'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('f',64), 'Idempotent Co', 'Designer',
  'Applied', '2026-09-18', 'Referral', 'https://example.com/idempotent'
);
select * from public.import_sheet_application(
  'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('f',64), 'Idempotent Co', 'Designer',
  'Applied', '2026-09-18', 'Referral', 'https://example.com/idempotent'
);
do $$ begin
  if (select count(*) from public.applications where import_key = repeat('f',64)) <> 1 then raise exception 'FAIL: duplicate import application'; end if;
  if (select count(*) from public.application_events e join public.applications a on a.id=e.application_id where a.import_key=repeat('f',64)) <> 1 then raise exception 'FAIL: duplicate import event'; end if;
end $$;

select * from public.import_sheet_application(
  'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('e',64), 'Replied Co', 'PM',
  'Applied', '2026-09-18', 'Referral', 'https://example.com/replied', true
);
select * from public.import_sheet_application(
  'daaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', repeat('e',64), 'Replied Co', 'PM',
  'Applied', '2026-09-18', 'Referral', 'https://example.com/replied', true
);
do $$ begin
  if (select count(*) from public.application_events e join public.applications a on a.id=e.application_id where a.import_key=repeat('e',64) and e.event_type='employer_response' and e.event_status='user_confirmed') <> 1 then raise exception 'FAIL: replied import must create exactly one employer_response event'; end if;
  if (select stage from public.applications where import_key = repeat('e',64)) <> 'Applied' then raise exception 'FAIL: replied import must keep stage Applied'; end if;
end $$;

insert into public.application_events(application_id, event_status, event_type, source)
values ('dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user_confirmed', 'follow_up_completed', 'manual');
do $$ begin
  if (select stage from public.applications where id = 'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 'Applied' then raise exception 'FAIL: follow-up event changed stage'; end if;
  if (select count(*) from public.application_events where application_id = 'dbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and event_type = 'follow_up_completed') <> 1 then raise exception 'FAIL: follow-up event was not recorded'; end if;
end $$;
reset role;
rollback;
select 'PASS: hosted owner access, cross-user isolation, idempotent import, replied employer-response event, and stage-neutral follow-up event all verified; fixtures rolled back' as result;
