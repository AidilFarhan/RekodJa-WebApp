/*
 * Port of the Chrome extension's gmail-core.js (JOB TRACKER repo) to TypeScript.
 *
 * DESIGN PROTOTYPE — not wired to any route yet.
 *
 * These are pure functions only: no chrome.* APIs, no network access, no DOM.
 * The bilingual (English/Malay) keyword lists and quote-stripping logic are
 * preserved verbatim from the extension version. Only two intentional,
 * behaviour-equivalent deviations exist:
 *   1. `suggestKnownCompany` returns a new object instead of mutating `details`.
 *   2. `matchApplications` matches DB-shaped records instead of raw sheet rows.
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

export type EmailStage = '' | 'Applied' | 'Interview' | 'Offer' | 'Rejected' | 'Ghosted' | 'Replied';

export type ExtractedEmailDetails = { company: string; role: string; sender: string };

// Minimal shape of an applications row needed for matching/suggesting.
export type ApplicationRecord = { id: string; company: string; role?: string; job_url?: string };

export function classifyEmail(subject: string, snippet: string): EmailStage {
  const text = subject + '\n' + snippet;
  if (!isApplicationEmail(subject, snippet)) return '';
  // Expired posting that never responded -> the employer ghosted us.
  if (/\bexpired\b.{0,120}\bno longer taking applications\b|no longer taking applications/i.test(text)) return 'Ghosted';
  if (/\bregret(?:fully)?\b.{0,160}(?:inform|advise|application|unable|cannot|not |unsuccessful)|not (?:be )?moving forward|not been successful|unsuccessful|not (?:been )?selected|unable to (?:offer|proceed)|decided (?:not to|to (?:proceed|move forward) with (?:other|another))|not move your application forward|not to proceed further with your application|decided to move forward with candidates|we have already chosen another candidate for the position|dukacita|tidak berjaya/i.test(text)) return 'Rejected';
  if (/pleased to offer(?: you)?|offer (?:you|of) (?:employment|the (?:position|role))|your (?:job|employment) offer|(?:job|employment) offer\s*[:–—-]|tawaran (?:jawatan|pekerjaan)/i.test(text)) return 'Offer';
  if (/interview (?:invitation|scheduled|confirmation)|invit(?:e|ing|ation).{0,80}interview|interview for|schedule.{0,40}interview|temu duga|temuduga/i.test(text)) return 'Interview';
  if (/application (received|submitted)|received your application|thank you for (applying|your application)|thanks for applying|permohonan.*diterima/i.test(text)) return 'Applied';
  if (/reach out|confirmation/i.test(text)) return 'Replied';
  return '';
}

export function isApplicationEmail(subject: string, body: string, from = ''): boolean {
  const text = subject + '\n' + body;
  if (/(?:loan|credit card|visa|scholarship|mortgage|membership) application/i.test(subject)) return false;
  // JobStreet/Indeed auto-confirmations are not worth reviewing.
  if (/jobstreet|indeed/i.test(from) && /successfully submitted/i.test(text)) return false;
  if (/new invitations?|invited you to connect|see who reached out|job alerts?|jobs (?:for you|you may)|recommended jobs|recommended for you|jobs? matching|top job picks|who(?:'s| has) viewed|grow your network|try premium|interview tips|how to .{0,30}interview|newsletter|oauth verification|verification request|kempen|bonanza|promosi|diskaun|jom sertai/i.test(subject)) return false;
  if (/apply now|browse jobs|jobs you may be interested in|recommended jobs|try premium|see who reached out|oauth verification|verification request|reviewed your application|your application code|install the .{0,60}sdk|sdk and move|kempen|bonanza|promosi|diskaun|jom sertai|permohonan (?:pinjaman|pembiayaan|kredit|perumahan)/i.test(text) && !/received your application|thank(?:s| you) for applying|application (?:was |has been )?(?:submitted|received|sent)|regret.{0,80}(?:inform|application)|pleased to offer you|invit(?:e|ing) you.{0,60}interview/i.test(text)) return false;
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
