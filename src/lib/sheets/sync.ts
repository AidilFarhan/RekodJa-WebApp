import { sheetColumns, rowIdentityKey, dateValue, normalize, normalizeUrl } from './import.ts';

export type SheetSyncResult = { synced: boolean; row: number | null; message?: string };

function columnLetter(index: number) {
  let name = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

/*
  Finds the application's row in the connected sheet (by the same
  identity key the import used, falling back to the job URL) and
  writes the new stage into the sheet's Status column.
*/
export async function syncStageToSheet(options: {
  token: string;
  spreadsheetId: string;
  sheetName: string;
  importKey: string | null;
  company: string;
  role: string;
  dateApplied: string | null;
  jobUrl: string;
  stage: string;
}): Promise<SheetSyncResult> {
  const { token, spreadsheetId, sheetName, importKey, company, role, dateApplied, jobUrl, stage } = options;
  const tab = `'${sheetName.replaceAll("'", "''")}'`;
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A:Z`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const readResponse = await fetch(readUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!readResponse.ok) throw new Error('Google could not read the connected sheet to sync the stage.');
  const sheet = (await readResponse.json()) as { values?: unknown[][] };
  const values = sheet.values ?? [];
  if (!values.length) throw new Error('The connected sheet tab is empty.');
  const indexes = sheetColumns(values[0]);
  if (indexes.status < 0) throw new Error('The sheet has no Status column to update.');
  const wantedUrl = normalizeUrl(jobUrl);
  let matchedRow = -1;
  for (let offset = 1; offset < values.length; offset += 1) {
    const raw = values[offset];
    if (!raw.some((cell) => normalize(cell))) continue;
    const rowCompany = normalize(raw[indexes.company]);
    const rowRole = normalize(raw[indexes.role]);
    const rowDate = dateValue(normalize(raw[indexes.dateApplied]));
    const rowJobUrl = indexes.jobUrl >= 0 ? normalize(raw[indexes.jobUrl]) : '';
    const keyMatches = Boolean(importKey) && rowIdentityKey({ spreadsheetId, sheetName, company: rowCompany, role: rowRole, dateApplied: rowDate, jobUrl: rowJobUrl }) === importKey;
    const urlMatches = Boolean(wantedUrl) && normalizeUrl(rowJobUrl) === wantedUrl;
    // Date edits intentionally change the identity key. Exact company, role and
    // current date keep existing imported rows syncable even before a later
    // import refreshes the key.
    const currentDetailsMatch = rowCompany === normalize(company) && rowRole === normalize(role) && rowDate === dateApplied;
    if (keyMatches || urlMatches || currentDetailsMatch) { matchedRow = offset + 1; break; }
  }
  if (matchedRow < 0) return { synced: false, row: null, message: 'This application no longer matches a row in the connected sheet.' };
  const cell = `${columnLetter(indexes.status)}${matchedRow}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!${cell}`)}?valueInputOption=USER_ENTERED`;
  const writeResponse = await fetch(writeUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[stage]] }),
  });
  if (!writeResponse.ok) throw new Error('Google could not update the status cell in the sheet.');
  return { synced: true, row: matchedRow };
}

/*
  Updates only the Date Applied cell on the matching imported row. The lookup
  deliberately uses the application's *current* details (including its old
  date/import key); otherwise changing the date first would make that row
  impossible to find. This is a PUT to one cell, never an append.
*/
export async function syncDateAppliedToSheet(options: {
  token: string;
  spreadsheetId: string;
  sheetName: string;
  importKey: string | null;
  company: string;
  role: string;
  currentDateApplied: string | null;
  jobUrl: string;
  nextDateApplied: string;
}): Promise<SheetSyncResult> {
  const { token, spreadsheetId, sheetName, importKey, company, role, currentDateApplied, jobUrl, nextDateApplied } = options;
  const tab = `'${sheetName.replaceAll("'", "''")}'`;
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!A:Z`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const readResponse = await fetch(readUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!readResponse.ok) throw new Error('Google could not read the connected sheet to sync the date.');
  const sheet = (await readResponse.json()) as { values?: unknown[][] };
  const values = sheet.values ?? [];
  if (!values.length) throw new Error('The connected sheet tab is empty.');
  const indexes = sheetColumns(values[0]);
  if (indexes.dateApplied < 0) throw new Error('The sheet has no Date Applied column to update.');
  const wantedUrl = normalizeUrl(jobUrl);
  let matchedRow = -1;
  for (let offset = 1; offset < values.length; offset += 1) {
    const raw = values[offset];
    if (!raw.some((cell) => normalize(cell))) continue;
    const rowCompany = normalize(raw[indexes.company]);
    const rowRole = normalize(raw[indexes.role]);
    const rowDate = dateValue(normalize(raw[indexes.dateApplied]));
    const rowJobUrl = indexes.jobUrl >= 0 ? normalize(raw[indexes.jobUrl]) : '';
    const keyMatches = Boolean(importKey) && rowIdentityKey({ spreadsheetId, sheetName, company: rowCompany, role: rowRole, dateApplied: rowDate, jobUrl: rowJobUrl }) === importKey;
    const legacyDateMatches = rowCompany === normalize(company) && rowRole === normalize(role) && rowDate === currentDateApplied;
    const urlMatches = Boolean(wantedUrl) && normalizeUrl(rowJobUrl) === wantedUrl;
    if (keyMatches || urlMatches || legacyDateMatches) { matchedRow = offset + 1; break; }
  }
  if (matchedRow < 0) return { synced: false, row: null, message: 'This application no longer matches a row in the connected sheet.' };
  const cell = `${columnLetter(indexes.dateApplied)}${matchedRow}`;
  const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`${tab}!${cell}`)}?valueInputOption=USER_ENTERED`;
  const writeResponse = await fetch(writeUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [[nextDateApplied]] }),
  });
  if (!writeResponse.ok) throw new Error('Google could not update the date cell in the sheet.');
  return { synced: true, row: matchedRow };
}

export type SheetRowIdentity = {
  spreadsheetId: string;
  sheetName: string;
  importKey: string | null;
  company: string;
  role: string;
  dateApplied: string | null;
  jobUrl: string;
};

export type RowResolution =
  | { status: 'found'; rowIndex: number }
  | { status: 'not_found' }
  | { status: 'ambiguous'; rowNumbers: number[] };

/*
  Resolves an application to exactly one data row before a destructive change.
  The stage/date writers above take the first plausible row; deletion must not.
  Signals are tried strongest first (import key, then job URL, then current
  company + role + date) and the first signal that matches anything must match
  exactly one row, otherwise nothing is deleted.

  `values` is the A:Z read, so values[0] is sheet row 1 (the header). The
  returned rowIndex is the zero-based index into `values`, which is also the
  zero-based Sheets API row index; it is never 0.
*/
export function resolveApplicationRow(values: unknown[][], identity: SheetRowIdentity): RowResolution {
  const { spreadsheetId, sheetName, importKey, company, role, dateApplied, jobUrl } = identity;
  if (values.length < 2) return { status: 'not_found' };
  const indexes = sheetColumns(values[0]);
  if (indexes.company < 0 || indexes.role < 0) return { status: 'not_found' };
  const wantedUrl = normalizeUrl(jobUrl);
  const byKey: number[] = [];
  const byUrl: number[] = [];
  const byDetails: number[] = [];
  for (let offset = 1; offset < values.length; offset += 1) {
    const raw = values[offset] ?? [];
    if (!raw.some((cell) => normalize(cell))) continue;
    const rowCompany = normalize(raw[indexes.company]);
    const rowRole = normalize(raw[indexes.role]);
    const rowDate = indexes.dateApplied >= 0 ? dateValue(normalize(raw[indexes.dateApplied])) : null;
    const rowJobUrl = indexes.jobUrl >= 0 ? normalize(raw[indexes.jobUrl]) : '';
    if (importKey && rowIdentityKey({ spreadsheetId, sheetName, company: rowCompany, role: rowRole, dateApplied: rowDate, jobUrl: rowJobUrl }) === importKey) byKey.push(offset);
    if (wantedUrl && normalizeUrl(rowJobUrl) === wantedUrl) byUrl.push(offset);
    if (rowCompany === normalize(company) && rowRole === normalize(role) && rowDate === dateApplied) byDetails.push(offset);
  }
  for (const matches of [byKey, byUrl, byDetails]) {
    if (matches.length === 1) return { status: 'found', rowIndex: matches[0] };
    if (matches.length > 1) return { status: 'ambiguous', rowNumbers: matches.map((offset) => offset + 1) };
  }
  return { status: 'not_found' };
}

export type SheetFailure = { ok: false; reason: 'google_error' | 'tab_missing' | 'not_found' | 'ambiguous'; message: string; googleStatus?: number; googleDetail?: string };
export type SheetRowLocation = { ok: true; sheetId: number; rowIndex: number } | SheetFailure;

async function googleErrorDetail(response: Response) {
  try { return (await response.text()).slice(0, 500); } catch { return ''; }
}

/*
  Finds the numeric tab id (deleteDimension needs it; the spreadsheet id is
  not enough) and the application's current row. Reads the sheet fresh on
  every call, so rows that shifted after an earlier deletion are found at
  their new position. Never throws.
*/
export async function locateApplicationRow(options: SheetRowIdentity & { token: string }): Promise<SheetRowLocation> {
  const { token, ...identity } = options;
  const { spreadsheetId, sheetName } = identity;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const metaResponse = await fetch(`${base}?fields=${encodeURIComponent('sheets.properties(sheetId,title)')}`, { headers, cache: 'no-store' });
    if (!metaResponse.ok) return { ok: false, reason: 'google_error', message: 'Google could not open the connected sheet, so nothing was deleted.', googleStatus: metaResponse.status, googleDetail: await googleErrorDetail(metaResponse) };
    const meta = (await metaResponse.json()) as { sheets?: { properties?: { sheetId?: number; title?: string } }[] };
    const sheetId = meta.sheets?.find((sheet) => sheet.properties?.title === sheetName)?.properties?.sheetId;
    if (typeof sheetId !== 'number') return { ok: false, reason: 'tab_missing', message: `The "${sheetName}" tab was not found in the connected sheet, so nothing was deleted.` };
    const tab = `'${sheetName.replaceAll("'", "''")}'`;
    const readResponse = await fetch(`${base}/values/${encodeURIComponent(`${tab}!A:Z`)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, { headers, cache: 'no-store' });
    if (!readResponse.ok) return { ok: false, reason: 'google_error', message: 'Google could not read the connected sheet, so nothing was deleted.', googleStatus: readResponse.status, googleDetail: await googleErrorDetail(readResponse) };
    const sheet = (await readResponse.json()) as { values?: unknown[][] };
    const resolution = resolveApplicationRow(sheet.values ?? [], identity);
    if (resolution.status === 'ambiguous') return { ok: false, reason: 'ambiguous', message: `Rows ${resolution.rowNumbers.join(', ')} in your Google Sheet all look like this application, so nothing was deleted. Remove the extra row in the sheet, then try again.` };
    if (resolution.status === 'not_found') return { ok: false, reason: 'not_found', message: 'This application no longer matches a row in your Google Sheet, so nothing was deleted. If you already removed the row, run Sync tracker in Settings to remove it here.' };
    return { ok: true, sheetId, rowIndex: resolution.rowIndex };
  } catch {
    return { ok: false, reason: 'google_error', message: 'Google Sheets could not be reached, so nothing was deleted.' };
  }
}

/*
  Physically removes one row with spreadsheets.batchUpdate + deleteDimension.
  rowIndex is zero-based and must be a data row (>= 1), never the header.
  Never throws.
*/
export async function deleteSheetRow(options: { token: string; spreadsheetId: string; sheetId: number; rowIndex: number }): Promise<{ ok: true } | SheetFailure> {
  const { token, spreadsheetId, sheetId, rowIndex } = options;
  if (!Number.isInteger(rowIndex) || rowIndex < 1) return { ok: false, reason: 'not_found', message: 'Refused to delete the header row.' };
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] }),
    });
    if (!response.ok) return { ok: false, reason: 'google_error', message: 'Google could not delete the row from your sheet, so nothing was deleted.', googleStatus: response.status, googleDetail: await googleErrorDetail(response) };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'google_error', message: 'Google Sheets could not be reached, so nothing was deleted.' };
  }
}

/*
  Never throws: the app-side stage change is kept even when the
  sheet sync fails, and the reason is reported to the client.
*/
export async function writeStageToSheet(options: {
  token: string;
  connection: { spreadsheet_id: string; sheet_name: string };
  application: { import_key: string | null; company: string; role: string; date_applied: string | null; job_url: string };
  stage: string;
}): Promise<{ synced: boolean; message?: string }> {
  const { token, connection, application, stage } = options;
  if (!token) return { synced: false, message: 'Google access was not granted, so the sheet was not updated.' };
  try {
    const result = await syncStageToSheet({
      token,
      spreadsheetId: connection.spreadsheet_id,
      sheetName: connection.sheet_name,
      importKey: application.import_key,
      company: application.company,
      role: application.role,
      dateApplied: application.date_applied,
      jobUrl: application.job_url,
      stage,
    });
    return result.synced ? { synced: true } : { synced: false, message: result.message };
  } catch (error) {
    return { synced: false, message: error instanceof Error ? error.message : 'The Google Sheet could not be updated.' };
  }
}

export async function writeDateAppliedToSheet(options: {
  token: string;
  connection: { spreadsheet_id: string; sheet_name: string };
  application: { import_key: string | null; company: string; role: string; date_applied: string | null; job_url: string };
  nextDateApplied: string;
}): Promise<{ synced: boolean; message?: string }> {
  const { token, connection, application, nextDateApplied } = options;
  if (!token) return { synced: false, message: 'Google access was not granted, so the sheet was not updated.' };
  try {
    const result = await syncDateAppliedToSheet({
      token,
      spreadsheetId: connection.spreadsheet_id,
      sheetName: connection.sheet_name,
      importKey: application.import_key,
      company: application.company,
      role: application.role,
      currentDateApplied: application.date_applied,
      jobUrl: application.job_url,
      nextDateApplied,
    });
    return result.synced ? { synced: true } : { synced: false, message: result.message };
  } catch (error) {
    return { synced: false, message: error instanceof Error ? error.message : 'The Google Sheet could not be updated.' };
  }
}
