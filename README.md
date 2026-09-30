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


