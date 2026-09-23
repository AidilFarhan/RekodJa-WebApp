export type Stage = 'Applied' | 'Interview' | 'Offer' | 'Rejected' | 'Ghosted' | 'Withdrawn' | 'Replied';

import { extractEmailDetails, isApplicationEmail, recruiterRequestPhrase } from './gmail/scan-core.ts';

export type DashboardApplication = {
  id: string;
  company: string;
  role: string;
  stage: Stage;
  date_applied: string | null;
  source: string;
  job_url: string;
};

export type DashboardEvent = {
  id: string;
  application_id: string;
  event_status: 'detected' | 'user_confirmed';
  event_type: 'stage_observation' | 'stage_change' | 'employer_response' | 'follow_up_completed';
  from_stage: Stage | null;
  to_stage: Stage | null;
  source: string;
  occurred_at: string;
};

export const stages: Stage[] = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn', 'Replied'];

export function filterApplications(applications: DashboardApplication[], stage: string, source: string) {
  return applications.filter((application) =>
    (stage === 'All stages' || application.stage === stage) &&
    (source === 'All sources' || application.source === source),
  );
}

export function overviewMetrics(applications: DashboardApplication[], events: DashboardEvent[]) {
  const confirmed = events.filter((event) => event.event_status === 'user_confirmed');
  const historyFor = (id: string) => confirmed.filter((event) => event.application_id === id);
  const isWithdrawal = (event: DashboardEvent) => event.event_type === 'stage_change' && event.to_stage === 'Withdrawn';
  const isResponse = (event: DashboardEvent) => event.event_type === 'employer_response';
  const eligible = applications.filter((application) => {
    if (!application.date_applied) return false;
    const history = historyFor(application.id);
    const withdrawals = history.filter(isWithdrawal);
    if (!withdrawals.length) return application.stage !== 'Withdrawn';
    const firstWithdrawal = Math.min(...withdrawals.map((event) => Date.parse(event.occurred_at)));
    return history.some((event) => isResponse(event) && Date.parse(event.occurred_at) <= firstWithdrawal);
  });
  const reached = (id: string, stage: Stage) => historyFor(id).some((event) => event.event_type === 'stage_change' && event.to_stage === stage);
  const responses = eligible.filter((application) => historyFor(application.id).some(isResponse)).length;
  const interviews = eligible.filter((application) => reached(application.id, 'Interview')).length;
  const offers = eligible.filter((application) => reached(application.id, 'Offer')).length;
  const rate = (count: number) => (eligible.length ? Math.round((count / eligible.length) * 100) : 0);
  return {
    applications: applications.length,
    eligible: eligible.length,
    responses,
    interviews,
    offers,
    responseRate: rate(responses),
    interviewRate: rate(interviews),
    offerRate: rate(offers),
  };
}

export function sourcesFor(applications: DashboardApplication[]) {
  return [...new Set(applications.map((application) => application.source).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function eventsForApplication(events: DashboardEvent[], applicationId: string) {
  return events.filter((event) => event.application_id === applicationId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

export function eventLabel(event: DashboardEvent) {
  if (event.event_type === 'employer_response') return 'Employer responded';
  if (event.event_type === 'follow_up_completed') return 'Follow-up completed';
  return event.to_stage ? `Stage changed to ${event.to_stage}` : 'Application event';
}

export const FOLLOW_UP_AFTER_DAYS = 7;

export function waitingDays(dateApplied: string | null, now: Date = new Date()) {
  if (!dateApplied) return 0;
  const appliedAt = new Date(dateApplied + 'T00:00:00Z').getTime();
  return Math.max(0, Math.floor((now.getTime() - appliedAt) / DAY_MS));
}

export function followUpActions(applications: DashboardApplication[], events: DashboardEvent[], now: Date = new Date()) {
  const responded = new Set(events.filter((event) => event.event_status === 'user_confirmed' && event.event_type === 'employer_response').map((event) => event.application_id));
  const followedUp = new Set(events.filter((event) => event.event_type === 'follow_up_completed').map((event) => event.application_id));
  const due: { applicationId: string; company: string; role: string; days: number }[] = [];
  for (const application of applications) {
    if (application.stage !== 'Applied' || !application.date_applied) continue;
    if (responded.has(application.id) || followedUp.has(application.id)) continue;
    const days = waitingDays(application.date_applied, now);
    if (days < FOLLOW_UP_AFTER_DAYS) continue;
    due.push({ applicationId: application.id, company: application.company, role: application.role, days });
  }
  return due.sort((a, b) => b.days - a.days);
}

export type AttentionType = 'review' | 'recruiter' | 'follow-up' | 'unmatched';

// The subset of a gmail_scan_candidates row the Action Center needs.
export type AttentionCandidate = {
  message_id: string;
  subject: string;
  sender_from: string;
  snippet: string;
  suggested_company: string;
  suggested_role: string;
  suggested_status: string;
  matched_application_id: string | null;
  review_state: 'pending' | 'confirmed' | 'dismissed';
  internal_date_ms: number;
};

export type AttentionItem = {
  type: AttentionType;
  applicationId: string | null;
  company: string | null;
  role: string | null;
  title: string;
  days: number | null;
  // Candidate-only fields. Null on follow-up items, which come from applications.
  messageId: string | null;
  stage: string | null;
  snippet: string | null;
  sender: string | null;
  // Recency of the trigger: the email's date for candidate items, null for
  // follow-ups (which carry `days` instead). Lets one sort control order a
  // list that mixes both kinds.
  internal_date_ms: number | null;
};

// Tab labels in display order, paired with the item type each one shows.
export const ATTENTION_TABS: { label: string; type: AttentionType }[] = [
  { label: 'Needs Review', type: 'review' },
  { label: 'Follow-ups', type: 'follow-up' },
  { label: 'Recruiter Actions', type: 'recruiter' },
  { label: 'Unmatched Emails', type: 'unmatched' },
];

/*
 * Bucket rules for a Gmail candidate.
 *
 * Unmatched is decided FIRST: an email belongs there only when it has no
 * application bound to it AND the scanner could not identify both company and
 * role. Once company and role are detected the email is understood even
 * without an application row, so it surfaces as a review or recruiter action.
 * (DESIGN-ACTION-CENTER.md OD1, refined 2026-09-23 from user feedback.)
 *
 * The remaining split: an employer-response stage is a decision the user must
 * act on (recruiter); everything else needs a look (review).
 *
 * This mapping is a pure function, so changing the rule is a one-line edit
 * here. Nothing is stored, so there is no migration and no Gmail re-scan.
 */

/*
 * Effective company/role for display AND bucketing. Rows scanned before newer
 * extraction rules may store empty fields even though the stored snippet
 * contains both — re-extract from the stored text so the Action Center
 * self-heals without a rescan.
 */
export function effectiveCandidateFields(candidate: AttentionCandidate): { company: string | null; role: string | null } {
  const fallback = candidate.suggested_company && candidate.suggested_role
    ? null
    : extractEmailDetails(candidate.subject, candidate.snippet, candidate.sender_from);
  return {
    company: candidate.suggested_company || fallback?.company || null,
    role: candidate.suggested_role || fallback?.role || null,
  };
}

export function attentionTypeForCandidate(candidate: AttentionCandidate): AttentionType {
  // Recruiter-request emails ("to proceed further, please...") go straight to
  // Recruiter Actions, before the unmatched check. Negated phrasings are
  // excluded inside the regex itself.
  if (recruiterRequestPhrase.test(candidate.snippet)) return 'recruiter';
  const { company, role } = effectiveCandidateFields(candidate);
  if (candidate.matched_application_id === null && !(company && role)) return 'unmatched';
  if (candidate.suggested_status === 'Offer' || candidate.suggested_status === 'Rejected' || candidate.suggested_status === 'Interview') return 'recruiter';
  return 'review';
}

/*
 * Needs Attention. Candidate items come from the Gmail scan queue; follow-ups
 * are derived from applications and events and are the only time-based type.
 *
 * `candidates` is the LAST parameter on purpose. Existing positional callers
 * pass `now` third (including tests/dashboard.test.mjs), so inserting a new
 * argument before it would silently turn that Date into a candidate array.
 * Both new parameters are optional, so every existing caller keeps working.
 */
/*
 * Candidates the noise rules would no longer accept. Old scans stored rows
 * before these rules existed; filtering at read time keeps them out of every
 * surface without a DB migration or manual dismissal.
 */
export function visibleCandidates(candidates: AttentionCandidate[]): AttentionCandidate[] {
  return candidates.filter((candidate) => isApplicationEmail(candidate.subject, candidate.snippet, candidate.sender_from));
}

export function attentionItems(
  applications: DashboardApplication[],
  events: DashboardEvent[],
  now: Date = new Date(),
  candidates: AttentionCandidate[] = [],
): AttentionItem[] {
  const pending = visibleCandidates(candidates).filter((candidate) => candidate.review_state === 'pending');

  const fromCandidates = (type: AttentionType) => pending
    .filter((candidate) => attentionTypeForCandidate(candidate) === type)
    .sort((a, b) => b.internal_date_ms - a.internal_date_ms)
    .map((candidate): AttentionItem => {
      const effective = effectiveCandidateFields(candidate);
      return {
      type,
      applicationId: candidate.matched_application_id,
      company: effective.company,
      role: effective.role,
      title: candidate.subject || '(No subject)',
      days: null,
      messageId: candidate.message_id,
      stage: candidate.suggested_status || null,
      snippet: candidate.snippet,
      sender: candidate.sender_from,
      internal_date_ms: candidate.internal_date_ms,
    };
    });

  const followUps: AttentionItem[] = followUpActions(applications, events, now).map((action) => ({
    type: 'follow-up',
    applicationId: action.applicationId,
    company: action.company,
    role: action.role,
    title: `No response for ${action.days} days`,
    days: action.days,
    messageId: null,
    stage: null,
    snippet: null,
    sender: null,
    internal_date_ms: null,
  }));

  return [
    ...fromCandidates('review'),
    ...fromCandidates('recruiter'),
    ...followUps,
    ...fromCandidates('unmatched'),
  ];
}

export function pipelineCounts(applications: DashboardApplication[]) {
  return stages.map((stage) => ({ stage, count: applications.filter((application) => application.stage === stage).length }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function weeklyBuckets(applications: DashboardApplication[]) {
  const dates = applications.map((application) => application.date_applied).filter((value): value is string => !!value).sort();
  const latest = dates.length ? new Date(dates[dates.length - 1] + 'T00:00:00Z') : new Date();
  const buckets: { start: string; end: string; count: number }[] = [];
  for (let index = 4; index >= 0; index -= 1) {
    const end = new Date(latest.getTime() - index * 7 * DAY_MS);
    const start = new Date(end.getTime() - 6 * DAY_MS);
    const startKey = start.toISOString().slice(0, 10);
    const endKey = end.toISOString().slice(0, 10);
    buckets.push({
      start: startKey,
      end: endKey,
      count: applications.filter((application) => application.date_applied && application.date_applied >= startKey && application.date_applied <= endKey).length,
    });
  }
  return buckets;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function bucketLabel(start: string, end: string) {
  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  const fmt = (value: Date) => `${value.getUTCDate()} ${MONTHS_SHORT[value.getUTCMonth()]}`;
  return startDate.getUTCMonth() === endDate.getUTCMonth()
    ? `${startDate.getUTCDate()}–${fmt(endDate)}`
    : `${fmt(startDate)}–${fmt(endDate)}`;
}

export function sourcePerformance(applications: DashboardApplication[], events: DashboardEvent[]) {
  return sourcesFor(applications).map((source) => {
    const subset = applications.filter((application) => application.source === source);
    const subsetIds = new Set(subset.map((application) => application.id));
    const subsetEvents = events.filter((event) => subsetIds.has(event.application_id));
    return { source, ...overviewMetrics(subset, subsetEvents) };
  });
}
