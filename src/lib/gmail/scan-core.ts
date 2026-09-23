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

// Recruiter-request signal: an email asking the candidate to take a next
// step. Negated forms ("not to proceed further", "unable to proceed further")
// are excluded so rejections stay rejections.
export const recruiterRequestPhrase = /(?<!not )(?<!able )(?<!unable )to proceed further/i;

// Minimal shape of an applications row needed for matching/suggesting.
export type ApplicationRecord = { id: string; company: string; role?: string; job_url?: string };

export function classifyEmail(subject: string, snippet: string): EmailStage {
  const text = subject + '\n' + snippet;
  if (!isApplicationEmail(subject, snippet)) return '';
  // Expired posting that never responded -> the employer ghosted us.
  if (/\bexpired\b.{0,120}\bno longer taking applications?\b|no longer taking applications?|is unlikely to progress further/i.test(text)) return 'Ghosted';
  if (/\bregret(?:fully)?\b.{0,160}(?:inform|advise|application|unable|cannot|not |unsuccessful)|not (?:be )?moving forward|not been successful|unsuccessful|not (?:been )?selected|unable to (?:offer|proceed)|decided (?:not to|to (?:proceed|move forward) with (?:other|another))|not move your application forward|not to proceed further with your application|decided to move forward with candidates|we have already chosen another candidate for the position|dukacita|tidak berjaya/i.test(text)) return 'Rejected';
  if (/pleased to offer(?: you)?|offer (?:you|of) (?:employment|the (?:position|role))|your (?:job|employment) offer|(?:job|employment) offer\s*[:–—-]|tawaran (?:jawatan|pekerjaan)/i.test(text)) return 'Offer';
  if (/interview (?:invitation|scheduled|confirmation)|invit(?:e|ing|ation).{0,80}interview|interview for|schedule.{0,40}interview|temu duga|temuduga/i.test(text)) return 'Interview';
  // Acknowledgements. Deliberately placed AFTER Rejected, Offer and Interview:
  // those are checked first, so widening this branch cannot hijack them. A
  // rejection that opens with "thank you for your interest" is still Rejected.
  // "thank you for your interest" and "took the time to apply" are the
  // phrasings real auto-acknowledgements use, and they were missing before.
  if (/application (received|submitted|(?:is|has been|was) sent)|successfully submitted|received your application|thank(?:s| you) for (?:applying|your application|your interest)|thanks for applying|took the time to apply|glad you applied|we(?:'ve| have)? received your|permohonan.*diterima/i.test(text)) return 'Applied';
  // A future-tense promise ("a recruiter will reach out to discuss next steps")
  // is boilerplate in nearly every auto-acknowledgement, not a reply. Without
  // this guard it matched the bare "reach out" and turned acknowledgements into
  // 'Replied'.
  if (!/will\s+reach out/i.test(text) && /reach out|confirmation/i.test(text)) return 'Replied';
  return '';
}

export function isApplicationEmail(subject: string, body: string, from = ''): boolean {
  const text = subject + '\n' + body;
  if (/(?:loan|credit card|visa|scholarship|mortgage|membership) application/i.test(subject)) return false;
  // Pure "viewed/received" notices are noise — discard. Exception: when the
  // email also carries a real signal (interview, offer, rejection, a next
  // step or a decision), it is worth keeping.
  if (/(?:has viewed|(?:'ve|ve|have) received) your application/i.test(text) &&
    !/interview|offer|invit(?:e|ing)|regret|unsuccessful|not (?:be )?moving forward|to proceed further|is unlikely to progress further/i.test(text)) return false;
  // Pure auto-acknowledgements: a thanks/glad phrase paired with a
  // "we will follow up" boilerplate and no other signal is noise. Covers
  // Workday/UOB ("glad you took the time to apply... will reach out"),
  // SD Guthrie ("track your job application progress", "not monitored"),
  // and the classic "we will contact you" acknowledgements.
  if (/(?:thanks for applying|thank you for your interest|thank you for your application|took the time to apply|glad you applied)/i.test(text) &&
    /we will contact you|(?:'ll|will) reach out|track your job application progress|this email box is not monitored|please do not reply/i.test(text) &&
    !/interview|offer|invit(?:e|ing)|regret|unsuccessful|not (?:be )?moving forward|to proceed further|is unlikely to progress further/i.test(text)) return false;
  // Conditional promises of a future chat/interview are acknowledgements, not
  // invites: "if we feel you are a good fit, we'll reach out" (Citi), "will be
  // sending you an invitation... should there be a good fit" (Maxis).
  if (/(?:if we feel you are|if your profile is) a good fit|should there be a good fit/i.test(text) &&
    !/pleased to offer|offer of employment|regret.{0,80}(?:inform|unsuccessful)|unsuccessful|not (?:be )?moving forward|to proceed further|is unlikely to progress further/i.test(text)) return false;
  // Affiliate/marketing programmes are not job applications (Shopee Affiliate).
  if (/\baffiliate\b.{0,40}\b(?:program|approved)\b/i.test(text)) return false;
  // "Only shortlisted candidates will be contacted" — a "don't expect
  // updates" auto-ack (e.g. FSTEP). Discarded unless it also carries a real
  // decision signal.
  if (/only shortlisted candidates will be contacted/i.test(text) &&
    !/pleased to offer|offer of employment|regret.{0,80}(?:inform|unsuccessful)|unsuccessful|not (?:be )?moving forward|to proceed further|is unlikely to progress further/i.test(text)) return false;
  // Mass/event invitations are not application emails: Aviation Career
  // Malaysia campaigns and PERKESO's Lindung Kerjaya programme invites.
  if (/aviationcareermalaysia|yegmy\.com/i.test(from) ||
    (/(?:kerjaya|industri) penerbangan/i.test(text) && /tanpa pengalaman|pilih lokasi/i.test(text)) ||
    /program lindung kerjaya|pelbagai majikan daripada pelbagai sektor/i.test(text)) return false;
  // Indeed Apply submission confirmations.
  if (/indeedapply|apply\.indeed\.com/i.test(from) && /has been submitted/i.test(text)) return false;
  // NOTE: JobStreet/Indeed "successfully submitted" auto-confirmations used to
  // be filtered here as noise. That decision was reversed (2026-09-23): they
  // now classify as Applied, so they must pass this filter.
  if (/new invitations?|invited you to connect|see who reached out|job alerts?|jobs (?:for you|you may)|recommended jobs|recommended for you|jobs? matching|top job picks|who(?:'s| has) viewed|grow your network|try premium|interview tips|how to .{0,30}interview|newsletter|oauth verification|verification request|kempen|bonanza|promosi|diskaun|jom sertai/i.test(subject)) return false;
  if (/apply now|browse jobs|jobs you may be interested in|recommended jobs|try premium|see who reached out|oauth verification|verification request|reviewed your application|your application code|install the .{0,60}sdk|sdk and move|kempen|bonanza|promosi|diskaun|jom sertai|permohonan (?:pinjaman|pembiayaan|kredit|perumahan)/i.test(text) && !/received your application|thank(?:s| you) for applying|application (?:was |has been )?(?:submitted|received|sent)|regret.{0,80}(?:inform|application)|pleased to offer you|invit(?:e|ing) you.{0,60}interview/i.test(text)) return false;
  return /(?:your|the) application|application (received|submitted|update|status)|received your application|thank(?:s| you) for applying|applied for|interview (?:invitation|confirmation|scheduled|update|result)|invit(?:e|ing) you.{0,60}interview|interview for|pleased to offer you|offer of employment|your (?:job|employment) offer|(?:job|employment) offer\s*[:–—-]|permohonan|temu duga|temuduga|tawaran (?:jawatan|pekerjaan)|to proceed further/i.test(text);
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
    // JobStreet expiry notice: "the X job you applied for at Y has expired and
    // is no longer taking applications." Role sits between "the" and "job you
    // applied", company between "at" and "has expired/closed". JobStreet bodies
    // carry Windows \r\n line endings, so captures use [\s\S] and a greeting
    // strip removes the leading "Hi Aidil, " without banning commas in roles.
    const expiredPair = text.match(/(?:the\s+)?([\s\S]+?)\s+job you applied\s*(?:for|to)\s+at\s+([\s\S]+?)\s+(?:has\s+)?(?:expired|closed)/i);
    if (expiredPair) {
      role ||= clean(expiredPair[1]).replace(/^(?:hi|hai|dear|hello|hey|salam)\s+[^,]+,\s*/i, '').replace(/^the\s+/i, '');
      company ||= clean(expiredPair[2]);
    }
    // Fallback for expiry shapes without "job you applied": any "at X has
    // expired/closed" names the company. Skipped when the capture contains
    // another standalone "at" (we matched too early) or looks like a
    // programme/possessive phrase rather than an employer.
    const expiredAt = text.match(/\bat\s+([\s\S]+?)\s+(?:has\s+)?(?:expired|closed)\b/i);
    if (expiredAt) {
      const name = clean(expiredAt[1]);
      if (!/\bat\b|^(?:our|your|their|my|his|her)\s+|\b(?:program|programme|position|role|opportunity)\b/i.test(name)) company ||= name;
    }
    const submitted = text.match(/(?:application (?:was |has been )?(?:sent|submitted) to|your application (?:to|at)|thank(?:s| you) for applying (?:to|at))\s+(.+?)(?=[.!?\n]|\s[|–—]|\s+for\s+(?:the\s+)?|$)/i);
    if (submitted) {
      const submittedName = clean(submitted[1]);
      // "thank you for applying to our graduate program" names a programme,
      // not an employer. Reject possessive-led, programme-shaped or
      // over-captured ("... has expired") values so the company field stays
      // empty and the LLM fallback can try.
      if (!/^(?:our|your|their|my|his|her)\s+|\b(?:program|programme|position|role|opportunity)\b|\bhas\s+(?:expired|closed)\b/i.test(submittedName)) company ||= submittedName;
    }
    // LinkedIn confirmation: "Your application was sent to <Company>" and the
    // FIRST following non-empty line is the role. Additive — runs after the
    // patterns above and only fills fields that are still empty.
    const linkedinSent = text.match(/(?:your\s+)?application was sent to\s+([^\r\n]+)/i);
    if (linkedinSent) {
      company ||= clean(linkedinSent[1]);
      const after = text.slice((linkedinSent.index ?? 0) + linkedinSent[0].length).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      role ||= clean(after[0] ?? '');
    }
    // JobStreet submission notice: "your application for <Role> was (successfully)
    // submitted to <Company>". Role sits between "application for" and "was";
    // company is the rest of the line after "submitted to".
    const applicationFor = text.match(/your application for\s+([\s\S]+?)\s+was\b/i);
    if (applicationFor) role ||= clean(applicationFor[1]);
    const submittedTo = text.match(/was\s+(?:successfully\s+)?submitted to\s+([^\r\n]+)/i);
    if (submittedTo) {
      const name = clean(submittedTo[1]);
      if (!/^(?:our|your|their|my|his|her)\s+|\b(?:program|programme|position|role|opportunity)\b/i.test(name)) company ||= name;
    }
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
