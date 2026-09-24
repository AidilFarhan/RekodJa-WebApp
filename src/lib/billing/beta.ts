/** Pure beta-access rules. No process.env here: the caller reads configuration
 * and passes it in, so these can be unit tested and cannot read the ambient
 * environment by accident.
 */

/** Comparison form for an address. Applied to both sides of every match. */
export function normaliseEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Split a comma-separated list into normalised addresses.
 * Empty entries and stray whitespace are ignored rather than treated as a
 * malformed list, so a trailing comma cannot silently disable beta access.
 */
export function parseBetaEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map(normaliseEmail)
    .filter((email) => email.length > 0);
}

/** ISO 8601 timestamp that states its own timezone: `2026-09-30T23:59:59+08:00`
 * or `2026-09-30T15:59:59Z`. The zone is mandatory because `Date.parse` is
 * deliberately lenient: it accepts `30 Sep 2026` and `2026-09-30`, interpreting
 * them as UTC midnight. Silently adopting a deadline nobody asked for is worse
 * than refusing to start, so anything ambiguous is rejected here.
 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch milliseconds for BETA_ENDS_AT, or null when it is missing, malformed
 * or carries no timezone. Every caller treats null as "beta is over", so a typo
 * fails closed instead of granting open-ended access.
 */
export function parseBetaEndsAt(raw: string | undefined): number | null {
  const value = (raw ?? '').trim();
  if (!ISO_WITH_ZONE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Beta eligibility for the current request.
 *
 * `email` must be the address from the server's verified user object, never a
 * value taken from the request body. The window is half-open: at exactly
 * BETA_ENDS_AT access has already ended.
 */
export function isBetaTester(
  email: string | null | undefined,
  testerEmails: string[],
  endsAtMs: number | null,
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs)) return false;
  if (endsAtMs === null || nowMs >= endsAtMs) return false;
  const candidate = normaliseEmail(email);
  return candidate.length > 0 && testerEmails.includes(candidate);
}

/** Which source grants Gmail access. A real subscription always wins, so a
 * paying tester is shown the ordinary Pro state rather than the beta label.
 */
export type GmailAccess = 'subscription' | 'beta' | 'denied';

export function gmailAccess(hasSubscription: boolean, betaEligible: boolean): GmailAccess {
  if (hasSubscription) return 'subscription';
  if (betaEligible) return 'beta';
  return 'denied';
}
