import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Account({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  redirect(error ? `/dashboard/settings?error=${error}` : '/dashboard/settings');
}
