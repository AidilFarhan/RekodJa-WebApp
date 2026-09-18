export default function DashboardLoading() {
  return <div className="importing-overlay" role="status" aria-live="polite"><div className="importing-dialog"><img className="cat-img" src="/cat-run.gif" alt="Running cat" /><p>Please be patient…</p><div className="importing-track" aria-hidden="true"><span/><span/><span/></div></div></div>;
}
