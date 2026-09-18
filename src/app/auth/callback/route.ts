import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { configuration } from '@/lib/config';
import { cookies } from 'next/headers';
export async function GET(request: NextRequest) {
  const { appUrl } = configuration();
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const client = await supabase();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) {
      const jar = await cookies();
      const hasVerifier = jar.getAll().some((c) => c.name.includes('code-verifier'));
      console.error('[auth/callback] exchange failed:', error.message, '| verifier cookie present:', hasVerifier);
      const reason = encodeURIComponent(error.message || 'unknown');
      return NextResponse.redirect(`${appUrl}/sign-in?error=callback&reason=${reason}&verifier=${hasVerifier ? 'yes' : 'no'}`, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    return NextResponse.redirect(`${appUrl}/tracker-setup`, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.redirect(`${appUrl}/sign-in?error=callback`, { headers: { 'Cache-Control': 'private, no-store' } });
}
