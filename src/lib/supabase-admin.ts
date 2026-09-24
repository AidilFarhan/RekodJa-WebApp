import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { billingEnvironment, isTestLegacyKey } from './billing/test-environment.mjs';

let adminClient: SupabaseClient | undefined;

export function supabaseAdmin() {
  const environment = billingEnvironment(process.env);
  if (!environment) {
    throw new Error(
      'Supabase admin requires a recognised billing environment.',
    );
  }
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase server credentials are not configured.',
    );
  }

  // The pairing is enforced in both directions. A live key is opaque and cannot
  // be matched to a project offline, so the mode decides instead: only the Test
  // environment may present the Test project's key, and live data must never be
  // reachable with it.
  if (environment === 'test' && !isTestLegacyKey(serviceRoleKey, 'service_role')) {
    throw new Error(
      'Supabase admin client requires the RekodJa Test service-role key.',
    );
  }

  if (environment === 'live' && isTestLegacyKey(serviceRoleKey, 'service_role')) {
    throw new Error(
      'Supabase admin client must not use the RekodJa Test service-role key.',
    );
  }

  if (adminClient) return adminClient;

  adminClient = createClient(
    url,
    serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  return adminClient;
}
