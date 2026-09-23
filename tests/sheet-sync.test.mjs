import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncDateAppliedToSheet, syncStageToSheet } from '../src/lib/sheets/sync.ts';
import { rowIdentityKey } from '../src/lib/sheets/import.ts';

const headers = ['Date Applied', 'Company', 'Role', 'Job Link', 'Status', 'Source', 'Days Since Applied'];

function sheetResponse(values) {
  return { ok: true, json: async () => ({ values }) };
}

function writeResponse() {
  return { ok: true, json: async () => ({}) };
}

test('writes the new stage into the matching row status cell', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options?.method === 'PUT') return writeResponse();
    return sheetResponse([headers, ['2026-09-01', 'Acme', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn', '16']]);
  };
  try {
    const result = await syncStageToSheet({
      token: 'token', spreadsheetId: 'sheet-1', sheetName: 'Applications',
      importKey: null, company: 'Acme', role: 'Engineer', dateApplied: '2026-09-01', jobUrl: 'https://example.com/job', stage: 'Rejected',
    });
    assert.equal(result.synced, true);
    assert.equal(result.row, 2);
    const write = calls.find((call) => call.options?.method === 'PUT');
    assert.ok(write, 'expected a PUT write');
    assert.match(decodeURIComponent(write.url), /'Applications'!E2\?/);
    assert.match(write.url, /valueInputOption=USER_ENTERED/);
    assert.deepEqual(JSON.parse(write.options.body), { values: [['Rejected']] });
  } finally { globalThis.fetch = originalFetch; }
});

test('writes the new date into the existing matching row without appending', async () => {
  const calls = [];
  const key = rowIdentityKey({ spreadsheetId: 'sheet-1', sheetName: 'Applications', company: 'Acme', role: 'Engineer', dateApplied: '2026-09-01', jobUrl: 'https://example.com/job' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (options?.method === 'PUT') return writeResponse();
    return sheetResponse([headers, ['2026-09-01', 'Acme', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn', '16']]);
  };
  try {
    const result = await syncDateAppliedToSheet({
      token: 'token', spreadsheetId: 'sheet-1', sheetName: 'Applications', importKey: key,
      company: 'Acme', role: 'Engineer', currentDateApplied: '2026-09-01', jobUrl: 'https://example.com/job', nextDateApplied: '2026-10-09',
    });
    assert.equal(result.synced, true);
    assert.equal(result.row, 2);
    const write = calls.find((call) => call.options?.method === 'PUT');
    assert.ok(write, 'expected a PUT write');
    assert.match(decodeURIComponent(write.url), /'Applications'!A2\?/);
    assert.doesNotMatch(write.url, /append/);
    assert.deepEqual(JSON.parse(write.options.body), { values: [['2026-10-09']] });
  } finally { globalThis.fetch = originalFetch; }
});

test('matches by import key even when the stored job URL differs', async () => {
  const key = rowIdentityKey({ spreadsheetId: 'sheet-1', sheetName: 'Applications', company: 'Acme', role: 'Engineer', dateApplied: '2026-09-01', jobUrl: 'https://example.com/job' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') return writeResponse();
    return sheetResponse([headers, ['2026-09-01', 'Acme', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn', '']]);
  };
  try {
    const result = await syncStageToSheet({
      token: 't', spreadsheetId: 'sheet-1', sheetName: 'Applications',
      importKey: key, company: 'Acme', role: 'Engineer', dateApplied: '2026-09-01', jobUrl: 'https://changed.example.com/job', stage: 'Offer',
    });
    assert.equal(result.synced, true);
    assert.equal(result.row, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test('reports not found and writes nothing when no row matches', async () => {
  const originalFetch = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'PUT') { writes += 1; return writeResponse(); }
    return sheetResponse([headers, ['2026-09-01', 'Other', 'Designer', 'https://example.com/job2', 'Applied', 'Indeed', '1']]);
  };
  try {
    const result = await syncStageToSheet({
      token: 't', spreadsheetId: 'sheet-1', sheetName: 'Applications',
      importKey: null, company: 'Acme', role: 'Engineer', dateApplied: '2026-09-01', jobUrl: 'https://example.com/job', stage: 'Rejected',
    });
    assert.equal(result.synced, false);
    assert.equal(result.row, null);
    assert.equal(writes, 0);
    assert.match(result.message, /no longer matches/);
  } finally { globalThis.fetch = originalFetch; }
});

test('rejects sheets without a status column', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sheetResponse([['Date Applied', 'Company', 'Role', 'Job Link', 'Source']]);
  try {
    await assert.rejects(
      syncStageToSheet({
        token: 't', spreadsheetId: 'sheet-1', sheetName: 'Applications',
        importKey: null, company: 'Acme', role: 'Engineer', dateApplied: null, jobUrl: '', stage: 'Rejected',
      }),
      /no Status column/,
    );
  } finally { globalThis.fetch = originalFetch; }
});
