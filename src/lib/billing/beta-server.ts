import 'server-only';
import { isBetaTester, parseBetaEmails, parseBetaEndsAt } from './beta';

/** Warnings are emitted once per process: beta config is read on every Gmail
 * request, and repeating the same line per request would bury real errors.
 * Nothing here ever prints an address.
 */
let warned = false;

/** Beta configuration for this process. A missing or malformed value grants
 * nobody access rather than failing open. */
export function betaConfiguration() {
  const rawEmails = process.env.BETA_TESTER_EMAILS;
  const rawEndsAt = process.env.BETA_ENDS_AT;
  const emails = parseBetaEmails(rawEmails);
  const endsAtMs = parseBetaEndsAt(rawEndsAt);

  if (!warned) {
    warned = true;
    if (!rawEmails?.trim()) {
      console.warn('beta: BETA_TESTER_EMAILS is not set; no beta tester will be granted access.');
    } else if (emails.length === 0) {
      console.warn('beta: BETA_TESTER_EMAILS holds no usable address; no beta tester will be granted access.');
    } else {
      console.warn(`beta: ${emails.length} tester address(es) configured.`);
    }
    if (endsAtMs === null) {
      console.warn('beta: BETA_ENDS_AT is missing or unparseable; beta access is treated as ended.');
    }
  }

  return { emails, endsAtMs };
}

/** Beta eligibility for the verified email of the current request. */
export function userIsBetaTester(email: string | null | undefined, nowMs = Date.now()) {
  const { emails, endsAtMs } = betaConfiguration();
  return isBetaTester(email, emails, endsAtMs, nowMs);
}
