import { signIn } from '../actions';
export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <section><h1>Welcome to Job Tracker Pro</h1><p>Sign in to create your private account.</p>{error && <p role="alert" className="message error">Sign-in could not be completed. Please try again.</p>}<form action={signIn}><button>Continue with Google</button></form><small>We use your Google identity, email and profile only. Gmail and Google Sheets access are not requested.</small></section>;
}
