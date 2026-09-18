begin;

-- New sign-ups start with an empty display name. The user fills it during
-- onboarding step 1; the Google full name is no longer pre-filled.
create or replace function public.create_user_profile() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, '');
  return new;
end;
$$;

commit;
