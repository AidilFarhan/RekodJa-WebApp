import 'server-only';

export function configuration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const appUrl = process.env.APP_URL;
  if (!url || !key || !appUrl) throw new Error('Set SUPABASE_URL, SUPABASE_ANON_KEY and APP_URL in the selected environment.');
  if (key.startsWith('sb_secret_')) throw new Error('Use a public Supabase key, never a secret key.');
  if (key.split('.').length === 3) {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
    if (payload.role !== 'anon') throw new Error('Only an anon key is allowed.');
  }
  return { url, key, appUrl: new URL(appUrl).origin };
}
