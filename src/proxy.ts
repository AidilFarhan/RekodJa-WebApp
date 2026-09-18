import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { configuration } from './lib/config';

export async function proxy(request: NextRequest) {
  // Supabase falls back to its Site URL when flow state is lost; if that URL is
  // the bare origin, the auth code lands on "/" instead of /auth/callback.
  // Forward it so sign-in can still complete.
  if (request.nextUrl.pathname === '/' && request.nextUrl.searchParams.has('code')) {
    const code = request.nextUrl.searchParams.get('code');
    const callback = new URL('/auth/callback', request.nextUrl.origin);
    callback.searchParams.set('code', code ?? '');
    return NextResponse.redirect(callback, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.APP_URL) return NextResponse.next();
  const { url, key, appUrl } = configuration();
  let response = NextResponse.next({ request });
  const client = createServerClient(url, key, { cookieOptions: { httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https://') }, cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values) {
      values.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
  } });
  await client.auth.getUser();
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
export const config = { matcher: ['/', '/sign-in', '/account', '/tracker-setup', '/api/:path*', '/auth/callback'] };
