begin;

-- TEST ONLY rollout: do not apply to production without a separate approval.
-- Durable, immutable inputs for a single Checkout attempt. They let retries use
-- the same Stripe idempotency key and identical parameters after process loss.
alter table public.billing_customers
  add column checkout_plan text check (checkout_plan in ('PRO_monthly', 'PRO_3_months', 'PRO_yearly')),
  add column checkout_price_id text,
  add column checkout_trial boolean,
  add column checkout_created_at timestamptz,
  add column mutation_id uuid,
  add column mutation_kind text check (mutation_kind in ('change_plan', 'cancel')),
  add column mutation_started_at timestamptz;

create function public.claim_stripe_checkout(
  p_user_id uuid, p_plan text, p_price_id text, p_trial boolean
)
returns public.billing_customers
language plpgsql security invoker set search_path = '' as $$
declare v_row public.billing_customers%rowtype;
begin
  if p_plan not in ('PRO_monthly','PRO_3_months','PRO_yearly')
     or p_price_id is null or p_trial is null then
    raise exception 'Invalid checkout inputs';
  end if;
  select * into strict v_row from public.billing_customers
    where user_id = p_user_id for update;
  if v_row.stripe_customer_id is null or v_row.mutation_id is not null then
    raise exception 'Billing customer not ready';
  end if;
  if v_row.checkout_attempt_id is null then
    update public.billing_customers set
      checkout_attempt_id = gen_random_uuid(), checkout_plan = p_plan,
      checkout_price_id = p_price_id, checkout_trial = p_trial,
      checkout_created_at = now(),
      checkout_lease_until = to_timestamp(floor(extract(epoch from now())) + 3600),
      checkout_session_id = null, updated_at = now()
    where user_id = p_user_id returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke all on function public.claim_stripe_checkout(uuid,text,text,boolean) from public, anon, authenticated;
grant execute on function public.claim_stripe_checkout(uuid,text,text,boolean) to service_role;

-- Invoker, not definer: subscriptions already restrict the caller to own rows.
create function public.has_pro_access()
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.subscriptions s where s.user_id = (select auth.uid())
      and case s.status
        when 'trialing' then s.trial_end > now()
        when 'active' then s.current_period_end > now()
        when 'past_due' then s.past_due_at <= now() and s.past_due_at + interval '168 hours' > now()
        else false end
  );
$$;
revoke all on function public.has_pro_access() from public, anon;
grant execute on function public.has_pro_access() to authenticated;

-- AND this restriction with existing ownership policies. No rows are deleted.
create policy gmail_scan_candidates_require_pro
  on public.gmail_scan_candidates as restrictive for all to authenticated
  using ((select public.has_pro_access()))
  with check ((select public.has_pro_access()));

commit;
