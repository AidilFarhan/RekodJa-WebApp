import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSheetRows } from '../src/lib/sheets/import.ts';

const headers = ['Date Applied', 'Company', 'Role', 'Job URL', 'Status', 'Source', 'Days Since Applied'];

test('parses the Free extension column structure and ignores derived days', () => {
  const result = parseSheetRows([headers, ['2026-09-01', 'Acme', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn', '16']], 'sheet-1', 'Applications');
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.deepEqual(result.rows[0], { importKey: result.rows[0].importKey, company: 'Acme', role: 'Engineer', stage: 'Applied', replied: false, dateApplied: '2026-09-01', source: 'LinkedIn', jobUrl: 'https://example.com/job' });
  assert.equal(result.rows[0].importKey.length, 64);
});

test('same logical row always receives the same stable key', () => {
  const first = parseSheetRows([headers, ['2026-09-01', ' Acme ', 'Engineer', 'https://EXAMPLE.com/job/', 'Applied', 'LinkedIn', '1']], 'sheet-1', 'Applications');
  const second = parseSheetRows([headers, ['2026-09-01', 'Acme', 'Engineer', 'https://example.com/job', 'Offer', 'Other', '99']], 'sheet-1', 'Applications');
  assert.equal(first.rows[0].importKey, second.rows[0].importKey);
});

test('reports missing columns and invalid rows without importing them', () => {
  assert.match(parseSheetRows([['Company']], 'sheet-1', 'Applications').errors[0], /Missing columns/);
  const invalid = parseSheetRows([headers, ['not-a-date', 'Acme', 'Engineer', '', 'Unknown', '', '']], 'sheet-1', 'Applications');
  assert.equal(invalid.rows.length, 0);
  assert.match(invalid.errors[0], /Row 2/);
});

test('accepts Job Link, timestamp dates, and Replied status from the tracker sheet', () => {
  const result = parseSheetRows([
    ['', 'Date Applied', 'Company', 'Role', 'Job Link', 'Status', 'Source'],
    ['0', '2026-09-13 00:00:00', 'Example Co', 'Analyst', 'https://example.com/job', 'Replied', 'JobStreet'],
  ], 'sheet-1', 'Applications');
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], { importKey: result.rows[0].importKey, company: 'Example Co', role: 'Analyst', stage: 'Applied', replied: true, dateApplied: '2026-09-13', source: 'JobStreet', jobUrl: 'https://example.com/job' });
});

test('rejects impossible calendar dates and imports them without a date', () => {
  const result = parseSheetRows([
    headers,
    ['2026-13-40', 'Acme', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn', ''],
    ['32/01/2026', 'Beta', 'Designer', 'https://example.com/job2', 'Applied', 'LinkedIn', ''],
  ], 'sheet-1', 'Applications');
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows.every((row) => row.dateApplied === null));
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /Row 2/);
  assert.match(result.warnings[1], /Row 3/);
});

test('missing date imports with a null date and stable fallback key', () => {
  const headersWithDate = ['Date Applied', 'Company', 'Role', 'Job URL', 'Status', 'Source'];
  const first = parseSheetRows([headersWithDate, ['', 'Acme', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn']], 'sheet-1', 'Applications');
  const second = parseSheetRows([headersWithDate, ['', 'Acme', 'Engineer', 'https://example.com/job', 'Interview', 'Other']], 'sheet-1', 'Applications');
  assert.equal(first.errors.length, 0);
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].dateApplied, null);
  assert.equal(first.rows[0].importKey, second.rows[0].importKey);
});

test('missing company or role still skips the row', () => {
  const result = parseSheetRows([
    headers,
    ['2026-09-01', '', 'Engineer', 'https://example.com/job', 'Applied', 'LinkedIn', ''],
    ['2026-09-01', 'Acme', '', 'https://example.com/job', 'Applied', 'LinkedIn', ''],
  ], 'sheet-1', 'Applications');
  assert.equal(result.rows.length, 0);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /Row 2/);
  assert.match(result.errors[1], /Row 3/);
});
