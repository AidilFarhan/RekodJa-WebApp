import { createHash } from 'node:crypto';

export const APPLICATION_STAGES = ['Applied', 'Interview', 'Offer', 'Rejected', 'Ghosted', 'Withdrawn'] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export type ImportRow = {
  importKey: string;
  company: string;
  role: string;
  stage: ApplicationStage;
  replied: boolean;
  dateApplied: string | null;
  source: string;
  jobUrl: string;
};

const normalize = (value: unknown) => String(value ?? '').trim();
export const normalizeUrl = (value: string) => {
  if (!value) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch { return value.toLowerCase(); }
};

function validCalendarDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function dateValue(value: string): string | null {
  const timestamp = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(value);
  if (timestamp) {
    const [, year, month, day] = timestamp;
    const [y, m, d] = [Number(year), Number(month), Number(day)];
    return validCalendarDate(y, m, d) ? `${year}-${month}-${day}` : null;
  }
  const common = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(value);
  if (!common) return null;
  const [, day, month, year] = common;
  const [d, m, y] = [Number(day), Number(month), Number(year)];
  if (!validCalendarDate(y, m, d)) return null;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

export function parseSheetRows(values: unknown[][], spreadsheetId: string, sheetName: string) {
  if (!values.length) return { rows: [] as ImportRow[], errors: ['The selected tab is empty.'], warnings: [], jobUrls: [] };
  const headers = values[0].map((value) => normalize(value).toLowerCase());
  const required = ['date applied', 'company', 'role', 'status', 'source'];
  const aliases: Record<string, string[]> = {
    'job url': ['job url', 'job link'],
    role: ['role', 'position'],
    status: ['status', 'current status'],
  };
  const positions = Object.fromEntries(required.map((header) => [header, (aliases[header] ?? [header]).map((alias) => headers.indexOf(alias)).find((index) => index >= 0) ?? -1]));
  const missing = required.filter((header) => positions[header] < 0);
  if (missing.length) return { rows: [] as ImportRow[], errors: [`Missing columns: ${missing.join(', ')}.`], warnings: [], jobUrls: [] };
  const jobUrlIndex = ['job url', 'job link'].map((alias) => headers.indexOf(alias)).find((index) => index >= 0) ?? -1;

  const rows: ImportRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const jobUrls: string[] = [];
  if (jobUrlIndex < 0) warnings.push('Column "Job URL" was not found; links will be empty.');
  values.slice(1).forEach((raw, offset) => {
    if (!raw.some((cell) => normalize(cell))) return;
    const line = offset + 2;
    const company = normalize(raw[positions.company]);
    const role = normalize(raw[positions.role]);
    const rawStage = normalize(raw[positions.status]);
    const replied = rawStage.toLowerCase() === 'replied';
    const stage = replied ? 'Applied' : rawStage || 'Applied';
    const rawDate = normalize(raw[positions['date applied']]);
    const dateApplied = dateValue(rawDate);
    const source = normalize(raw[positions.source]);
    const jobUrl = jobUrlIndex >= 0 ? normalize(raw[jobUrlIndex]) : '';
    if (jobUrl) jobUrls.push(normalizeUrl(jobUrl));
    if (!company || !role || !APPLICATION_STAGES.includes(stage as ApplicationStage)) {
      errors.push(`Row ${line} was skipped: company, role and a valid status are required.`);
      return;
    }
    if (rawDate && !dateApplied) warnings.push(`Row ${line}: date "${rawDate}" is not a valid calendar date; imported without a date.`);
    const identity = [spreadsheetId, sheetName, dateApplied ?? '', company.toLowerCase(), role.toLowerCase(), normalizeUrl(jobUrl)].join('\u001f');
    rows.push({
      importKey: createHash('sha256').update(identity).digest('hex'),
      company, role, stage: stage as ApplicationStage, replied, dateApplied, source, jobUrl,
    });
  });
  return { rows, errors, warnings, jobUrls };
}
