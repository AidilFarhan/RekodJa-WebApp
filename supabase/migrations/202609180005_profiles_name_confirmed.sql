begin;

-- Explicit confirmation that the user completed the name step of onboarding.
-- display_name can be pre-filled by the signup trigger, so it cannot be used
-- to decide whether step 1 was completed.
alter table public.profiles add column if not exists name_confirmed boolean not null default false;
grant update (name_confirmed) on public.profiles to authenticated;
grant insert (name_confirmed) on public.profiles to authenticated;

commit;
