begin;

-- Account deletion must remove a user's Gmail scan results whether or not they
-- are Pro. The restrictive gmail_scan_candidates_require_pro policy blocks
-- every command for non-subscribers, and narrowing it to exclude DELETE would
-- not help: a DELETE with a WHERE clause is also filtered by SELECT policies.
-- This function deletes only the caller's own rows and nothing else.
create function public.delete_own_gmail_scan_candidates()
returns void language sql security definer set search_path = '' as $$
  delete from public.gmail_scan_candidates where user_id = (select auth.uid());
$$;
revoke all on function public.delete_own_gmail_scan_candidates() from public, anon;
grant execute on function public.delete_own_gmail_scan_candidates() to authenticated;

commit;
