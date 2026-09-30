# RekodJa Web App

RekodJa is a job application tracker for people who already keep their applications in a Google Sheet. Instead of moving your data into another service, RekodJa works on top of the sheet you own. The sheet stays the record; RekodJa adds the dashboard, reminders and follow-ups a spreadsheet can't give you.

RekodJa comes in two parts that share the same sheet:

- **RekodJa: Job Tracker** (Chrome extension, free) saves a job posting into your sheet in one click.
- **RekodJa Web App** (this repository) connects to that sheet and turns it into a workspace: see what needs attention, update stages, draft follow-ups, scan Gmail for replies and track your results.

You can use the web app without the extension. Any sheet with the expected columns works.

## What you can do

| Page | What it's for |
| --- | --- |
| **Overview** | Starts with **Needs Attention**: applications that have waited too long without a reply, each with a follow-up shortcut. |
| **Applications** | Every application in one table. Open one to see its confirmed history, change its stage or date applied, or delete it. |
| **Actions** | The Action Center: follow-ups that are due, recruiter replies, and Gmail detections waiting for you to confirm or dismiss. |
| **Follow-up** | A ready-to-edit follow-up email for any application, written from its company, role and date. |
| **Gmail Scan** *(Pro)* | Reads your recent Gmail (last 45 days, read-only) and suggests new applications and status changes such as interviews or rejections. Nothing changes until you confirm it. |
| **Analytics** | Interview and offer rates, application volume, your pipeline by stage, and which sources perform best. Based only on history you've confirmed. |
| **Settings** | Connect or change your tracker, sync it, manage your plan, or delete your account. |

## How it works with your Google Sheet

```
Chrome extension ──adds rows──▶  Your Google Sheet  ◀──reads and writes──▶  RekodJa Web App
                                  (the record)                              (dashboard)
```

1. **Connect once.** In Settings you pick your spreadsheet with Google Picker, then choose the tab that holds your applications.
2. **Sync brings the sheet in.** Each row becomes an application in RekodJa. Syncing again updates what changed instead of creating duplicates.
3. **Changes in RekodJa go back to the sheet.** Changing a stage updates the row's Status cell. Changing the date applied updates the Date Applied cell. Deleting an application deletes its row.
4. **Rows you delete in the sheet** are detected on the next sync, and RekodJa asks before removing them from the app.

When RekodJa can't tell exactly which row an application belongs to (for example, two identical rows), it refuses to delete rather than guess, and tells you which rows to check.

**Expected columns** (header in row 1): `Date Applied`, `Company`, `Role`, `Status`, `Source`, plus an optional `Job Link` (or `Job URL`). The extension creates this layout for you. Extra columns such as `Days Since Applied`, `Notes` or `Email Sender` are left alone.

## Privacy and permissions

- **Sign-in** uses Google for identity only: your name, email and profile picture.
- **Google Sheets** access uses the `drive.file` scope, so RekodJa can only open the file you picked in Google Picker. The access token is short-lived and is never stored.
- **Gmail** (Pro, optional) uses `gmail.readonly`, requested only when you start a scan. RekodJa never sends, deletes or changes email.
- **AI** is used only when a scanned email can't be matched by RekodJa's own rules. The subject and a short excerpt may then be sent to Google Gemini to read the company name. Matching an email to an application always happens in RekodJa's code.
- **Stored data** (your profile, applications, history and scan suggestions) lives in Supabase, locked so each account can only read its own rows. You can delete your account and all of it from Settings.

The full policy is at `/privacy` in the app.

## Plans

- **Free:** connect your sheet, sync, and use Overview, Applications, Actions, follow-up drafts and Analytics.
- **Pro:** everything in Free plus Gmail Scan. RM6 a month, RM18 for 3 months, or RM66 a year, with a 14-day trial on your first subscription. Payments go through Stripe.

---

## For developers

Next.js (App Router) and TypeScript, with Supabase (Postgres with row-level security, server-side auth), Google Identity Services, Picker, Sheets and Gmail APIs, Stripe Billing and Google Gemini. Everything talks to Supabase from the server; there is no browser Supabase client.

Requires Node.js 20.9 or newer (Node 22 LTS recommended).

### Run it locally

Use the isolated test launcher. It runs against the **Test** Supabase project and the Stripe Sandbox:

```powershell
Set-Location "C:\Users\aidil\OneDrive\Desktop\JOB TRACKER\pro"
npm ci
npm run dev:test:check   # checks the configuration only
npm run dev:test         # runs the app on http://localhost:3002
```

- The launcher reads **only** `.env.stripe-test.local`. It copies the code to a temporary folder without any `.env*` files and runs Next.js on port 3002.
- It prints fixed `PASS` / `FAIL` labels instead of raw output, which could contain secrets. `PORT_3002_AVAILABLE: FAIL` means the port is already in use.
- It runs a snapshot of the code: restart it after changing code or configuration.
- **Don't use `npm run dev` for billing or Gmail work.** It can load `.env.local`, which holds production credentials.

### Checks

```powershell
npm test            # unit and database tests (Postgres tests apply the real migrations)
npm run typecheck
npm run build
```

The database tests recreate Supabase's auth interface and check row-level security, owner-only access, idempotent imports, stage history, billing and beta rules. They don't prove a hosted project's settings or the live Google integration. For that, run the SQL files in `supabase/tests/` in the hosted SQL Editor and try a real Picker import.

<details>
<summary>First-time setup of Supabase and Google Cloud</summary>

1. **Environment.** Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY` (the publishable or legacy anon key, never a service-role key), `APP_URL`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_PICKER_API_KEY` and `GOOGLE_CLOUD_PROJECT_NUMBER`. `.env*` files are git-ignored except `.env.example`.
2. **Database.** Run the files in `supabase/migrations/` in order in the Supabase SQL Editor. Then run `supabase/tests/*.sql`; each ends with `PASS` and rolls its fixtures back.
3. **Google sign-in.** Create an OAuth consent screen and a Web OAuth client with only the `openid`, `email` and `profile` scopes. Set its redirect URI to the Supabase callback (`https://YOUR_PROJECT.supabase.co/auth/v1/callback`). Enable Google in Supabase Authentication with that client ID and secret. The client secret belongs in Supabase, not in this app.
4. **Supabase URLs.** Set the Site URL to `http://localhost:3002` and allow `http://localhost:3002/auth/callback`.
5. **Sheets and Picker.** Enable the Google Picker API and Google Sheets API. Add the `drive.file` scope under Data Access. Add `http://localhost:3002` to the OAuth client's JavaScript origins. Create a Picker API key restricted to your origins and `https://docs.google.com/*`.
6. **Gmail scan.** Enable the Gmail API and add `gmail.readonly` under Data Access.
7. **Deploying.** Use a Vercel project rooted at `pro`. Set the same variables with `APP_URL` set to the HTTPS origin, and allow that `/auth/callback` in Supabase.

</details>

### Where things are

- `src/app/dashboard/`: the workspace pages (overview, applications, actions, Gmail scan, analytics, settings)
- `src/app/api/`: server routes for applications, sheet connections and import, Gmail scan, Google tab listing and billing
- `src/lib/sheets/`: the sheet parser, the stable row identity, and write-back (stage, date, row deletion)
- `src/lib/gmail/`: scanning and email classification
- `src/lib/billing/`, `src/lib/stripe/`: plans, access rules, Checkout and the webhook
- `supabase/migrations/`, `supabase/tests/`: schema, row-level security and hosted SQL tests
- `scripts/dev-test.mjs`: the isolated test launcher
- `tests/`: automated tests

Project-wide documents (product requirements, architecture, progress, billing go-live plan) are in the `DOCS/` folder of the parent project.
