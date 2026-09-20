import test from 'node:test';
import assert from 'node:assert/strict';
const apps = [
  { id: 'a', company: 'A', role: 'Engineer', stage: 'Rejected', date_applied: '2026-01-01', source: 'LinkedIn', job_url: '' },
  { id: 'b', company: 'B', role: 'Designer', stage: 'Offer', date_applied: '2026-01-02', source: 'Referral', job_url: '' },
  { id: 'c', company: 'C', role: 'PM', stage: 'Applied', date_applied: '2026-01-03', source: 'LinkedIn', job_url: '' },
];
const events = [
  { id: '1', application_id: 'a', event_status: 'user_confirmed', event_type: 'stage_change', from_stage: 'Interview', to_stage: 'Rejected', source: 'sheet', occurred_at: '2026-01-04' },
  { id: '2', application_id: 'a', event_status: 'user_confirmed', event_type: 'stage_change', from_stage: 'Applied', to_stage: 'Interview', source: 'sheet', occurred_at: '2026-01-03' },
  { id: '3', application_id: 'b', event_status: 'user_confirmed', event_type: 'stage_change', from_stage: 'Interview', to_stage: 'Offer', source: 'sheet', occurred_at: '2026-01-03' },
  { id: '4', application_id: 'c', event_status: 'detected', event_type: 'stage_observation', from_stage: 'Applied', to_stage: 'Interview', source: 'email', occurred_at: '2026-01-03' },
];
test('filters by stage and source', async () => { const module = await import('../src/lib/dashboard.ts'); assert.deepEqual(module.filterApplications(apps, 'Rejected', 'All sources').map((a) => a.id), ['a']); assert.deepEqual(module.filterApplications(apps, 'All stages', 'LinkedIn').map((a) => a.id), ['a', 'c']); });
test('metrics use confirmed historical stage events', async () => { const module = await import('../src/lib/dashboard.ts'); assert.deepEqual(module.overviewMetrics(apps, events), { applications: 3, eligible: 3, responses: 0, interviews: 1, offers: 1, responseRate: 0, interviewRate: 33, offerRate: 33 }); });

test('metrics use the prototype eligibility rules', async () => {
  const module = await import('../src/lib/dashboard.ts');
  const allApps = [...apps,
    { id: 'd', company: 'D', role: 'Analyst', stage: 'Withdrawn', date_applied: '2026-01-04', source: 'Referral', job_url: '' },
    { id: 'e', company: 'E', role: 'Analyst', stage: 'Withdrawn', date_applied: '2026-01-05', source: 'Referral', job_url: '' },
  ];
  const allEvents = [...events,
    { id: '5', application_id: 'd', event_status: 'user_confirmed', event_type: 'employer_response', from_stage: null, to_stage: null, source: 'sheet', occurred_at: '2026-01-05' },
    { id: '6', application_id: 'd', event_status: 'user_confirmed', event_type: 'stage_change', from_stage: 'Applied', to_stage: 'Withdrawn', source: 'sheet', occurred_at: '2026-01-06' },
    { id: '7', application_id: 'e', event_status: 'user_confirmed', event_type: 'stage_change', from_stage: 'Applied', to_stage: 'Withdrawn', source: 'sheet', occurred_at: '2026-01-02' },
    { id: '8', application_id: 'e', event_status: 'user_confirmed', event_type: 'employer_response', from_stage: null, to_stage: null, source: 'sheet', occurred_at: '2026-01-03' },
  ];
  assert.deepEqual(module.overviewMetrics(allApps, allEvents), { applications: 5, eligible: 4, responses: 1, interviews: 1, offers: 1, responseRate: 25, interviewRate: 25, offerRate: 25 });
});
test('timeline is scoped and newest first', async () => { const module = await import('../src/lib/dashboard.ts'); assert.deepEqual(module.eventsForApplication(events, 'a').map((event) => event.id), ['1', '2']); });

test('analytics helpers: buckets, pipeline and source performance', async () => {
  const module = await import('../src/lib/dashboard.ts');
  const analyticsApps = [
    { id: 'a', company: 'A', role: 'Engineer', stage: 'Interview', date_applied: '2026-09-01', source: 'LinkedIn', job_url: '' },
    { id: 'b', company: 'B', role: 'Designer', stage: 'Applied', date_applied: '2026-09-18', source: 'LinkedIn', job_url: '' },
    { id: 'c', company: 'C', role: 'PM', stage: 'Applied', date_applied: '2026-09-18', source: 'Referral', job_url: '' },
  ];
  const analyticsEvents = [
    { id: '1', application_id: 'a', event_status: 'user_confirmed', event_type: 'stage_change', from_stage: 'Applied', to_stage: 'Interview', source: 'sheet', occurred_at: '2026-09-02' },
  ];
  const buckets = module.weeklyBuckets(analyticsApps);
  assert.equal(buckets.length, 5);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), 3);
  assert.equal(buckets[4].end, '2026-09-18');
  assert.equal(module.bucketLabel('2026-08-12', '2026-08-18'), '12–18 Aug');
  assert.equal(module.bucketLabel('2026-08-26', '2026-09-01'), '26 Aug–1 Sep');
  assert.deepEqual(module.pipelineCounts(analyticsApps), [
    { stage: 'Applied', count: 2 }, { stage: 'Interview', count: 1 },
    { stage: 'Offer', count: 0 }, { stage: 'Rejected', count: 0 },
    { stage: 'Ghosted', count: 0 }, { stage: 'Withdrawn', count: 0 },
    { stage: 'Replied', count: 0 },
  ]);
  const performance = module.sourcePerformance(analyticsApps, analyticsEvents);
  assert.equal(performance.length, 2);
  assert.deepEqual(performance.find((row) => row.source === 'LinkedIn'), { source: 'LinkedIn', applications: 2, eligible: 2, responses: 0, interviews: 1, offers: 0, responseRate: 0, interviewRate: 50, offerRate: 0 });
});

test('follow-up actions derive from real history', async () => {
  const module = await import('../src/lib/dashboard.ts');
  const now = new Date('2026-09-20T00:00:00Z');
  const followApps = [
    { id: 'a', company: 'A', role: 'Engineer', stage: 'Applied', date_applied: '2026-09-01', source: '', job_url: '' },
    { id: 'b', company: 'B', role: 'Designer', stage: 'Applied', date_applied: '2026-09-19', source: '', job_url: '' },
    { id: 'c', company: 'C', role: 'PM', stage: 'Applied', date_applied: '2026-08-20', source: '', job_url: '' },
    { id: 'd', company: 'D', role: 'Analyst', stage: 'Interview', date_applied: '2026-08-20', source: '', job_url: '' },
  ];
  const followEvents = [
    { id: '1', application_id: 'c', event_status: 'user_confirmed', event_type: 'employer_response', from_stage: null, to_stage: null, source: '', occurred_at: '2026-08-25' },
  ];
  const actions = module.followUpActions(followApps, followEvents, now);
  assert.deepEqual(actions.map((action) => action.applicationId), ['a']);
  assert.equal(actions[0].days, 19);
  const completed = [...followEvents, { id: '2', application_id: 'a', event_status: 'user_confirmed', event_type: 'follow_up_completed', from_stage: null, to_stage: null, source: '', occurred_at: '2026-09-19' }];
  assert.equal(module.followUpActions(followApps, completed, now).length, 0);
});

test('attention items order follow-ups within the priority order', async () => {
  const module = await import('../src/lib/dashboard.ts');
  const now = new Date('2026-09-20T00:00:00Z');
  const appsX = [
    { id: 'a', company: 'A', role: 'Engineer', stage: 'Applied', date_applied: '2026-09-01', source: '', job_url: '' },
    { id: 'b', company: 'B', role: 'Designer', stage: 'Applied', date_applied: '2026-09-05', source: '', job_url: '' },
  ];
  const items = module.attentionItems(appsX, [], now);
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.type === 'follow-up'));
  assert.deepEqual(items.map((item) => item.applicationId), ['a', 'b']);
  assert.equal(items[0].title, 'No response for 19 days');
});
