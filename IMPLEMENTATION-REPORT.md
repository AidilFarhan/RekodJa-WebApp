# Production implementation status

## Implemented locally

Independent production app under `pro/`; no existing Free or `pro-prototype` files were edited by this work. The workspace is not a Git repository, so this statement is based on the scoped file operations, not a Git diff.

Real Supabase SSR Google OAuth/PKCE code, identity-only scopes, server-verified account page, editable display name, sign-out, generic safe errors, HTTP-only session cookies (secure over HTTPS), no-store authenticated responses. No mock data or production features beyond authentication/profile.

Files: `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`, `.gitignore`, `.env.example`, ignored `.env.local`, `README.md`, this report; `src/app/{layout.tsx,globals.css,page.tsx,actions.ts,error.tsx}`, `src/app/sign-in/page.tsx`, `src/app/account/page.tsx`, `src/app/auth/callback/route.ts`, `src/lib/{config.ts,supabase.ts}`, `src/proxy.ts`, `supabase/migrations/202609170001_profiles.sql`, `supabase/tests/profiles_rls.sql`, `tests/profiles.test.mjs`. Next.js also generated `AGENTS.md` and `CLAUDE.md` inside this project; dependencies/build caches stay ignored.

## Infrastructure

Free organization created with user approval. User created the Supabase project `Job Tracker Web App` (`dhndublwvgylxlrbwwyu`), healthy in Mumbai. Its URL and public publishable key are configured in the ignored `.env.local`. No service-role key, Google secret or database password is stored in the application.

The profiles migration is live in hosted Supabase and Google provider remains configured for identity-only sign-in. The Milestone 2 migration is also live in hosted Supabase. The Google Cloud project is configured with the existing OAuth client, the exact `drive.file` scope, Google Picker API, Google Sheets API, the exact `http://localhost:3002` JavaScript origin, and a Picker-only API key restricted to `http://localhost:3002/*`.

## Verification so far

- 11/11 profile database tests passed using the actual SQL migration in PGlite PostgreSQL (Supabase auth role/schema interface supplied by test harness).
- Hosted Supabase verification passed: owner access succeeded for all three Milestone 2 tables; a second authenticated user saw zero rows and could not update or spoof rows; importing the same logical Sheet row twice left exactly one application and one event. All hosted fixtures were rolled back.
- TypeScript check passed.
- Production build passed during implementation, including HTTP-only cookie hardening. A later rerun was blocked by OneDrive marking the generated `.next/server/app/api` cache directory read-only; this is a local cache-lock issue, not a source or type error. Built browser assets contain neither the configured Supabase key nor project URL.
- Browser: sign-in design verified; anonymous `/account` redirects to `/sign-in`.

See README for exact installation, environment, Google/Supabase setup and manual test steps.

## Milestone 2 local implementation

Added `applications`, `application_events`, and `sheet_connections` with owner-only RLS, composite ownership foreign keys, and an atomic Sheet import function. Added `/tracker-setup`, Google Picker `drive.file` authorization, selected-tab storage, Sheets API reads, Free extension column parsing, and one-way idempotent imports. Google tokens are short-lived and not persisted.

Local result: 20/20 tests pass, including positive owner access, negative cross-user reads/updates, application/event ownership integrity, duplicate import prevention, and one-event-per-stage-change behavior. `npm run typecheck` and `npm run build` also pass. Hosted migration/RLS and idempotency tests pass. The remaining manual check is to sign in locally, choose a spreadsheet in Picker, choose its tab, and run the one-way import against a real test sheet.

## Milestone 3 dashboard

Added `/dashboard` and `/dashboard/applications/[id]` using real Supabase application and event data. The dashboard includes owner-scoped metrics, stage/source filters, an empty state, compact application table, and links to application details. Detail pages show confirmed history only and preserve the distinction between detected observations and confirmed events. Added `src/lib/dashboard.ts` selectors/metrics and `tests/dashboard.test.mjs`. The complete suite now passes 23/23, TypeScript passes, and the production build includes both dashboard routes.

The importer also accepts the connected tracker’s `Job Link` header, timestamp-formatted dates, and `Replied` rows (stored as the supported `Applied` stage). The suite now passes 24/24.
