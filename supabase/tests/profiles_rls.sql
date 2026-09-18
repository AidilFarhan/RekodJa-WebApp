-- Run in the Supabase SQL Editor AFTER the migration. Fixtures are rolled back.
begin;
insert into auth.users (id, raw_user_meta_data) values
('c1111111-1111-4111-8111-111111111111', '{"full_name":"RLS test A"}'),
('c2222222-2222-4222-8222-222222222222', '{"full_name":"RLS test B"}');
do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.profiles'::regclass) then
    raise exception 'FAIL: RLS disabled';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1111111-1111-4111-8111-111111111111', true);
do $$
declare affected integer;
begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'FAIL: user can see other profiles'; end if;
  if exists(select 1 from public.profiles where id = 'c2222222-2222-4222-8222-222222222222') then raise exception 'FAIL: cross-user read'; end if;
  update public.profiles set display_name = 'Not allowed' where id = 'c2222222-2222-4222-8222-222222222222';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: cross-user update'; end if;
  update public.profiles set display_name = 'Own edit allowed' where id = 'c1111111-1111-4111-8111-111111111111';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: own update denied'; end if;
end $$;
reset role;
rollback;
select 'PASS: RLS enabled; own profile accessible/editable; other profile invisible and immutable; fixtures rolled back' as result;
