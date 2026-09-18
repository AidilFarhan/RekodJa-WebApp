begin;

-- Import issues surfaced in the notification bell (e.g. spreadsheet rows with
-- missing company/role or invalid dates). Rows are replaced on each import of
-- the same connection so the list always reflects the latest import.
create table public.import_issues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  sheet_connection_id uuid,
  message text not null check (char_length(message) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (sheet_connection_id, user_id)
    references public.sheet_connections(id, user_id) on delete cascade
);

create index import_issues_user_id_idx on public.import_issues(user_id);

alter table public.import_issues enable row level security;

revoke all on public.import_issues from anon, authenticated;
grant select, insert, delete on public.import_issues to authenticated;

create policy import_issues_read_own on public.import_issues for select to authenticated using ((select auth.uid()) = user_id);
create policy import_issues_insert_own on public.import_issues for insert to authenticated with check ((select auth.uid()) = user_id);
create policy import_issues_delete_own on public.import_issues for delete to authenticated using ((select auth.uid()) = user_id);

commit;
