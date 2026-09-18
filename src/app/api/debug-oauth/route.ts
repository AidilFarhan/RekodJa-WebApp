import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { configuration } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = await supabase();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        scopes: 'openid email profile',
        redirectTo: `${configuration().appUrl}/auth/callback`,
        queryParams: { prompt: 'select_account' },
        skipBrowserRedirect: true,
      },
    });
    if (error) return NextResponse.json({ ok: false, error: error.message });
    return NextResponse.json({ ok: true, url: data.url });
  } catch (e) {
    return NextResponse.json({ ok: false, thrown: e instanceof Error ? e.message : String(e) });
  }
}
