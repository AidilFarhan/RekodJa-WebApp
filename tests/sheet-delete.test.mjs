import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteSheetRow, locateApplicationRow, resolveApplicationRow } from '../src/lib/sheets/sync.ts';
import { rowIdentityKey } from '../src/lib/sheets/import.ts';

const headers = ['Date Applied', 'Company', 'Role', 'Job Link', 'Status', 'Source', 'Days Since Applied'];
const SPREADSHEET = 'sheet-1';
const TAB = 'Applications';
const TAB_ID = 918273645;

const row = (company, date = '2026-09-01', url = '') => [date, company, 'Engineer', url, 'Applied', 'LinkedIn', ''];

// The application record exactly as the import stored it for a sheet row.
function applicationFor(sheetRow) {
  const [date, company, role, url] = sheetRow;
  return {
    spreadsheetId: SPREADSHEET, sheetName: TAB, company, role, dateApplied: date, jobUrl: url,
    importKey: rowIdentityKey({ spreadsheetId: SPREADSHEET, sheetName: TAB, company, role, dateApplied: date, jobUrl: url }),
  };
}

/*
  In-memory stand-in for the Sheets API: answers the metadata and values reads
  and really applies deleteDimension, so rows shift like the real sheet.
*/
function fakeSheets(initialRows, { failBatch = false, tabs = [{ sheetId: 0, title: 'Other' }, { sheetId: TAB_ID, title: TAB }] } = {}) {
  const state = { rows: initialRows.map((values) => [...values]), batches: [] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (options.method === 'POST' && url.endsWith(':batchUpdate')) {
      const body = JSON.parse(options.body);
      state.batches.push(body);
      if (failBatch) return { ok: false, status: 403, text: async () => '{"error":{"code":403,"message":"The caller does not have permission"}}' };
      for (const request of body.requests) {
        const { sheetId, dimension, startIndex, endIndex } = request.deleteDimension.range;
        assert.equal(sheetId, TAB_ID);
        assert.equal(dimension, 'ROWS');
        state.rows.splice(startIndex, endIndex - startIndex);
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.includes('/values/')) return { ok: true, status: 200, json: async () => ({ values: state.rows.map((values) => [...values]) }) };
    if (url.includes('fields=')) return { ok: true, status: 200, json: async () => ({ sheets: tabs.map((properties) => ({ properties })) }) };
    throw new Error(`Unexpected request ${url}`);
  };
  state.restore = () => { globalThis.fetch = originalFetch; };
  return state;
}

async function deleteApplication(application) {
  const location = await locateApplicationRow({ token: 't', ...application });
  if (!location.ok) return location;
  const removal = await deleteSheetRow({ token: 't', spreadsheetId: SPREADSHEET, sheetId: location.sheetId, rowIndex: location.rowIndex });
  return removal.ok ? { ok: true, rowIndex: location.rowIndex } : removal;
}

const companies = (state) => state.rows.slice(1).map((values) => values[1]);

test('resolves the zero-based API index with the header offset', () => {
  const values = [headers, row('A'), row('B'), row('C')];
  // Sheet row 3 (1-based, header on row 1) is API index 2.
  assert.deepEqual(resolveApplicationRow(values, applicationFor(row('B'))), { status: 'found', rowIndex: 2 });
  assert.deepEqual(resolveApplicationRow(values, applicationFor(row('A'))), { status: 'found', rowIndex: 1 });
});

test('never resolves to the header row and skips blank rows', () => {
  const values = [headers, [], ['', ''], row('A')];
  assert.deepEqual(resolveApplicationRow(values, applicationFor(row('A'))), { status: 'found', rowIndex: 3 });
  assert.deepEqual(resolveApplicationRow([headers], applicationFor(row('A'))), { status: 'not_found' });
});

test('deletes B then D, re-resolving rows after they shift', async () => {
  const rows = [row('A'), row('B'), row('C'), row('D')];
  const state = fakeSheets([headers, ...rows]);
  try {
    const first = await deleteApplication(applicationFor(rows[1]));
    assert.deepEqual(first, { ok: true, rowIndex: 2 });
    assert.deepEqual(companies(state), ['A', 'C', 'D']);
    // D was sheet row 5 when the page loaded; it is row 4 now.
    const second = await deleteApplication(applicationFor(rows[3]));
    assert.deepEqual(second, { ok: true, rowIndex: 3 });
    assert.deepEqual(companies(state), ['A', 'C']);
    assert.deepEqual(state.rows[0], headers);
  } finally { state.restore(); }
});

test('deletes the first and the last application', async () => {
  const rows = [row('A'), row('B'), row('C')];
  const state = fakeSheets([headers, ...rows]);
  try {
    assert.equal((await deleteApplication(applicationFor(rows[0]))).ok, true);
    assert.deepEqual(companies(state), ['B', 'C']);
    assert.equal((await deleteApplication(applicationFor(rows[2]))).ok, true);
    assert.deepEqual(companies(state), ['B']);
  } finally { state.restore(); }
});

test('sends exactly one deleteDimension for one row on the tab id, not the spreadsheet id', async () => {
  const rows = [row('A'), row('B')];
  const state = fakeSheets([headers, ...rows]);
  try {
    await deleteApplication(applicationFor(rows[1]));
    assert.equal(state.batches.length, 1);
    assert.deepEqual(state.batches[0], { requests: [{ deleteDimension: { range: { sheetId: TAB_ID, dimension: 'ROWS', startIndex: 2, endIndex: 3 } } }] });
  } finally { state.restore(); }
});

test('a repeated delete finds nothing and removes no other row', async () => {
  const rows = [row('A'), row('B'), row('C')];
  const state = fakeSheets([headers, ...rows]);
  try {
    assert.equal((await deleteApplication(applicationFor(rows[1]))).ok, true);
    const again = await deleteApplication(applicationFor(rows[1]));
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'not_found');
    assert.deepEqual(companies(state), ['A', 'C']);
    assert.equal(state.batches.length, 1);
  } finally { state.restore(); }
});

test('an unknown application deletes nothing', async () => {
  const state = fakeSheets([headers, row('A'), row('B')]);
  try {
    const result = await deleteApplication(applicationFor(row('Nobody')));
    assert.equal(result.reason, 'not_found');
    assert.equal(state.batches.length, 0);
    assert.deepEqual(companies(state), ['A', 'B']);
  } finally { state.restore(); }
});

test('same company and role on different dates resolve to the right row', async () => {
  const older = row('Acme', '2026-08-01');
  const newer = row('Acme', '2026-09-01');
  const state = fakeSheets([headers, older, newer]);
  try {
    assert.deepEqual(await deleteApplication(applicationFor(newer)), { ok: true, rowIndex: 2 });
    assert.deepEqual(state.rows.slice(1).map((values) => values[0]), ['2026-08-01']);
  } finally { state.restore(); }
});

test('identical-looking rows are refused instead of guessing', async () => {
  const state = fakeSheets([headers, row('A'), row('Acme'), row('B'), row('Acme')]);
  try {
    const result = await deleteApplication(applicationFor(row('Acme')));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ambiguous');
    assert.match(result.message, /Rows 3, 5/);
    assert.equal(state.batches.length, 0);
  } finally { state.restore(); }
});

test('a row renamed in the sheet is still found by its unique job URL', async () => {
  const original = row('Acme', '2026-09-01', 'https://jobs.example.com/1');
  const state = fakeSheets([headers, row('A'), ['2026-09-01', 'Acme Corp', 'Engineer', 'https://jobs.example.com/1', 'Applied', 'LinkedIn', '']]);
  try {
    assert.deepEqual(await deleteApplication(applicationFor(original)), { ok: true, rowIndex: 2 });
    assert.deepEqual(companies(state), ['A']);
  } finally { state.restore(); }
});

test('a stage edit does not stop the row being found', async () => {
  const imported = row('B');
  const edited = [...imported];
  edited[4] = 'Interview';
  const state = fakeSheets([headers, row('A'), edited]);
  try {
    assert.equal((await deleteApplication(applicationFor(imported))).ok, true);
    assert.deepEqual(companies(state), ['A']);
  } finally { state.restore(); }
});

test('a synced date edit is found by the refreshed key', async () => {
  const synced = row('B', '2026-10-09');
  const state = fakeSheets([headers, row('A'), synced]);
  try {
    assert.equal((await deleteApplication(applicationFor(synced))).ok, true);
    assert.deepEqual(companies(state), ['A']);
  } finally { state.restore(); }
});

test('a row added after the others can be deleted', async () => {
  const added = row('New', '2026-09-30');
  const state = fakeSheets([headers, row('A'), row('B'), added]);
  try {
    assert.deepEqual(await deleteApplication(applicationFor(added)), { ok: true, rowIndex: 3 });
    assert.deepEqual(companies(state), ['A', 'B']);
  } finally { state.restore(); }
});

test('a failed Google delete reports failure with its status and changes nothing', async () => {
  const rows = [row('A'), row('B')];
  const state = fakeSheets([headers, ...rows], { failBatch: true });
  try {
    const result = await deleteApplication(applicationFor(rows[1]));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'google_error');
    assert.equal(result.googleStatus, 403);
    assert.match(result.googleDetail, /permission/);
    assert.deepEqual(companies(state), ['A', 'B']);
  } finally { state.restore(); }
});

test('a missing tab or unreadable sheet deletes nothing', async () => {
  const state = fakeSheets([headers, row('A')], { tabs: [{ sheetId: 0, title: 'Renamed' }] });
  try {
    const result = await locateApplicationRow({ token: 't', ...applicationFor(row('A')) });
    assert.equal(result.reason, 'tab_missing');
    assert.equal(state.batches.length, 0);
  } finally { state.restore(); }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'expired' });
  try {
    const result = await locateApplicationRow({ token: 't', ...applicationFor(row('A')) });
    assert.equal(result.reason, 'google_error');
    assert.equal(result.googleStatus, 401);
  } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = async () => { throw new TypeError('network down'); };
  try {
    const result = await locateApplicationRow({ token: 't', ...applicationFor(row('A')) });
    assert.equal(result.reason, 'google_error');
  } finally { globalThis.fetch = originalFetch; }
});

test('the first tab (sheetId 0) is a valid delete target', async () => {
  const rows = [row('A'), row('B')];
  const originalFetch = globalThis.fetch;
  let batch = null;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (options.method === 'POST') { batch = JSON.parse(options.body); return { ok: true, status: 200, json: async () => ({}) }; }
    if (url.includes('/values/')) return { ok: true, status: 200, json: async () => ({ values: [headers, ...rows] }) };
    return { ok: true, status: 200, json: async () => ({ sheets: [{ properties: { sheetId: 0, title: TAB } }] }) };
  };
  try {
    assert.deepEqual(await deleteApplication(applicationFor(rows[0])), { ok: true, rowIndex: 1 });
    assert.equal(batch.requests[0].deleteDimension.range.sheetId, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('refuses to delete the header or a non-integer index', async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  try {
    for (const rowIndex of [0, -1, 1.5]) {
      const result = await deleteSheetRow({ token: 't', spreadsheetId: SPREADSHEET, sheetId: TAB_ID, rowIndex });
      assert.equal(result.ok, false);
    }
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});
