begin;

create type public.application_stage as enum ('Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn');
create type public.application_event_status as enum ('detected', 'user_confirmed');

create table public.sheet_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  spreadsheet_id text not null check (char_length(spreadsheet_id) between 1 and 255),
  spreadsheet_name text not null check (char_length(spreadsheet_name) between 1 and 255),
  sheet_name text not null check (char_length(sheet_name) between 1 and 255),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, spreadsheet_id, sheet_name),
  unique (id, user_id)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company text not null check (char_length(company) between 1 and 200),
  role text not null check (char_length(role) between 1 and 200),
  stage public.application_stage not null default 'Applied',
  date_applied date not null,
  source text not null default '' check (char_length(source) <= 120),
  job_url text not null default '' check (char_length(job_url) <= 2048),
  sheet_connection_id uuid,
  import_key text check (import_key is null or char_length(import_key) = 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, sheet_connection_id, import_key),
  foreign key (sheet_connection_id, user_id)
    references public.sheet_connections(id, user_id) on delete set null (sheet_connection_id)
);

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  application_id uuid not null,
  event_status public.application_event_status not null,
  event_type text not null check (event_type in ('stage_observation', 'stage_change')),
  from_stage public.application_stage,
  to_stage public.application_stage,
  source text not null default 'manual' check (char_length(source) <= 80),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (application_id, user_id)
    references public.applications(id, user_id) on delete cascade
);

create index applications_user_id_idx on public.applications(user_id);
create index application_events_application_id_idx on public.application_events(application_id, occurred_at);
create index sheet_connections_user_id_idx on public.sheet_connections(user_id);

alter table public.sheet_connections enable row level security;
alter table public.applications enable row level security;
alter table public.application_events enable row level security;

revoke all on public.sheet_connections, public.applications, public.application_events from anon, authenticated;
grant select, insert, update, delete on public.sheet_connections, public.applications, public.application_events to authenticated;

create policy sheet_connections_read_own on public.sheet_connections for select to authenticated using ((select auth.uid()) = user_id);
create policy sheet_connections_insert_own on public.sheet_connections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sheet_connections_update_own on public.sheet_connections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy sheet_connections_delete_own on public.sheet_connections for delete to authenticated using ((select auth.uid()) = user_id);

create policy applications_read_own on public.applications for select to authenticated using ((select auth.uid()) = user_id);
create policy applications_insert_own on public.applications for insert to authenticated with check ((select auth.uid()) = user_id);
create policy applications_update_own on public.applications for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy applications_delete_own on public.applications for delete to authenticated using ((select auth.uid()) = user_id);

create policy application_events_read_own on public.application_events for select to authenticated using ((select auth.uid()) = user_id);
create policy application_events_insert_own on public.application_events for insert to authenticated with check ((select auth.uid()) = user_id);
create policy application_events_update_own on public.application_events for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy application_events_delete_own on public.application_events for delete to authenticated using ((select auth.uid()) = user_id);

create function public.import_sheet_application(
  p_connection_id uuid,
  p_import_key text,
  p_company text,
  p_role text,
  p_stage public.application_stage,
  p_date_applied date,
  p_source text,
  p_job_url text
) returns table(application_id uuid, created boolean, stage_changed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_application_id uuid;
  v_previous_stage public.application_stage;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.sheet_connections
    where id = p_connection_id and user_id = v_user_id
  ) then raise exception 'Sheet connection not found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_connection_id::text || ':' || p_import_key, 0)
  );

  select id, stage into v_application_id, v_previous_stage
  from public.applications
  where user_id = v_user_id
    and sheet_connection_id = p_connection_id
    and import_key = p_import_key
  for update;

  if not found then
    insert into public.applications (
      user_id, company, role, stage, date_applied, source, job_url,
      sheet_connection_id, import_key
    ) values (
      v_user_id, p_company, p_role, p_stage, p_date_applied, p_source, p_job_url,
      p_connection_id, p_import_key
    ) returning id into v_application_id;

    insert into public.application_events (
      user_id, application_id, event_status, event_type, to_stage, source
    ) values (
      v_user_id, v_application_id, 'user_confirmed', 'stage_change', p_stage, 'sheet_import'
    );
    return query select v_application_id, true, true;
    return;
  end if;

  update public.applications set
    company = p_company,
    role = p_role,
    stage = p_stage,
    date_applied = p_date_applied,
    source = p_source,
    job_url = p_job_url,
    updated_at = now()
  where id = v_application_id and user_id = v_user_id;

  if v_previous_stage is distinct from p_stage then
    insert into public.application_events (
      user_id, application_id, event_status, event_type, from_stage, to_stage, source
    ) values (
      v_user_id, v_application_id, 'user_confirmed', 'stage_change', v_previous_stage, p_stage, 'sheet_import'
    );
  end if;
  return query select v_application_id, false, v_previous_stage is distinct from p_stage;
end;
$$;

revoke all on function public.import_sheet_application(uuid, text, text, text, public.application_stage, date, text, text) from public, anon;
grant execute on function public.import_sheet_application(uuid, text, text, text, public.application_stage, date, text, text) to authenticated;

commit;
