begin;
-- Registration is explicit; Google OAuth alone may create an Auth identity.
create table public.account_registrations (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.account_registrations enable row level security;
revoke all on public.account_registrations from public, anon, authenticated;
grant select, insert on public.account_registrations to authenticated;
create policy registrations_read_own on public.account_registrations for select to authenticated using ((select auth.uid()) = user_id);
create policy registrations_create_own on public.account_registrations for insert to authenticated with check ((select auth.uid()) = user_id);
-- Preserve accounts created before the two flows were separated.
insert into public.account_registrations (user_id) select id from public.profiles;
commit;
