import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { configuration } from './config';

export async function supabase() {
  const jar = await cookies();
  const { url, key, appUrl } = configuration();
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https://') },
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); }
        catch { /* Server Components cannot set cookies; proxy refreshes them. */ }
      },
    },
  });
}
