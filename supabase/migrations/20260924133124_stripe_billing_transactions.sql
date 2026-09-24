begin;

-- Rekod dalaman untuk Checkout dan webhook sahaja.
create table public.billing_customers (
  user_id uuid primary key
    references auth.users(id) on delete cascade,

  stripe_customer_id text unique,

  -- Digunakan untuk mengesan kemas kini webhook serentak.
  subscription_revision bigint not null default 0
    check (subscription_revision >= 0),

  -- Satu percubaan Checkout aktif bagi setiap user.
  checkout_attempt_id uuid,
  checkout_session_id text unique,
  checkout_lease_until timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;

revoke all on public.billing_customers
  from public, anon, authenticated;

grant select, insert, update on public.billing_customers
  to service_role;

-- Sekiranya subscription sudah wujud ketika migration ini digunakan.
insert into public.billing_customers (user_id, stripe_customer_id)
select user_id, stripe_customer_id
from public.subscriptions;

-- Nyatakan akses server secara jelas.
-- User biasa masih hanya boleh SELECT subscription sendiri.
revoke all on public.subscriptions from public;
revoke all on public.stripe_webhook_events from public;

grant select, insert, update on public.subscriptions
  to service_role;

grant select, insert on public.stripe_webhook_events
  to service_role;

-- Dipanggil hanya selepas signature webhook disahkan dan
-- status langganan terkini dibaca daripada Stripe.
create function public.apply_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_stripe_created_at timestamptz,
  p_expected_revision bigint,
  p_subscription public.subscriptions
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer public.billing_customers%rowtype;
  v_existing public.subscriptions%rowtype;
  v_has_used_trial boolean;
  v_past_due_at timestamptz;
  v_inserted integer;
begin
  if p_event_id is null or btrim(p_event_id) = ''
     or p_event_type is null or btrim(p_event_type) = ''
     or p_stripe_created_at is null
     or p_expected_revision is null
     or p_subscription.user_id is null
     or p_subscription.stripe_customer_id is null
     or p_subscription.stripe_subscription_id is null
  then
    raise exception 'Missing webhook identity';
  end if;

  -- Serialkan penulisan bagi user yang sama.
  select *
  into v_customer
  from public.billing_customers
  where user_id = p_subscription.user_id
  for update;

  if not found then
    raise exception 'Billing customer mapping not found';
  end if;

  if v_customer.stripe_customer_id
     is distinct from p_subscription.stripe_customer_id
  then
    raise exception 'Stripe customer ownership mismatch';
  end if;

  if exists (
    select 1
    from public.stripe_webhook_events
    where event_id = p_event_id
  ) then
    return 'duplicate';
  end if;

  -- Worker lain sudah menulis selepas snapshot dibaca.
  -- Caller mesti baca semula revision dan status Stripe terkini.
  if v_customer.subscription_revision <> p_expected_revision then
    return 'retry';
  end if;

  select *
  into v_existing
  from public.subscriptions
  where user_id = p_subscription.user_id
  for update;

  -- Jangan gantikan subscription yang masih berjalan
  -- dengan subscription lain secara senyap.
  if found
     and v_existing.stripe_subscription_id
         is distinct from p_subscription.stripe_subscription_id
     and v_existing.status not in ('canceled', 'incomplete_expired')
  then
    raise exception 'Another subscription is still present';
  end if;

  v_has_used_trial :=
    coalesce(v_existing.has_used_trial, false)
    or coalesce(p_subscription.has_used_trial, false)
    or p_subscription.trial_end is not null
    or p_subscription.status = 'trialing';

  if p_subscription.status = 'past_due' then
    if v_existing.status = 'past_due'
       and v_existing.stripe_subscription_id =
           p_subscription.stripe_subscription_id
    then
      -- Kekalkan masa kegagalan pertama.
      v_past_due_at := coalesce(
        v_existing.past_due_at,
        p_subscription.past_due_at
      );
    else
      v_past_due_at := p_subscription.past_due_at;
    end if;

    if v_past_due_at is null or v_past_due_at > now() then
      raise exception 'Invalid first payment failure time';
    end if;
  else
    v_past_due_at := null;
  end if;

  insert into public.stripe_webhook_events (
    event_id,
    event_type,
    stripe_created_at
  )
  values (
    p_event_id,
    p_event_type,
    p_stripe_created_at
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return 'duplicate';
  end if;

  insert into public.subscriptions (
    user_id,
    stripe_customer_id,
    stripe_subscription_id,
    status,
    price_id,
    price_lookup_key,
    billing_interval,
    billing_interval_count,
    trial_end,
    current_period_end,
    past_due_at,
    cancel_at_period_end,
    has_used_trial,
    updated_at
  )
  values (
    p_subscription.user_id,
    p_subscription.stripe_customer_id,
    p_subscription.stripe_subscription_id,
    p_subscription.status,
    p_subscription.price_id,
    p_subscription.price_lookup_key,
    p_subscription.billing_interval,
    p_subscription.billing_interval_count,
    p_subscription.trial_end,
    p_subscription.current_period_end,
    v_past_due_at,
    p_subscription.cancel_at_period_end,
    v_has_used_trial,
    now()
  )
  on conflict (user_id) do update set
    stripe_customer_id = excluded.stripe_customer_id,
    stripe_subscription_id = excluded.stripe_subscription_id,
    status = excluded.status,
    price_id = excluded.price_id,
    price_lookup_key = excluded.price_lookup_key,
    billing_interval = excluded.billing_interval,
    billing_interval_count = excluded.billing_interval_count,
    trial_end = excluded.trial_end,
    current_period_end = excluded.current_period_end,
    past_due_at = excluded.past_due_at,
    cancel_at_period_end = excluded.cancel_at_period_end,
    has_used_trial = excluded.has_used_trial,
    updated_at = excluded.updated_at;

  update public.billing_customers
  set subscription_revision = subscription_revision + 1,
      updated_at = now()
  where user_id = p_subscription.user_id;

  return 'applied';
end;
$$;

revoke all on function public.apply_stripe_subscription_event(
  text, text, timestamptz, bigint, public.subscriptions
) from public, anon, authenticated;

grant execute on function public.apply_stripe_subscription_event(
  text, text, timestamptz, bigint, public.subscriptions
) to service_role;

commit;
