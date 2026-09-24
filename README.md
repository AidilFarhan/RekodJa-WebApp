## Local test environment

Gunakan launcher ini untuk menguji Stripe Sandbox dan Supabase RekodJa Test secara berasingan daripada production.

### Semak konfigurasi sahaja

Arahan ini hanya menyemak konfigurasi dan tidak menjalankan aplikasi:

```powershell
Set-Location "C:\Users\aidil\OneDrive\Desktop\JOB TRACKER\pro"
npm run dev:test:check
```

Launcher membaca **hanya** `.env.stripe-test.local`, tanpa fallback daripada
`.env.local` atau environment aplikasi yang diwarisi. Ia menyalin kod ke folder
sementara tanpa fail `.env*`, kemudian menjalankan Next.js pada port 3002.
Hanya environment sistem yang dibenarkan diwarisi. Jangan guna `npm run dev`
untuk ujian Stripe kerana arahan biasa itu boleh memuat `.env.local`.

`--check` menyemak konfigurasi sahaja; ia **tidak** membuktikan key sah di server,
Google Picker berfungsi, webhook diterima atau pembayaran berjaya. Publishable
key yang opaque tidak boleh dipadankan dengan project secara offline. Admin
client memerlukan legacy `service_role` key projek Test dan URL localhost tepat.

Selepas arahan untuk menjalankan aplikasi diberi:

```powershell
Set-Location "C:\Users\aidil\OneDrive\Desktop\JOB TRACKER\pro"
npm run dev:test
```

Output launcher hanya label tetap `PASS` / `FAIL`; error mentah aplikasi tidak
dicetak kerana ia mungkin mengandungi secrets. `PORT_3002_AVAILABLE: FAIL`
bermaksud port sedang digunakan. Jangan hentikan proses yang belum dikenal pasti.
Launcher menggunakan snapshot kod: hentikan terminal launcher dengan Ctrl+C
dan jalankan semula selepas mengubah kod atau konfigurasi.

**Status billing:** Checkout masih dikunci (HTTP 503). Ini belum integrasi Stripe
lengkap; webhook, portal, UI Pro dan ujian lifecycle Sandbox masih diperlukan.
Jangan deploy atau push branch ini ke `main`.

# Job Tracker Pro — production milestones 1–2

Independent Next.js App Router / TypeScript app. No prototype code or mock data is imported. It includes Google identity sign-in, private profiles, owner-scoped application/event data, and a narrowly scoped one-way Google Sheet import.

## Local setup (PowerShell)

Requires Node.js 20.9 or newer (Node 22 LTS recommended).

```powershell
Set-Location "C:\Users\aidil\OneDrive\Desktop\JOB TRACKER\pro"
npm ci
Copy-Item .env.example .env.local
```

Edit `.env.local` locally:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
APP_URL=http://localhost:3002
GOOGLE_OAUTH_CLIENT_ID=YOUR_WEB_OAUTH_CLIENT_ID.apps.googleusercontent.com
GOOGLE_PICKER_API_KEY=YOUR_BROWSER_RESTRICTED_API_KEY
GOOGLE_CLOUD_PROJECT_NUMBER=YOUR_NUMERIC_PROJECT_NUMBER
```

Use the project's publishable key or legacy anon key, NEVER a service-role or secret key. All three values are read only on the server; there is no browser Supabase client. `.env*` is ignored except `.env.example`. Do not upload `.env.local` using GitHub's manual file uploader (which does not enforce your local ignore file). Google client secrets belong in Supabase provider settings, not this app.

## Milestone 1: Supabase and Google sign-in configuration

1. Create a Supabase project. In its SQL Editor, run `supabase/migrations/202609170001_profiles.sql` once. This creates the table, RLS policies, grants and signup trigger, and backfills any existing users.
2. In Google Cloud, configure an OAuth consent screen and a Web application OAuth client. Configure only `openid`, `email`, `profile` identity scopes. Add your Google account as a test user when the consent app is in testing. Do not enable Gmail or Sheets permissions.
3. Set the Google client's authorized redirect URI to `https://YOUR_PROJECT.supabase.co/auth/v1/callback` (copy the exact callback from Supabase).
4. In Supabase Authentication → Sign In / Providers → Google, enable Google and enter the client ID and client secret. Do not enable skip nonce checks.
5. In Supabase Authentication → URL Configuration, set Site URL to `http://localhost:3002` and add the exact allowed redirect `http://localhost:3002/auth/callback`.
6. Put the project's URL and public key in `.env.local`, then run:

```powershell
npm run dev
```

## Milestone 2: database and Google Picker configuration

1. Run `supabase/migrations/202609180001_applications_and_sheets.sql` once in the hosted Supabase SQL Editor.
2. Run `supabase/tests/applications_rls.sql` in the hosted SQL Editor. A successful result ends with `PASS`; all test fixtures are rolled back.
3. In the same Google Cloud project used for sign-in, enable **Google Picker API** and **Google Sheets API**.
4. In Google Auth Platform → Data Access, add only `https://www.googleapis.com/auth/drive.file`. Keep the identity scopes (`openid`, `email`, `profile`). Do not add `spreadsheets`, broad Drive, or Gmail scopes.
5. On the existing Web OAuth client, add `http://localhost:3002` under Authorized JavaScript origins. Add the production HTTPS origin later. Keep the existing Supabase redirect URI unchanged.
6. Create a Google API key for Picker. Restrict it to Websites and add `http://localhost:3002/*`, the production origin when available, and `https://docs.google.com/*`. Restrict the key to Google Picker API.
7. Copy the existing Web OAuth client ID, browser-restricted Picker API key, and numeric Google Cloud project number to `.env.local` using the names above. These identifiers are expected to reach browser code; no client secret is exposed. The existing OAuth client secret remains only in Supabase.

The connection screen is `/tracker-setup`. It obtains a short-lived token in the browser only after a user click, requesting exactly `drive.file`. Picker grants access to the selected spreadsheet. The access token is relayed to the app's authenticated route for the immediate read and is never stored in Postgres, logs, cookies, or local storage.

The manual import reads columns `Date Applied`, `Company`, `Role`, `Job URL`, `Status`, `Source`, and ignores the derived `Days Since Applied`. It is one-way Sheet → database. A stable SHA-256 identity is derived from spreadsheet, tab, date, company, role and normalized job URL. The database serializes and upserts by that identity, so retries cannot duplicate applications or history events. A changed Sheet stage updates the same application and appends one `user_confirmed` event; unchanged retries append no event.

Open http://localhost:3002. For a later deployment, use a separate Vercel project rooted at `pro` (or `./` if only this folder is uploaded). Set the same environment variables there with `APP_URL` equal to the production HTTPS origin, and allow that exact `/auth/callback` URL in Supabase. This does not deploy or replace the prototype.

## Verification

```powershell
npm test
npm run typecheck
npm run build
npm start
```

`npm test` runs 20 tests. The PostgreSQL tests recreate Supabase's auth role/schema interface and apply the actual migrations. They verify RLS, owner access, cross-user denial, relationship integrity, idempotent retry, and stage-history behavior. Parser tests verify the Free extension column contract and stable identity. These tests do not by themselves prove a hosted project's settings or Google integration; run the hosted SQL test and manual Picker import as described above.

Manual checks after hosted configuration:

- Sign in with Google; consent should show identity only. Cancellation returns a generic retry message.
- `/account` shows your real email and trigger-created name. Edit the name and refresh: it persists in Postgres.
- Sign out; visiting `/account` returns to sign-in.
- Sign in with a second Google account in a separate browser session; it gets its own profile.
- Run `supabase/tests/profiles_rls.sql` in Supabase SQL Editor for a hosted isolation test. It impersonates an authenticated user and rolls back fixtures. The SQL Editor's default privileged role bypasses RLS and is NOT a valid isolation test by itself.

## Routes and files

- `src/app/page.tsx`: `/` → `/account`
- `src/app/sign-in/page.tsx`: `/sign-in`
- `src/app/auth/callback/route.ts`: PKCE callback
- `src/app/account/page.tsx`: authenticated profile
- `src/app/tracker-setup`: Picker connection and manual import flow
- `src/app/api/google/sheets/tabs`: validates selected file access and lists tabs
- `src/app/api/sheet-connections`: owner-scoped connection save
- `src/app/api/sheet-connections/[id]/import`: one-way import
- `src/lib/sheets/import.ts`: strict parser and stable import identity
- `src/app/actions.ts`: sign-in, sign-out, own-profile update
- `src/lib/config.ts`, `src/lib/supabase.ts`, `src/proxy.ts`: server environment, cookie client and session refresh
- `src/app/layout.tsx`, `globals.css`, `error.tsx`: minimal accessible navy/near-white UI and safe error page
- `supabase/migrations/202609170001_profiles.sql`: production schema and RLS
- `supabase/migrations/202609180001_applications_and_sheets.sql`: applications, events, sheet connections, RLS and atomic import function
- `supabase/tests/applications_rls.sql`: hosted owner/cross-user/idempotency verification
- `tests/profiles.test.mjs`: database integrity tests
- `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`, `.gitignore`, `.env.example`: independent project setup

No dashboard, Gmail integration, two-way sync, payments or background processing are included.

References: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [Google provider configuration](https://supabase.com/docs/guides/auth/social-login/auth-google), [Google Picker for web](https://developers.google.com/workspace/drive/picker/guides/web-picker), [Drive `drive.file` scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
