import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { scanGmail, scanTiming } from '../src/lib/gmail/scan-engine.ts';

const email = 'user@example.com';

function response(body, { ok = true, status = 200, retryAfter = null } = {}) {
  return {
    ok, status,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const profile = { emailAddress: email };
const emptyPage = { messages: [], nextPageToken: undefined };

function applicationMessage(id, threadId, internalDate, subject, bodyText, labelIds = ['INBOX']) {
  const encoded = Buffer.from(bodyText, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  return {
    id, threadId, internalDate, labelIds,
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: 'Acme Careers <recruiter@acme.com>' },
      ],
      body: { data: encoded },
    },
  };
}

const applications = [{ id: 'app-1', company: 'Acme', role: 'Engineer', job_url: '' }];

before(() => {
  scanTiming.paceMs = 0;
  scanTiming.backoffBaseMs = 10;
});
after(() => {
  scanTiming.paceMs = 500;
  scanTiming.backoffBaseMs = 5000;
});

test('scans, classifies and matches an application email', async () => {
  const responses = [
    ['https://gmail.googleapis.com/gmail/v1/users/me/profile', profile],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50', { messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: undefined }],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages/m1', applicationMessage('m1', 't1', '1789430400000', 'Thank you for applying', 'Thank you for applying for the Engineer role at Acme. Unfortunately we are not moving forward.')],
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const found = responses.find(([prefix]) => String(url).startsWith(prefix));
    assert.ok(found, 'unexpected request: ' + url);
    return response(found[1]);
  };
  try {
    const result = await scanGmail('token', applications, email);
    assert.equal(result.scanned, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.candidates.length, 1);
    const candidate = result.candidates[0];
    assert.equal(candidate.suggested.company, 'Acme');
    assert.equal(candidate.suggested.role, 'Engineer');
    assert.equal(candidate.suggested.status, 'Rejected');
    assert.equal(candidate.sender, 'recruiter@acme.com');
    assert.equal(candidate.match?.applicationId, 'app-1');
    assert.equal(candidate.eventType, 'employer_response');
  } finally { globalThis.fetch = originalFetch; }
});

test('skips non-application and sent emails', async () => {
  const responses = [
    ['https://gmail.googleapis.com/gmail/v1/users/me/profile', profile],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50', { messages: [{ id: 's1', threadId: 't1' }, { id: 'p1', threadId: 't2' }], nextPageToken: undefined }],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages/s1', applicationMessage('s1', 't1', '100', 'My application', 'My application was sent yesterday.', ['SENT'])],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages/p1', applicationMessage('p1', 't2', '200', 'Jobs you may like', 'Recommended jobs for you. Try Premium.')],
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const found = responses.find(([prefix]) => String(url).startsWith(prefix));
    assert.ok(found, 'unexpected request: ' + url);
    return response(found[1]);
  };
  try {
    const result = await scanGmail('token', applications, email);
    assert.equal(result.scanned, 2);
    assert.equal(result.skipped, 2);
    assert.equal(result.candidates.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('keeps only the latest message per thread', async () => {
  const responses = [
    ['https://gmail.googleapis.com/gmail/v1/users/me/profile', profile],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50', { messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't1' }], nextPageToken: undefined }],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages/m1', applicationMessage('m1', 't1', '1000', 'Thank you for applying', 'Thank you for applying for the Engineer role at Acme.')],
    ['https://gmail.googleapis.com/gmail/v1/users/me/messages/m2', applicationMessage('m2', 't1', '2000', 'Your application update', 'Your application status has been updated.')],
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const found = responses.find(([prefix]) => String(url).startsWith(prefix));
    assert.ok(found, 'unexpected request: ' + url);
    return response(found[1]);
  };
  try {
    const result = await scanGmail('token', applications, email);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].messageId, 'm2');
  } finally { globalThis.fetch = originalFetch; }
});

test('retries a rate-limited list request and succeeds', async () => {
  let listCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/profile')) return response(profile);
    if (u.includes('/messages?')) {
      listCalls += 1;
      if (listCalls === 1) return response({ error: { message: 'Quota exceeded: Units per minute', errors: [{ reason: 'RATE_LIMIT_EXCEEDED' }] } }, { ok: false, status: 429, retryAfter: '0' });
      return response(emptyPage);
    }
    throw new Error('unexpected request: ' + u);
  };
  try {
    const result = await scanGmail('token', applications, email);
    assert.equal(listCalls, 2);
    assert.equal(result.candidates.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});
