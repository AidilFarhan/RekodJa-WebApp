import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function describeKey(key: string | undefined) {
  if (!key) return { set: false };
  const report: { set: boolean; prefix?: string; role?: string | null; segments?: number } = { set: true };
  if (key.startsWith('sb_publishable_')) report.prefix = 'sb_publishable';
  else if (key.startsWith('sb_secret_')) report.prefix = 'sb_secret';
  else if (key.startsWith('eyJ')) {
    report.prefix = 'jwt';
    report.segments = key.split('.').length;
    try {
      const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
      report.role = payload.role ?? null;
    } catch {
      report.role = 'undecodable';
    }
  } else {
    report.prefix = 'other';
  }
  return report;
}

export async function GET() {
  const appUrl = process.env.APP_URL;
  let urlParse: string;
  try {
    urlParse = new URL(appUrl ?? 'http://invalid').origin;
  } catch {
    urlParse = 'INVALID';
  }
  return NextResponse.json({
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV ?? null,
    supabaseUrl: process.env.SUPABASE_URL
      ? { set: true, host: new URL(process.env.SUPABASE_URL).hostname }
      : { set: false },
    supabaseAnonKey: describeKey(process.env.SUPABASE_ANON_KEY),
    appUrl: { set: Boolean(appUrl), value: appUrl ?? null, parsedOrigin: urlParse },
    googleOauthClientId: { set: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID), prefix: process.env.GOOGLE_OAUTH_CLIENT_ID?.slice(0, 16) ?? null },
    googlePickerApiKey: { set: Boolean(process.env.GOOGLE_PICKER_API_KEY), prefix: process.env.GOOGLE_PICKER_API_KEY?.slice(0, 8) ?? null },
    googleCloudProjectNumber: { set: Boolean(process.env.GOOGLE_CLOUD_PROJECT_NUMBER) },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
