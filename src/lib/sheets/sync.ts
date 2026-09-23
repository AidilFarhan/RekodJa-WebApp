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
