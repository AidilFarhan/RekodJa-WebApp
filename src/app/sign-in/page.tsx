import { signIn } from '../actions';
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; deleted?: string; reason?: string }> }) {
  const { error, deleted, reason } = await searchParams;
  return <section><div className="signin-brand"><span className="wordmark">Rekod<span className="wordmark-ja">Ja</span></span></div><h1>Welcome to RekodJa</h1><p>Sign up to create your personal tracker.</p>{deleted && <p role="status" className="message">Your account and all your data have been deleted.</p>}{error && <p role="alert" className="message error">{reason ? `Sign-in failed: ${reason}` : 'Sign-in could not be completed. Please try again.'}</p>}<form action={signIn}><button>Sign up with Google</button></form><small>We use your Google identity, email and profile only. Gmail and Google Sheets access are not requested.</small></section>;
}
