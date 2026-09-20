import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { followUpActions, type DashboardApplication, type DashboardEvent } from '@/lib/dashboard';
import WorkspaceNav from './nav';
import SettingsLink from './settings-link';
import SidebarController from './sidebar-controller';
import SidebarToggleButton from './sidebar-toggle';
import NotificationsBell from './notifications-bell';
import './workspace.css';
export default async function Workspace({ children }: { children: React.ReactNode }) {
  const client = await supabase();
  const { data: { user } } = await client.auth.getUser();
  const { data: profile } = user ? await client.from('profiles').select('display_name').eq('id', user.id).single() : { data: null };
  const [{ data: applications }, { data: events }, { data: issues }] = user ? await Promise.all([
    client.from('applications').select('id, stage, date_applied'),
    client.from('application_events').select('application_id, event_status, event_type'),
    client.from('import_issues').select('id, message').order('created_at', { ascending: false }).limit(10),
  ]) : [{ data: null }, { data: null }, { data: null }];
  const name = profile?.display_name || 'Your account';
  const actionsCount = followUpActions((applications ?? []) as DashboardApplication[], (events ?? []) as DashboardEvent[]).length;
  const subscribed = false; // No billing yet (v2). Flip to the real subscription check when payments exist.
  return <SidebarController><aside className="workspace-sidebar"><WorkspaceNav actionsCount={actionsCount} /><div className="sidebar-bottom"><SettingsLink /><p>My Lord! Uplift my heart for me and make my task easy and remove the impediment from my tongue so people may understand my speech. Surah Taha: 25-28</p></div></aside><div className="workspace-body"><div className="workspace-topbar"><div className="topbar-left"><SidebarToggleButton /><Link className="workspace-brand" href="/dashboard/overview"><span className="wordmark">Rekod<span className="wordmark-ja">Ja</span></span> <small>{subscribed ? 'Pro' : 'Free'}</small></Link></div><div className="topbar-right"><NotificationsBell issues={(issues ?? []) as { id: string; message: string }[]} /><Link href="/dashboard/settings"><span className="avatar">{name.split(/\s+/).slice(0,2).map((part: string) => part[0]).join('').toUpperCase()}</span>{name}</Link></div></div><div className="workspace-content">{children}</div></div></SidebarController>;
}
