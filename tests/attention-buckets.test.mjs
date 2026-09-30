import { test } from 'node:test';
import assert from 'node:assert/strict';

/*
 * Bucket rules for Gmail candidates, and the boundary between scan-derived
 * items and time-derived follow-ups.
 *
 * Rule under test (DESIGN-ACTION-CENTER.md OD1):
 *   no app match AND no detected company+role -> unmatched (decided first)
 *   suggested_status Offer | Rejected | Interview -> recruiter
 *   anything else pending -> review
 *   non-pending (confirmed / dismissed) -> excluded entirely
 */

const module = await import('../src/lib/dashboard.ts');

const NOW = new Date('2026-09-20T00:00:00Z');

function candidate(overrides = {}) {
  return {
    message_id: `m-${Math.random().toString(36).slice(2, 8)}`,
    subject: 'Your application',
    sender_from: 'Acme Careers <jobs@acme.test>',
    snippet: 'body',
    suggested_company: 'Acme',
    suggested_role: 'Engineer',
    suggested_status: 'Applied',
    matched_application_id: 'app-1',
    review_state: 'pending',
    internal_date_ms: 1000,
    ...overrides,
  };
}

const apps = [{ id: 'app-1', company: 'Acme', role: 'Engineer', stage: 'Interview', date_applied: '2026-09-01', source: '', job_url: '' }];

function typesFor(candidates) {
  return module.attentionItems(apps, [], NOW, candidates).map((item) => item.type);
}

test('no app match and no detected company/role: unmatched, even with an Offer status', () => {
  const items = module.attentionItems(apps, [], NOW, [candidate({ matched_application_id: null, suggested_status: 'Offer', suggested_company: '', suggested_role: '' })]);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'unmatched');
});

test('detected company and role keep an application-less email out of unmatched', () => {
  assert.deepEqual(typesFor([candidate({ matched_application_id: null, suggested_status: 'Ghosted' })]), ['review']);
  assert.deepEqual(typesFor([candidate({ matched_application_id: null, suggested_status: 'Offer' })]), ['recruiter']);
  assert.deepEqual(typesFor([candidate({ matched_application_id: null, suggested_status: 'Rejected' })]), ['recruiter']);
});

test('company without a role still stays unmatched', () => {
  assert.deepEqual(typesFor([candidate({ matched_application_id: null, suggested_role: '' })]), ['unmatched']);
});

test('a "to proceed further" email goes straight to recruiter, even unmatched', () => {
  const items = module.attentionItems(apps, [], NOW, [candidate({
    matched_application_id: null,
    suggested_company: '',
    suggested_role: '',
    snippet: 'To proceed further with your application, please complete the online assessment.',
  })]);
  assert.equal(items[0].type, 'recruiter');
});

test('negated "not to proceed further" does not force recruiter', () => {
  assert.deepEqual(typesFor([candidate({ snippet: 'We are not to proceed further with your application.' })]), ['review']);
});

test('Offer, Rejected and Interview on a matched email go to recruiter', () => {
  assert.deepEqual(typesFor([candidate({ suggested_status: 'Offer' })]), ['recruiter']);
  assert.deepEqual(typesFor([candidate({ suggested_status: 'Rejected' })]), ['recruiter']);
  assert.deepEqual(typesFor([candidate({ suggested_status: 'Interview' })]), ['recruiter']);
});

test('observations go to review', () => {
  for (const status of ['Applied', 'Ghosted', 'Replied', '']) {
    assert.deepEqual(typesFor([candidate({ suggested_status: status })]), ['review'], `status ${status}`);
  }
});

test('confirmed and dismissed candidates are excluded', () => {
  assert.equal(typesFor([candidate({ review_state: 'confirmed' })]).length, 0);
});

test('stored rows matching the noise rules are hidden at read time', () => {
  const items = module.attentionItems(apps, [], NOW, [candidate({
    matched_application_id: null,
    subject: '',
    snippet: 'Ipsos Sdn Bhd has viewed your application for Research Trainee (Graduate Programme)',
    sender_from: 'Jobstreet Applications <noreply@e.jobstreet.com>',
  })]);
  assert.equal(items.length, 0);
});

test('a stale row with empty company/role self-heals from its snippet', () => {
  const items = module.attentionItems(apps, [], NOW, [candidate({
    matched_application_id: null,
    suggested_company: '',
    suggested_role: '',
    snippet: 'Hi Aidil Farhan, the NEXTGEN Graduate Associate job you applied for at HLMG\r\nManagement Co Sdn Bhd has expired and is no longer taking applications.',
  })]);
  assert.equal(items[0].company, 'HLMG Management Co Sdn Bhd');
  assert.equal(items[0].role, 'NEXTGEN Graduate Associate');
  assert.equal(items[0].type, 'review');
});

test('items within a bucket are newest first', () => {
  const items = module.attentionItems(apps, [], NOW, [
    candidate({ message_id: 'older', internal_date_ms: 100 }),
    candidate({ message_id: 'newer', internal_date_ms: 900 }),
  ]);
  assert.deepEqual(items.map((item) => item.messageId), ['newer', 'older']);
});

test('candidate items carry the fields the UI needs and follow-ups carry nulls', () => {
  const [scanItem] = module.attentionItems(apps, [], NOW, [candidate()]);
  assert.equal(scanItem.messageId.startsWith('m-'), true);
  assert.equal(scanItem.snippet, 'body');
  assert.equal(scanItem.sender, 'Acme Careers <jobs@acme.test>');
  assert.equal(scanItem.stage, 'Applied');

  // An old application with no response still yields a time-based follow-up.
  const followApps = [{ id: 'f', company: 'F', role: 'R', stage: 'Applied', date_applied: '2026-09-01', source: '', job_url: '' }];
  const [followItem] = module.attentionItems(followApps, [], NOW, []);
  assert.equal(followItem.type, 'follow-up');
  assert.equal(followItem.messageId, null);
  assert.equal(followItem.snippet, null);
  assert.equal(followItem.sender, null);
});

test('existing two-argument callers still work (backward compatibility)', () => {
  // Guards the parameter order: `now` must stay third, or this Date becomes a
  // candidate array and the call throws.
  const followApps = [{ id: 'f', company: 'F', role: 'R', stage: 'Applied', date_applied: '2026-09-01', source: '', job_url: '' }];
  const items = module.attentionItems(followApps, [], NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0].type, 'follow-up');
});

test('bucket order in the returned array is review, recruiter, follow-up, unmatched', () => {
  const followApps = [{ id: 'f', company: 'F', role: 'R', stage: 'Applied', date_applied: '2026-09-01', source: '', job_url: '' }];
  const items = module.attentionItems(followApps, [], NOW, [
    candidate({ message_id: 'u', matched_application_id: null, suggested_company: '', suggested_role: '' }),
    candidate({ message_id: 'r', suggested_status: 'Offer' }),
    candidate({ message_id: 'v', suggested_status: 'Applied' }),
  ]);
  assert.deepEqual(items.map((item) => item.type), ['review', 'recruiter', 'follow-up', 'unmatched']);
});
