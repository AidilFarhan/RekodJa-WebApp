import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { configuration } from '@/lib/config';
import { cookies } from 'next/headers';
export async function GET(request: NextRequest) {
  const { appUrl } = configuration();
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const jar = await cookies();
    const intent = jar.get('rekodja-auth-intent')?.value;
    jar.delete('rekodja-auth-intent');
    if (intent !== 'login' && intent !== 'signup') {
      return NextResponse.redirect(`${appUrl}/sign-in?error=expired`, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    // Keep OAuth credentials off the browser until registration checks succeed.
    const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
    const { url, key } = configuration();
    const client = createServerClient(url, key, {
      cookieOptions: { httpOnly: true, sameSite: 'lax', secure: appUrl.startsWith('https://') },
      cookies: {
        getAll: () => [...jar.getAll(), ...pending.values()],
        setAll: (values) => values.forEach((cookie) => pending.set(cookie.name, cookie)),
      },
    });
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      const jar = await cookies();
      const hasVerifier = jar.getAll().some((c) => c.name.includes('code-verifier'));
      console.error('[auth/callback] exchange failed:', error.message, '| verifier cookie present:', hasVerifier);
      const reason = encodeURIComponent(error.message || 'unknown');
      return NextResponse.redirect(`${appUrl}/sign-in?error=callback&reason=${reason}&verifier=${hasVerifier ? 'yes' : 'no'}`, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    let destination = '/tracker-setup';
    let accepted = false;
    if (data.user) {
      const { data: registration, error: lookupError } = await client.from('account_registrations').select('user_id').eq('user_id', data.user.id).maybeSingle();
      if (lookupError) destination = '/sign-in?error=registration';
      else if (intent === 'login') {
        accepted = Boolean(registration);
        if (!accepted) destination = '/sign-in?notice=create-first';
      } else if (registration) destination = '/sign-in?notice=already-exists';
      else {
        const { error: insertError } = await client.from('account_registrations').insert({ user_id: data.user.id });
        accepted = !insertError;
        if (insertError) destination = insertError.code === '23505' ? '/sign-in?notice=already-exists' : '/sign-in?error=registration';
      }
    } else destination = '/sign-in?error=callback';
    if (accepted) pending.forEach(({ name, value, options }) => jar.set(name, value, options));
    else {
      await client.auth.signOut({ scope: 'local' });
      // Consume only the verifier; never publish the rejected session cookies.
      pending.forEach(({ name, value, options }) => { if (name.includes('code-verifier')) jar.set(name, value, options); });
    }
    return NextResponse.redirect(`${appUrl}${destination}`, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.redirect(`${appUrl}/sign-in?error=callback`, { headers: { 'Cache-Control': 'private, no-store' } });
}
