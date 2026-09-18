begin;

-- Follow-up completion is recorded as its own confirmed event.
-- It never changes the application stage.
alter table public.application_events drop constraint application_events_event_type_check;
alter table public.application_events add constraint application_events_event_type_check check (event_type in ('stage_observation', 'stage_change', 'employer_response', 'follow_up_completed'));

commit;
