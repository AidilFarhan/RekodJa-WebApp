import { createAccount, signIn } from '../actions';
import AccountNotice from './account-notice';
import { CircuitBoard } from '@/components/ui/circuit-board';
import { TextMorph } from '@/components/ui/text-morph';
import { Globe, Monitor, Puzzle, Table2 } from 'lucide-react';
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string; reason?: string; notice?: string }> }) {
  const { error, deleted, reason, notice } = await searchParams;
  return <section className="sign-in-page">
    <TextMorph words={['Apply', 'Click Save', 'Review']} interval={2400} morphDuration={680} className="sign-in-morph" />
    <div className="sign-in-main">
      <h1 className="sign-in-wordmark"><span className="wordmark">Rekod<span className="wordmark-ja">Ja</span></span></h1>
      {deleted && <p role="status" className="message">Your account and all your data have been deleted.</p>}
      {error && <p role="alert" className="message error">{reason ? `Sign-in failed: ${reason}` : 'Sign-in could not be completed. Please try again.'}</p>}
      <div className="sign-in-actions">
        <form action={createAccount}><button className="sign-in-button" type="submit">Create account with Google</button></form>
        <form action={signIn}><button className="sign-in-button secondary" type="submit">Log in with Google</button></form>
      </div>
    </div>
    {(notice === 'create-first' || notice === 'already-exists') && <AccountNotice key={notice} notice={notice} />}
    <CircuitBoard
      nodes={[
        { id: 'start', x: 80, y: 80, label: 'Job Website', icon: <Globe size={16} /> },
        { id: 'process', x: 250, y: 80, label: 'RekodJa: Extension', icon: <Puzzle size={16} /> },
        { id: 'validate', x: 420, y: 80, label: 'Spreadsheet', icon: <Table2 size={16} /> },
        { id: 'end', x: 620, y: 80, label: 'RekodJa: WebApp', icon: <Monitor size={16} /> },
      ]}
      connections={[
        { from: 'start', to: 'process', animated: true },
        { from: 'process', to: 'validate', animated: true },
        { from: 'validate', to: 'end', animated: true },
      ]}
      width={500}
      height={300}
    />
    <small className="sign-in-note">We use your Google identity, email and profile only. Gmail and Google Sheets access are not requested.</small>
  </section>;
}
