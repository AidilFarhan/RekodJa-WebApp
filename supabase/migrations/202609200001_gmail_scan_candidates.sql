begin;

-- ---------------------------------------------------------------------
-- Gmail scan review queue.
--
-- Holds one reviewable candidate per Gmail message (keyed by user +
-- message id) between the scan and the user's confirm step, so scan
-- results and review edits survive page refreshes without re-spending
-- Gmail API quota. Confirmed candidates are converted into
-- application_events by the confirm route and may stay here marked
-- 'confirmed' as a short history.
-- ---------------------------------------------------------------------

create table public.gmail_scan_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message_id text not null check (char_length(message_id) between 1 and 200),
  thread_id text not null default '' check (char_length(thread_id) <= 200),
  email text not null default '' check (char_length(email) <= 320),
  internal_date_ms bigint not null default 0,
  subject text not null default '' check (char_length(subject) <= 500),
  sender_from text not null default '' check (char_length(sender_from) <= 500),
  sender_email text not null default '' check (char_length(sender_email) <= 320),
  -- Truncated classification text (<=1600 chars); full body is never stored.
  snippet text not null default '' check (char_length(snippet) <= 1600),
  suggested_company text not null default '' check (char_length(suggested_company) <= 200),
  suggested_role text not null default '' check (char_length(suggested_role) <= 200),
  suggested_status text not null default '' check (char_length(suggested_status) <= 20),
  event_type text not null default 'stage_observation'
    check (event_type in ('stage_observation', 'employer_response')),
  matched_application_id uuid,
  review_state text not null default 'pending'
    check (review_state in ('pending', 'confirmed', 'dismissed')),
  confirmed_stage public.application_stage,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, message_id),
  foreign key (matched_application_id, user_id)
    references public.applications(id, user_id) on delete set null
);

create index gmail_scan_candidates_user_id_idx
  on public.gmail_scan_candidates(user_id);

alter table public.gmail_scan_candidates enable row level security;

revoke all on public.gmail_scan_candidates from anon, authenticated;
grant select, insert, update, delete on public.gmail_scan_candidates to authenticated;

create policy gmail_scan_candidates_read_own on public.gmail_scan_candidates
  for select to authenticated using ((select auth.uid()) = user_id);
create policy gmail_scan_candidates_insert_own on public.gmail_scan_candidates
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy gmail_scan_candidates_update_own on public.gmail_scan_candidates
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy gmail_scan_candidates_delete_own on public.gmail_scan_candidates
  for delete to authenticated using ((select auth.uid()) = user_id);

commit;
