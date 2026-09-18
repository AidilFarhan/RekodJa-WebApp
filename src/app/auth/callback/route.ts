import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { configuration } from '@/lib/config';
export async function GET(request: NextRequest) {
  const { appUrl } = configuration();
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const client = await supabase();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${appUrl}/tracker-setup`, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return NextResponse.redirect(`${appUrl}/sign-in?error=callback`, { headers: { 'Cache-Control': 'private, no-store' } });
}
