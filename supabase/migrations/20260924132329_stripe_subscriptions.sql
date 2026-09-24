begin;

create table public.subscriptions (
  user_id uuid primary key
    references auth.users(id) on delete cascade,

  stripe_customer_id text unique,
  stripe_subscription_id text unique,

  status text not null
    check (status in (
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'canceled',
      'unpaid',
      'paused'
    )),

  price_id text not null,

  price_lookup_key text not null
    check (price_lookup_key in (
      'PRO_monthly',
      'PRO_3_months',
      'PRO_yearly'
    )),

  billing_interval text not null
    check (billing_interval in ('month', 'year')),

  billing_interval_count integer not null
    check (
      (billing_interval = 'month' and billing_interval_count in (1, 3))
      or
      (billing_interval = 'year' and billing_interval_count = 1)
    ),

  trial_end timestamptz,
  current_period_end timestamptz,
  past_due_at timestamptz,
  cancel_at_period_end boolean not null default false,
  has_used_trial boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint subscriptions_lookup_key_matches_interval check (
    (price_lookup_key = 'PRO_monthly'
      and billing_interval = 'month' and billing_interval_count = 1)
    or
    (price_lookup_key = 'PRO_3_months'
      and billing_interval = 'month' and billing_interval_count = 3)
    or
    (price_lookup_key = 'PRO_yearly'
      and billing_interval = 'year' and billing_interval_count = 1)
  )
);

alter table public.subscriptions enable row level security;

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;

create policy subscriptions_read_own
  on public.subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  stripe_created_at timestamptz not null,
  processed_at timestamptz not null default now()
);

alter table public.stripe_webhook_events enable row level security;

revoke all on public.stripe_webhook_events from anon, authenticated;

commit;
