/*
 * Gmail scan engine.
 *
 * Server-side scan flow that reuses the extension's algorithm against the
 * web app's applications table instead of a sheet snapshot. Used by
 * `src/app/api/gmail/scan/route.ts` — pure read-only logic, no DB writes.
 */

import {
  classifyEmail,
  currentEmailText,
  extractEmailDetails,
  isApplicationEmail,
  matchApplications,
  suggestKnownCompany,
  type ApplicationRecord,
  type EmailStage,
  type GmailMessage,
} from './scan-core.ts';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Same query string as the extension's background worker, but a 45-day window.
export const GMAIL_SEARCH_QUERY =
  'newer_than:45d -in:spam -in:trash -in:sent -in:drafts {"application" "thank you for applying" "thanks for applying" "interview" "regret" "job offer" "offer of employment" "permohonan" "temuduga" "temu duga"}';

type ListResponse = { messages?: { id: string; threadId: string }[]; nextPageToken?: string; resultSizeEstimate?: number };
type ProfileResponse = { emailAddress: string };
type FullMessage = GmailMessage & { labelIds?: string[] };

export type ScanCandidate = {
  email: string;
  messageId: string;
  threadId: string;
  internalDate: string;
  threadLink: string;
  subject: string;
  from: string;
  snippet: string; // trimmed text used for classification (see DESIGN.md questions)
  sender: string;
  suggested: { company: string; role: string; status: EmailStage | '' };
  match: { applicationId: string; company: string } | null;
  eventType: 'stage_observation' | 'employer_response' | null;
};

export type ScanResult = { email: string; scanned: number; skipped: number; candidates: ScanCandidate[] };

// Paced + retrying fetch helper, ported from the extension's
// gmail-background.js policy: reads at most 2/s, retry transient
// errors up to 5 times, honour Retry-After where short.
// Timing is exposed so tests can run without real delays.
export const scanTiming = { paceMs: 500, backoffBaseMs: 5000 };
let lastRequestAt = 0;

async function gmailJson<T>(token: string, url: string, attempt = 0): Promise<T> {
  const delay = Math.max(0, scanTiming.paceMs - (Date.now() - lastRequestAt));
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  lastRequestAt = Date.now();

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (response.ok) return (await response.json()) as T;

  const text = await response.text();
  let message = `Gmail request failed (${response.status})`;
  let reason = '';
  try {
    const body = JSON.parse(text) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? '';
    message = body.error?.message || message;
  } catch { /* non-JSON error body */ }

  const rateLimited =
    response.status === 429 ||
    (response.status === 403 && /RATE_LIMIT|rateLimit|per minute|units per minute/i.test(reason + ' ' + message));
  const transient = rateLimited || response.status >= 500;

  if (transient && attempt < 5) {
    const retryHeader = response.headers.get('Retry-After');
    const retryAfter = retryHeader ? (/^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : Math.max(0, Date.parse(retryHeader) - Date.now())) : 0;
    if (retryAfter <= 60000) {
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter || 0, Math.min(60000, scanTiming.backoffBaseMs * 2 ** attempt))));
      return gmailJson<T>(token, url, attempt + 1);
    }
    throw new Error('Google rate limit is still active. Wait a minute or two and try again.');
  }

  if (response.status === 401) throw new Error('Google authorization expired. Reconnect Gmail access and try again.');
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions|insufficient.*scope/i.test(reason + ' ' + message)) {
    throw new Error('Google access does not include Gmail read permission. Reconnect and allow Gmail access.');
  }
  if (response.status === 403) throw new Error('Gmail access was denied. Check Gmail API access and Workspace administrator restrictions.');
  throw new Error(message);
}

/*
 * The web app's matching note: `import_key` is a sheet-import identity and
 * cannot be rebuilt from an email alone. Gmail matching therefore uses
 *   (a) thread-link equality on applications.job_url  — rows the extension
 *       imported carry the Gmail thread link in job_url, and
 *   (b) normalized company name.
 * Once a candidate is confirmed onto an application, the existing stage-sync
 * (`src/lib/sheets/sync.ts`) already bridges back to the Sheet — the
 * import_key path remains covered there.
 */
export async function scanGmail(token: string, applications: ApplicationRecord[], emailOverride?: string): Promise<ScanResult> {
  const email = emailOverride ?? (await gmailJson<ProfileResponse>(token, 'https://gmail.googleapis.com/gmail/v1/users/me/profile')).emailAddress;

  let scanned = 0;
  let skipped = 0;
  let nextPage: string | undefined;
  const byThread = new Map<string, ScanCandidate>();

  do {
    const pageUrl =
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=' +
      encodeURIComponent(GMAIL_SEARCH_QUERY) +
      (nextPage ? '&pageToken=' + encodeURIComponent(nextPage) : '');
    const page = await gmailJson<ListResponse>(token, pageUrl);
    nextPage = page.nextPageToken;

    for (const item of page.messages ?? []) {
      const message = await gmailJson<FullMessage>(token, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=full`);
      scanned += 1;
      if ((message.labelIds ?? []).some((label) => ['SENT', 'DRAFT'].includes(label))) { skipped += 1; continue; }

      const headers = message.payload?.headers ?? [];
      const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name)?.value ?? '';
      const subject = header('subject');
      const from = header('from');
      const text = currentEmailText(message);
      if (!isApplicationEmail(subject, text, from)) { skipped += 1; continue; }

      const details = suggestKnownCompany(extractEmailDetails(subject, text, from), subject + '\n' + text + '\n' + from, applications);
      const link = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${message.threadId}`;
      const matches = matchApplications(applications, details.company, link);
      const eventType: ScanCandidate['eventType'] = ['Rejected', 'Offer', 'Interview'].includes(classifyEmail(subject, text)) ? 'employer_response' : 'stage_observation';
      const candidate: ScanCandidate = {
        email,
        messageId: message.id,
        threadId: message.threadId,
        internalDate: message.internalDate,
        threadLink: link,
        subject,
        from,
        snippet: text,
        sender: details.sender,
        suggested: { company: details.company, role: details.role, status: classifyEmail(subject, text) },
        match: matches.length === 1 ? { applicationId: matches[0].id, company: matches[0].company } : null,
        eventType: matches.length ? eventType : null,
      };

      // Keep only the latest message per thread (extension behaviour).
      const previous = byThread.get(message.threadId);
      if (!previous || Number(candidate.internalDate) > Number(previous.internalDate)) byThread.set(message.threadId, candidate);
    }
  } while (nextPage);

  const candidates = [...byThread.values()].sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
  return { email, scanned, skipped, candidates };
}

/*
 * Shape of the payload a reviewed candidate produces. Detected rows land in
 * application_events with event_status 'detected'; the confirm step writes
 * them again (or flips them) to 'user_confirmed' — matching the extension's
 * suggestion -> review-checkbox -> save flow.
 */
export function eventDraft(candidate: ScanCandidate, stage: string) {
  return {
    event_status: 'detected' as const,
    event_type: candidate.eventType ?? 'stage_observation',
    from_stage: null,
    to_stage: stage || candidate.suggested.status || null,
    source: 'gmail_scan',
  };
}
