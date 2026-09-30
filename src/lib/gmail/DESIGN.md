# Gmail scan for the web app — design review (prototype)

> Status: **design sketch for review only**. Nothing is wired to an endpoint,
> nothing is committed, no OAuth scope changes have been made, and no existing
> feature (extension, Sheet sync, etc.) has been touched.

Prototype files:

- `src/lib/gmail/scan-core.ts` — ported classification logic (pure functions)
- `src/lib/gmail/scan-engine.ts` — scan flow sketch
- `src/lib/gmail/DESIGN.md` — this document

---

## 1. Ported `gmail-core` module (TypeScript)

Pure functions only: no `chrome.*` APIs, no network access, no DOM. The
bilingual (English/Malay) keyword lists and quote-stripping logic are
preserved verbatim from the extension's `gmail-core.js`. Two intentional,
behaviour-equivalent deviations:

1. `suggestKnownCompany` returns a new object instead of mutating `details`.
2. `matchApplications` matches DB-shaped records instead of raw sheet rows.

```ts
/*
 * Port of the Chrome extension's gmail-core.js (JOB TRACKER repo) to TypeScript.
 * DESIGN PROTOTYPE — not wired to any route yet.
 */

export type GmailHeader = { name: string; value: string };

export type GmailPayload = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  internalDate: string;
  snippet?: string;
  payload?: GmailPayload & { headers?: GmailHeader[] };
};

export type EmailStage = '' | 'Applied' | 'Interview' | 'Offer' | 'Rejected';

export type ExtractedEmailDetails = { company: string; role: string; sender: string };

// Minimal shape of an applications row needed for matching/suggesting.
export type ApplicationRecord = { id: string; company: string; role?: string; job_url?: string };

export function classifyEmail(subject: string, snippet: string): EmailStage {
  const text = subject + '\n' + snippet;
  if (!isApplicationEmail(subject, snippet)) return '';
  if (/\bregret(?:fully)?\b.{0,160}(?:inform|advise|application|unable|cannot|not |unsuccessful)|not (?:be )?moving forward|not been successful|unsuccessful|not (?:been )?selected|unable to (?:offer|proceed)|decided (?:not to|to (?:proceed|move forward) with (?:other|another))|dukacita|tidak berjaya/i.test(text)) return 'Rejected';
  if (/pleased to offer you|offer (?:you|of) (?:employment|the (?:position|role))|your (?:job|employment) offer|(?:job|employment) offer\s*[:–—-]|tawaran (?:jawatan|pekerjaan)/i.test(text)) return 'Offer';
  if (/interview (?:invitation|scheduled|confirmation)|invit(?:e|ing|ation).{0,80}interview|interview for|schedule.{0,40}interview|temu duga|temuduga/i.test(text)) return 'Interview';
  if (/application (received|submitted)|received your application|thank you for (applying|your application)|thanks for applying|permohonan.*diterima/i.test(text)) return 'Applied';
  return '';
}

export function isApplicationEmail(subject: string, body: string): boolean {
  const text = subject + '\n' + body;
  if (/(?:loan|credit card|visa|scholarship|mortgage|membership) application/i.test(subject)) return false;
  if (/new invitations?|invited you to connect|see who reached out|job alerts?|jobs (?:for you|you may)|recommended jobs|recommended for you|jobs? matching|top job picks|who(?:'s| has) viewed|grow your network|try premium|interview tips|how to .{0,30}interview|newsletter/i.test(subject)) return false;
  if (/apply now|browse jobs|jobs you may be interested in|recommended jobs|try premium|see who reached out/i.test(text) && !/received your application|thank(?:s| you) for applying|application (?:was |has been )?(?:submitted|received|sent)|regret.{0,80}(?:inform|application)|pleased to offer you|invit(?:e|ing) you.{0,60}interview/i.test(text)) return false;
  return /(?:your|the) application|application (?:received|submitted|update|status)|received your application|thank(?:s| you) for applying|applied for|interview (?:invitation|confirmation|scheduled|update|result)|invit(?:e|ing) you.{0,60}interview|interview for|pleased to offer you|offer of employment|your (?:job|employment) offer|(?:job|employment) offer\s*[:–—-]|permohonan|temu duga|temuduga|tawaran (?:jawatan|pekerjaan)/i.test(text);
}

// Decode text MIME parts only. Never mount email HTML or load remote resources.
export function emailBody(payload?: GmailPayload): string {
  if (!payload || payload.filename) return '';
  if (payload.parts?.length) {
    const parts = payload.mimeType === 'multipart/alternative'
      ? [payload.parts.find((part) => part.mimeType === 'text/plain') || payload.parts.find((part) => part.mimeType === 'text/html') || payload.parts[0]]
      : payload.parts;
    return parts.map(emailBody).join('\n');
  }
  if (!/^text\/(plain|html)$/.test(payload.mimeType || '') || !payload.body?.data) return '';
  try {
    const bytes = Uint8Array.from(atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    let text = new TextDecoder().decode(bytes);
    if (payload.mimeType === 'text/html') text = text.split(/<div\b[^>]*class=["'][^"']*\bgmail_quote\b/i)[0].replace(/<(script|style|blockquote)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<(?:br|\/p|\/div|\/tr|\/li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ');
    return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"');
  } catch { return ''; }
}

export function currentEmailText(message: GmailMessage): string {
  const body = emailBody(message.payload) || message.snippet || '';
  // Old quoted messages must not turn a new invitation into an old rejection.
  return body.split(/\n\s*(?:On .{0,200}wrote:|From:|_{5,}|-{2,}\s*(?:Original|Forwarded) message)/i)[0].split('\n').filter((line) => !/^\s*>/.test(line)).join('\n');
}

export function normalizeCompany(value: unknown): string {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function extractEmailDetails(subject: string, snippet: string, from: string): ExtractedEmailDetails {
  const sender = (from.match(/<([^<>\s]+@[^<>\s]+)>/) || from.match(/([^\s<>]+@[^\s<>]+)/) || [])[1] || '';
  const clean = (value: string) => String(value || '').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '').slice(0, 180);
  let company = '';
  let role = '';
  // Prefer explicit application wording over the sending platform's identity.
  for (const text of [subject, snippet]) {
    const pair = text.match(/(?:application for|applied for|applying for|interview for|position of|role of)\s+(?:the\s+)?(.+?)\s+(?:at|with)\s+(.+?)(?=[.!?\n]|\s[|–—]|$)/i);
    if (pair) { role ||= clean(pair[1]).replace(/\s+(?:position|role)$/i, ''); company ||= clean(pair[2]); }
    const submitted = text.match(/(?:application (?:was |has been )?(?:sent|submitted) to|your application (?:to|at)|thank(?:s| you) for applying (?:to|at))\s+(.+?)(?=[.!?\n]|\s[|–—]|\s+for\s+(?:the\s+)?|$)/i);
    if (submitted) company ||= clean(submitted[1]);
    const position = text.match(/(?:application for|applying for|interview for)\s+(?:the\s+)?(.+?)\s+(?:position|role)\b/i);
    if (position) role ||= clean(position[1]);
    const labeledRole = text.match(/(?:job title|position|role|jawatan)\s*:\s*([^\n|;]+)/i);
    const labeledCompany = text.match(/(?:company|employer|syarikat)\s*:\s*([^\n|;]+)/i);
    if (labeledRole) role ||= clean(labeledRole[1]);
    if (labeledCompany) company ||= clean(labeledCompany[1]);
  }
  if (!company) {
    const display = clean(from.replace(/<[^>]*>/g, '').replace(/^"|"$/g, ''));
    const branded = display.match(/^(.+?)\s+(?:careers|recruitment|talent acquisition|hiring team)$/i);
    if (branded && !/linkedin|jobstreet|indeed|workday|greenhouse|lever|smartrecruiters/i.test(branded[1])) company = clean(branded[1]);
  }
  return { company, role, sender };
}

// Web-app matcher: thread-link equality first, then normalized company name.
export function matchApplications(records: ApplicationRecord[], company: string, link: string): ApplicationRecord[] {
  const linked = records.filter((record) => record.job_url === link);
  if (linked.length) return linked;
  const name = normalizeCompany(company);
  return name ? records.filter((record) => normalizeCompany(record.company) === name) : [];
}

export function suggestKnownCompany(details: ExtractedEmailDetails, text: string, records: ApplicationRecord[]): ExtractedEmailDetails {
  if (details.company) return details;
  const normalized = ' ' + normalizeCompany(text) + ' ';
  const names = [...new Set(records.map((record) => record.company).filter(Boolean))];
  const found = names.filter((name) => normalizeCompany(name).length >= 4 && normalized.includes(' ' + normalizeCompany(name) + ' '));
  if (found.length === 1) return { ...details, company: found[0] };
  return details;
}
```

---

## 2. Scan route design (sketch — not wired)

`src/lib/gmail/scan-engine.ts`:

```ts
import {
  classifyEmail, currentEmailText, extractEmailDetails, isApplicationEmail,
  matchApplications, suggestKnownCompany,
  type ApplicationRecord, type EmailStage, type GmailMessage,
} from './scan-core';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

// Same query string as the extension's background worker.
export const GMAIL_SEARCH_QUERY =
  'newer_than:3m -in:spam -in:trash -in:sent -in:drafts {"application" "thank you for applying" "thanks for applying" "interview" "regret" "job offer" "offer of employment" "permohonan" "temuduga" "temu duga"}';

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
  snippet: string; // trimmed text used for classification (see open questions)
  sender: string;
  suggested: { company: string; role: string; status: EmailStage | '' };
  match: { applicationId: string; company: string } | null;
  eventType: 'stage_observation' | 'employer_response' | null;
};

export type ScanResult = { email: string; scanned: number; skipped: number; candidates: ScanCandidate[] };

// Minimal fetch helper. The production version should port the extension's
// pacing (<=2 req/s) and quota backoff/retry logic from gmail-background.js.
async function gmailJson<T>(token: string, url: string): Promise<T> {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message || `Gmail request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

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
      if (!isApplicationEmail(subject, text)) { skipped += 1; continue; }

      const details = suggestKnownCompany(extractEmailDetails(subject, text, from), subject + '\n' + text + '\n' + from, applications);
      const link = `https://mail.google.com/mail/?authuser=${encodeURIComponent(email)}#all/${message.threadId}`;
      const matches = matchApplications(applications, details.company, link);
      const status = classifyEmail(subject, text);
      const eventType: ScanCandidate['eventType'] = ['Rejected', 'Offer', 'Interview'].includes(status) ? 'employer_response' : 'stage_observation';
      const candidate: ScanCandidate = {
        email, messageId: message.id, threadId: message.threadId, internalDate: message.internalDate,
        threadLink: link, subject, from, snippet: text, sender: details.sender,
        suggested: { company: details.company, role: details.role, status },
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

// Detected rows land in application_events with event_status 'detected';
// the confirm step writes them (or flips them) to 'user_confirmed'.
export function eventDraft(candidate: ScanCandidate, stage: string) {
  return {
    event_status: 'detected' as const,
    event_type: candidate.eventType ?? 'stage_observation',
    from_stage: null,
    to_stage: stage || candidate.suggested.status || null,
    source: 'gmail_scan',
  };
}
```

### Proposed endpoint shape (future, not built)

```
POST /api/gmail/scan
  Headers: Authorization: Bearer <GIS access token with gmail.readonly>
  Body:    {} (no args needed; email address comes from /users/me/profile)
  → 200 { email, scanned, skipped, candidates: ScanCandidate[] }
  No DB writes. Read-only and idempotent.

POST /api/gmail/scan/confirm
  Headers: Authorization: Bearer <token>
  Body:    { messageId, applicationId | null, company, role, stage, sender,
             email, threadLink, internalDate, subject, from }
  → writes application_events:
      - one 'user_confirmed' event (event_type 'stage_observation' or
        'employer_response', to_stage = reviewed stage, source 'gmail_scan')
      - updates the application stage (or creates an application for
        unmatched emails)
      - optional: fires the existing sheet stage-sync for matched rows.
```

The client drives both calls (same Bearer-token pattern as sheet import/sync;
`src/lib/google-token.ts` gains a second scope variant).

### Unmatched emails — two-step "match then confirm"

For a candidate with `match: null`:

1. **Match step:** the review UI shows the extracted `suggested.company/role`
   plus a picker of all `applications` (the existing dashboard match logic).
   User either picks an existing application or confirms "create new".
2. **Confirm step:** on save, the endpoint creates the application (reusing
   import-style logic) and writes the `user_confirmed` event — so an
   unmatched email becomes a normal application with history, exactly like
   the extension's "Import this application" path, except into
   `applications`/`application_events` instead of the Sheet.

---

## 3. Explicitly NOT included in this prototype

- [x] No Gmail OAuth scope added to Google Cloud Console yet.
- [x] No actual API route deployed or wired up — design/code sketch only.
- [x] No UI/review screen built yet.
- [x] No changes to the extension, the Sheet sync, or any other working feature.
- [x] Prototype files are uncommitted and not imported anywhere.

---

## 4. Open design decisions (questions, not decided)

1. **`email_observations` table: still not needed, in my view.** The
   `application_events` table already carries the detected/confirmed split
   (`event_status`) and the event vocabulary (`stage_observation`,
   `employer_response`). The scan only adds an ephemeral review queue.
   Options: (a) keep candidates only in the client between scan and confirm
   (simplest; lost on refresh), or (b) a small `gmail_scan_candidates` table
   keyed by user + messageId holding the candidate JSON and review state.
2. **Snippet storage:** how much email text to persist? The candidate
   `snippet` is the full quote-stripped classification text (potentially
   several KB per email). Recommendation: truncate to ~1500 chars in the
   confirm payload and store nothing long-term in `application_events`.
3. **`employer_response` semantics:** should a confirmed `employer_response`
   also flip an existing `Applied` stage (it does today via the status
   suggestion), or remain purely observational?
4. **Matching via `import_key`:** emails cannot rebuild the sheet-import key
   (it needs spreadsheet/sheet/date context). Current design matches thread
   link in `job_url` then normalized company, and the existing stage-sync
   covers the Sheet write-back. Is that acceptable, or should
   `applications` gain a `gmail_thread_id` column for a stronger join?
5. **Sync vs background scan:** the extension paces Gmail reads to 2/s with
   backoff/retries in a background worker. A server route must finish within
   its own lifetime (and the ~1h access token). A 3-month scan typically
   fits, but do you want a synchronous route (simple, like import) or a
   background job with polling (like the extension worker)?
6. **Consent UX:** the web app would carry three Google grants — Supabase
   sign-in (`openid email profile`), GIS `drive.file`, and GIS
   `gmail.readonly`. `gmail.readonly` is a restricted scope: verification and
   possibly a CASA security assessment apply to the web OAuth client
   separately from the extension. Confirm you want the restricted-scope path
   before the consent flow is designed.

