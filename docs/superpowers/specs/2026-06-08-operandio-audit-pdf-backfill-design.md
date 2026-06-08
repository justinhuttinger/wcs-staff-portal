# Operandio Audit PDF Backfill — Design

**Date:** 2026-06-08
**Branch:** `feat/operandio-audit-pdf-backfill`
**Status:** Approved design, pending implementation plan

## Problem

Justin has ~70–80 Operandio "Job Report" audit PDFs sitting in `C:\Users\justi\Downloads` (months of Front Desk / PT / Membership Coordinator / Group X / Childcare audits across Salem, Keizer, Eugene, Springfield, Clackamas). The portal's **Audits report** (`portal/src/components/reports/AuditsReport.jsx`) reads from `operandio_qa_reports`, but that table currently holds **only one** audit row (Salem Front Desk Audit, 2026-06-05) because email ingestion only went live recently. The historical audits exist only as these PDFs.

Goal: get every real audit PDF into Supabase so the full audit history appears in the Audits report, and archive the PDF files themselves in Supabase Storage.

## Decisions (from brainstorm)

1. **Backfill the Audits report** — parse each PDF, create `operandio_qa_reports` rows. (Not just dump files.)
2. **View Report opens the in-house HTML viewer** — backfilled rows must carry parsed `items` so the existing `buildQaReportHtml` viewer renders them, identical to email-ingested rows.
3. **One-time backfill** — no portal upload UI. Future audits keep arriving via the existing Operandio → SendGrid email ingestion.
4. **Archive only** — PDFs are stored in Storage but **not** linked in the UI. No "Download PDF" button. **Frontend is unchanged.**
5. **Scan Downloads automatically** — the script globs Downloads for audit-named PDFs and validates each by content; no manual file prep.

## Key facts that shape the design

- **Both filename families are the same artifact.** `pt_audit-<instanceId>-<ts>.pdf` (machine export) and `Springfield-MC Audit-May 2026.pdf` (hand-renamed) are both Operandio Job Report PDFs. Filenames have typos ("Apirl", "Audit Audit") and are **ignored**; the PDF text layer is authoritative.
- **Each PDF is fully self-describing** (verified on real samples):
  - Page 1: `<Department> | <Location> | Submitted <Mon D, YYYY>`, `Submitted <Mon D, YYYY, h:mmAM/PM TZ> by <Name>`, `Location <Club>`, overall `<pct>% Score`.
  - Page 2 "Job Scoring": `Overall <achieved> <possible> <pct>%` and a "Scoring by section" table of `<Step> <achieved> <possible> <pct>%`. Non-scored steps (e.g. `Comments`, `Auditor Name:`) show `-` and must be **excluded**.
- **The HTML viewer derives per-item max** as `score_possible / items.length` when it divides evenly, else falls back to 10 (`qaReportHtml.js:31`). Audits are uniformly 5 points/section, so **`items` must contain only scored sections** — otherwise the division breaks and rendering is wrong.
- **Existing `items` shape** (from `operandio_qa_reports`): `[{ n, at, by, name, score }]` where `score` is the achieved points (integer), `name` is the section name, `by`/`at` are the completer + timestamp.
- **Existing upsert key**: the webhook upserts `operandio_qa_reports` with `onConflict: 'location_slug,job_name,submitted_date'` (operandio.js:255). That unique constraint already exists. `job_name` is `"<Department> (<Mon D>)"`, e.g. `"Front Desk Audit (Jun 5)"`.
- **Existing storage pattern**: `supabaseAdmin.storage.from('operandio-attachments').upload(path, buffer, { contentType, upsert })` (operandio.js:178). Private bucket `operandio-attachments` already exists.
- `supabaseAdmin` is built in `auth/src/services/supabase.js` from `auth/.env` (service-role key). Scripts in `auth/scripts/` already use these creds (per established pattern).

## Architecture

Three pieces. No frontend changes.

### 1. Migration `auth/migrations/031_operandio_audit_pdf.sql`

Add two columns to `operandio_qa_reports`:

- `pdf_path text` — Storage object path of the archived PDF (null for email rows).
- `source text not null default 'email'` — `'email'` for the existing pipeline, `'pdf_backfill'` for these rows. Lets the backfill be idempotent and never clobber email-ingested truth.

No change to the existing unique constraint `(location_slug, job_name, submitted_date)`.

### 2. PDF parser `auth/src/lib/operandioAuditPdf.js`

Pure, unit-testable module. Input: extracted PDF text (string). Output: a normalized record or a skip reason.

```
parseAuditPdfText(text) -> {
  ok: true,
  locationSlug, department, jobName,
  submittedDate,        // 'YYYY-MM-DD' Pacific
  submittedAt,          // ISO timestamptz
  submittedBy,          // 'Steve Vedder'
  scoreAchieved, scorePossible, scorePct,  // ints; pct rounded
  items: [{ n, at, by, name, score }]      // scored sections only
} | { ok: false, reason }
```

Rules:
- **Validate it's a real submitted audit**: must contain `Job Report`, a `Submitted … by <Name>` line, an `Overall <a> <p> <pct>%` row, a `Location <Club>` resolving to a known `LOCATION_NAMES` club, and a department matching `/audit/i`. Anything failing → `{ ok:false, reason }` (covers blank templates and the odd `Ryan G PT Audit Nov-Feb.pdf`).
- **Department normalization**: strip a trailing parenthetical (`PT Audit (Monthly)` → `PT Audit`). Resulting `auditKey()` slug must match the Admin → Audits toggle keys (`pt_audit`, `front_desk_audit`, `membership_coordinator_audit`, `group_x_audit`, `childcare_audit`).
- **`jobName`** = `"<Department> (<Mon D>)"` from the submitted date (matches the email pipeline so the unique key behaves identically).
- **`items`**: parse the "Scoring by section" rows; keep only rows with numeric achieved+possible. `score` = achieved; `name` = step; `by` = the overall submitter; `at` = the submitted timestamp string. (Per-step timestamps on later pages are not needed and the email pipeline also uses a shared timestamp.)
- All dates/times computed in `America/Los_Angeles` (consistent with `pacificToday()` and the rest of the app).

### 3. Backfill script `auth/scripts/backfill-operandio-audit-pdfs.js`

Run locally (`node auth/scripts/backfill-operandio-audit-pdfs.js [--dir=<path>] [--dry-run]`), because the PDFs live on Justin's machine.

Flow:
1. Resolve source dir (default `%USERPROFILE%\Downloads`). Glob candidate audit PDFs by filename (`*audit*.pdf`, `*Audit*.pdf`, `*_audit-*.pdf`) — filename is only a cheap pre-filter.
2. For each candidate: extract text with **`pdf-parse`** (new dependency in `auth/`), run `parseAuditPdfText`. Collect `ok` records; log every skip with its reason.
3. **Dedupe** the `ok` records by `(locationSlug, jobName, submittedDate)` — the two filename families collapse to one row; keep the first.
4. **Idempotency / safety**: for each deduped record, look up an existing row by the unique key. If one exists with `source = 'email'` (or legacy null), **skip** (never overwrite live email data). Otherwise upsert (insert, or update a prior `pdf_backfill` row so re-runs correct parse fixes).
5. Upload the PDF to `operandio-attachments` at `audit-backfill/<club>/<dept-slug>/<submittedDate>-<shortHash>.pdf` (`upsert: true`), set `pdf_path`.
6. Upsert the row: all parsed fields + `items` + `pdf_path` + `source='pdf_backfill'` + `report_url: null` (no reliable URL in the PDF text layer).
7. Print a summary: parsed / skipped (by reason) / inserted / updated / uploaded, broken down by club + department + month.

`--dry-run` does steps 1–4 and prints the would-write rows + skips, writing nothing to Storage or DB. **Run dry-run first and eyeball it before the real run.**

## Data flow

```
Downloads/*.pdf
  └─ glob candidates ─▶ pdf-parse(text) ─▶ parseAuditPdfText
        ├─ ok ──▶ dedupe by (club, jobName, date)
        │            └─ existing email row? ─ yes ▶ skip
        │                                    └ no ▶ upload PDF ▶ upsert operandio_qa_reports (source=pdf_backfill)
        └─ skip ─▶ logged with reason
                                   ▼
              Audits report (unchanged) reads operandio_qa_reports
              View Report ▶ openAuditReport ▶ buildQaReportHtml(items)
```

## Error handling

- Per-file failures (corrupt PDF, parse miss, upload error) are caught, logged with the filename + reason, and do **not** abort the batch.
- Storage upload uses `upsert: true` so a re-run replaces a previously uploaded object instead of erroring.
- Score pct stored as a rounded integer (matches existing rows). Achieved/possible stored as parsed integers.
- A record that parses but whose `score_possible` is not evenly divisible by `items.length` is logged as a warning (it would render with the /10 fallback) so it can be inspected; it is still written.

## Testing

- **Unit tests** for `parseAuditPdfText` against text fixtures captured from the two real sample PDFs (MC Audit / Springfield and PT Audit / Clackamas): assert location, department, date, score triple, item count, and that non-scored steps are excluded and `score_possible % items.length === 0`.
- A negative fixture (blank "WCS Audit Forms" template text) asserts `{ ok:false }`.
- **Manual end-to-end**: `--dry-run` over Downloads, eyeball the summary; then real run; then open the Audits report for Springfield/Clackamas and confirm departments, latest %, trend points, and that "View Report" renders the branded HTML with correct sections.

## Out of scope (YAGNI)

- No portal upload UI.
- No "Download original PDF" link / signed-URL endpoint.
- No frontend changes whatsoever.
- No Medford/Milwaukie (no PDFs exist for them).
- `report_url` is left null for backfilled rows (the "Open in Operandio" footer link simply won't show, which is fine).

## Files touched

- `auth/migrations/031_operandio_audit_pdf.sql` (new)
- `auth/src/lib/operandioAuditPdf.js` (new)
- `auth/src/lib/__tests__/operandioAuditPdf.test.js` (new)
- `auth/scripts/backfill-operandio-audit-pdfs.js` (new)
- `auth/package.json` (+`pdf-parse`)
