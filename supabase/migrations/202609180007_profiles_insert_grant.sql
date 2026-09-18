begin;

-- The name save action upserts the profile row (needed when the row was
-- deleted during account deletion). PostgREST requires table-level
-- privileges for the upsert to succeed, so grant them here; RLS policies
-- still restrict every operation to the owner's own row.
alter table public.profiles add column if not exists name_confirmed boolean not null default false;
grant insert, update, delete on public.profiles to authenticated;

-- Account deletion removes the profile row, so authenticated users need an
-- owner-only delete policy (missing in the original migration).
create policy profiles_delete_own on public.profiles for delete to authenticated using ((select auth.uid()) = id);

commit;
