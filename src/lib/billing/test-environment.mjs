// Public environment identifiers only. Never return credential values in errors.
export const TEST_SUPABASE_URL = 'https://zfcxgfiqmirkqerqzsny.supabase.co';
export const TEST_PROJECT_REF = 'zfcxgfiqmirkqerqzsny';
export const TEST_APP_URL = 'http://localhost:3002';

/** This checks legacy key claims, NOT its cryptographic validity. Supabase
 * authenticates the credential when it is used. Opaque keys cannot prove a
 * project match offline, so admin access currently requires the legacy key.
 * @param {string | undefined} key
 * @param {'anon' | 'service_role'} role
 */
export function isTestLegacyKey(key, role) {
  try {
    const parts = (key ?? '').split('.');
    if (parts.length !== 3 || parts.some(part => !part)) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role === role && payload.ref === TEST_PROJECT_REF;
  } catch {
    return false;
  }
}

/** @param {Record<string, string | undefined>} env */
export function assertTestEnvironment(env) {
  if (env.SUPABASE_URL !== TEST_SUPABASE_URL || env.APP_URL !== TEST_APP_URL) {
    throw new Error('Billing requires the isolated RekodJa Test environment.');
  }
}
