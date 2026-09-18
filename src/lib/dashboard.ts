export type Stage = 'Applied' | 'Interview' | 'Offer' | 'Rejected' | 'Ghosted' | 'Withdrawn';

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

export const stages: Stage[] = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn'];

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

export type AttentionItem = {
  type: AttentionType;
  applicationId: string | null;
  company: string | null;
  role: string | null;
  title: string;
  days: number | null;
};

// Needs Attention priority: review email → recruiter actions → follow-ups → unmatched email.
// Review, recruiter and unmatched items come from Gmail detections (v2) and are
// prepended once that data exists; follow-ups are the only type derived today.
export function attentionItems(applications: DashboardApplication[], events: DashboardEvent[], now: Date = new Date()): AttentionItem[] {
  const reviews: AttentionItem[] = [];
  const recruiters: AttentionItem[] = [];
  const followUps: AttentionItem[] = followUpActions(applications, events, now).map((action) => ({
    type: 'follow-up',
    applicationId: action.applicationId,
    company: action.company,
    role: action.role,
    title: `No response for ${action.days} days`,
    days: action.days,
  }));
  const unmatched: AttentionItem[] = [];
  return [...reviews, ...recruiters, ...followUps, ...unmatched];
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
