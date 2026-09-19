-- Run in the hosted Supabase SQL Editor AFTER migration
-- 202609200001_gmail_scan_candidates.sql.
-- Verifies owner-only RLS, one-candidate-per-message enforcement, and
-- cross-user isolation. All fixture rows are rolled back.
begin;
insert into auth.users (id, raw_user_meta_data) values
('f1111111-1111-4111-8111-111111111111', '{"full_name":"GSC test owner"}'),
('f2222222-2222-4222-8222-222222222222', '{"full_name":"GSC test other"}');

do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.gmail_scan_candidates'::regclass) then
    raise exception 'FAIL: gmail_scan_candidates RLS disabled';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1111111-1111-4111-8111-111111111111', true);

-- Positive: owner can create, read and update their own candidate.
insert into public.gmail_scan_candidates(id, message_id, thread_id, subject, suggested_company)
values ('faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hosted-msg-1', 'hosted-thread-1', 'Interview invitation', 'Owner Co');
do $$
declare affected integer;
begin
  if (select count(*) from public.gmail_scan_candidates) <> 1 then raise exception 'FAIL: owner candidate write/read'; end if;
  update public.gmail_scan_candidates set review_state = 'confirmed', confirmed_stage = 'Interview'
  where id = 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: owner candidate update denied'; end if;
end $$;

-- Enforcement: a second candidate for the same message id must be rejected.
do $$
declare denied boolean := false;
begin
  begin
    insert into public.gmail_scan_candidates(id, message_id)
    values ('fbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'hosted-msg-1');
  exception when unique_violation then denied := true;
  end;
  if not denied then raise exception 'FAIL: duplicate candidate for the same message was allowed'; end if;
end $$;

-- Negative: another user sees nothing, cannot modify or delete, and cannot
-- insert on the owner's behalf.
select set_config('request.jwt.claim.sub', 'f2222222-2222-4222-8222-222222222222', true);
do $$
declare affected integer; denied boolean := false;
begin
  if exists(select 1 from public.gmail_scan_candidates) then raise exception 'FAIL: cross-user candidate read'; end if;
  update public.gmail_scan_candidates set review_state = 'dismissed'
  where id = 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user candidate update'; end if;
  delete from public.gmail_scan_candidates where id = 'faaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user candidate delete'; end if;
  begin
    insert into public.gmail_scan_candidates(user_id, message_id)
    values ('f1111111-1111-4111-8111-111111111111', 'spoof-msg');
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL: cross-user candidate insert was allowed'; end if;
end $$;

reset role;
rollback;
select 'PASS: gmail_scan_candidates RLS enabled; owner create/read/update OK; one candidate per message enforced; cross-user read/update/delete/insert denied; fixtures rolled back' as result;
