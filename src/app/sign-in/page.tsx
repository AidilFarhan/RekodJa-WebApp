import { signIn } from '../actions';
import { CircuitFlow } from '@/components/ui/circuit-flow';
import { TextMorph } from '@/components/ui/text-morph';
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string; reason?: string }> }) {
  const { error, deleted, reason } = await searchParams;
  return <section className="sign-in-page">
    <TextMorph words={['Apply', 'Click Save', 'Review']} interval={2400} morphDuration={680} className="sign-in-morph" />
    <div className="sign-in-main">
      <h1 className="sign-in-wordmark"><span className="wordmark">Rekod<span className="wordmark-ja">Ja</span></span></h1>
      <p className="sign-in-intro">Your job search, all connected.</p>
      {deleted && <p role="status" className="message">Your account and all your data have been deleted.</p>}
      {error && <p role="alert" className="message error">{reason ? `Sign-in failed: ${reason}` : 'Sign-in could not be completed. Please try again.'}</p>}
      <div className="sign-in-actions">
        <form action={signIn}><button className="sign-in-button" type="submit">Create account with Google</button></form>
        <form action={signIn}><button className="sign-in-button secondary" type="submit">Log in with Google</button></form>
      </div>
    </div>
    <CircuitFlow />
    <small className="sign-in-note">We use your Google identity, email and profile only. Gmail and Google Sheets access are not requested.</small>
  </section>;
}
