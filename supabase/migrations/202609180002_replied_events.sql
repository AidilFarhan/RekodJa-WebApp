begin;

-- Missing Date Applied must no longer block import: rows import with a null date.
alter table public.applications alter column date_applied drop not null;

-- Preserve "Replied" rows as a distinct confirmed employer-response event
-- instead of silently folding them into the Applied stage.
alter table public.application_events drop constraint application_events_event_type_check;
alter table public.application_events add constraint application_events_event_type_check check (event_type in ('stage_observation', 'stage_change', 'employer_response'));

drop function public.import_sheet_application(uuid, text, text, text, public.application_stage, date, text, text);

create function public.import_sheet_application(
  p_connection_id uuid,
  p_import_key text,
  p_company text,
  p_role text,
  p_stage public.application_stage,
  p_date_applied date,
  p_source text,
  p_job_url text,
  p_replied boolean default false
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
    if p_replied then
      insert into public.application_events (
        user_id, application_id, event_status, event_type, source
      ) values (
        v_user_id, v_application_id, 'user_confirmed', 'employer_response', 'sheet_import'
      );
    end if;
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
  if p_replied and not exists (
    select 1 from public.application_events e
    where e.application_id = v_application_id
      and e.user_id = v_user_id
      and e.event_status = 'user_confirmed'
      and e.event_type = 'employer_response'
  ) then
    insert into public.application_events (
      user_id, application_id, event_status, event_type, source
    ) values (
      v_user_id, v_application_id, 'user_confirmed', 'employer_response', 'sheet_import'
    );
  end if;
  return query select v_application_id, false, v_previous_stage is distinct from p_stage;
end;
$$;

revoke all on function public.import_sheet_application(uuid, text, text, text, public.application_stage, date, text, text, boolean) from public, anon;
grant execute on function public.import_sheet_application(uuid, text, text, text, public.application_stage, date, text, text, boolean) to authenticated;

commit;
