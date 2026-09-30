import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertTestEnvironment, isTestLegacyKey } from './billing/test-environment.mjs';

let adminClient: SupabaseClient | undefined;

export function supabaseAdmin() {
  assertTestEnvironment(process.env);
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase server credentials are not configured.',
    );
  }

  if (!isTestLegacyKey(serviceRoleKey, 'service_role')) {
    throw new Error(
      'Supabase admin client requires the RekodJa Test service-role key.',
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
