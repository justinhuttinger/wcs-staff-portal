# Quiz Funnels — Design

**Date:** 2026-09-25
**Status:** Approved in chat, pending written-spec review
**Repos:** `wcs-staff-portal` (auth + portal), `wcs-forms-renderer` (public pages)

## Goal

Marketing can build multi-step "quiz funnel" lead pages (one question per
screen, contact capture at the end) inside the portal's Marketing folder, run
one quiz at several clubs, and have every submission:

1. land in a Google Sheet (one column per question, answer in the cell), and
2. POST to that club's GHL inbound webhook (questions + answers included), and
3. be attributed in GHL via the club's External Tracking script, with optional
   Meta Pixel and GTM tracking on the page.

It works like the existing Form Builder and reuses its storage, Sheets sync,
retry sweep, sharing and audit.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Quiz logic | Plain multi-step survey. No scoring/outcomes. |
| Architecture | A quiz is a **mode of Forms** (`forms.kind = 'quiz'`), not a separate module. |
| Location in portal | New **Quiz Funnels** tile in the Marketing folder, next to Forms. |
| Clubs | One quiz is active at any set of clubs. Per club: active flag, GHL webhook URL, GHL tracking snippet. |
| URL | `forms.westcoaststrength.com/q/<club>/<slug>` (e.g. `/q/salem/find-your-fit-k3x9`). `<club>` = lowercase club name (`getLocationBySlug` convention). |
| Sheet | One spreadsheet per quiz, with a **Club** column. |
| Tracking | Per club: GHL External Tracking. Per quiz: Meta Pixel ID, GTM container ID. |
| Webhook | JSON with contact fields top-level, `answers` object keyed by question text, and ordered `questions` array. Retried by the existing 10-min sweep. |

## Out of scope (v1)

Scoring/outcome results, branching logic, per-club default tracking IDs,
A/B variants, custom domain, analytics dashboard beyond the submissions list.

---

## 1. Data model — migration `208_quiz_funnels.sql`

```sql
-- forms gets a kind; existing rows stay 'form'
alter table forms add column kind text not null default 'form'
  check (kind in ('form','quiz'));
create index forms_kind_idx on forms(kind);

-- one row per club a quiz runs at
create table quiz_clubs (
  id               uuid primary key default gen_random_uuid(),
  form_id          uuid not null references forms(id) on delete cascade,
  location_id      uuid not null references locations(id),
  active           boolean not null default true,
  ghl_webhook_url  text,          -- https only, validated in app
  ghl_tracking_src text,          -- script src parsed from the pasted snippet
  ghl_tracking_id  text,          -- data-tracking-id, e.g. tk_abc...
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (form_id, location_id)
);
alter table quiz_clubs enable row level security;   -- service-role only, like forms

-- submissions remember the club + webhook delivery state
alter table form_submissions
  add column location_id      uuid references locations(id),
  add column webhook_status   text not null default 'none'
    check (webhook_status in ('none','pending','sent','failed')),
  add column webhook_attempts int  not null default 0,
  add column webhook_error    text;
create index form_submissions_webhook_retry_idx
  on form_submissions(webhook_status) where webhook_status in ('pending','failed');
```

The migration also:
- Adds the `form_audit_log` action-check values the quiz routes need
  (`clubs_updated`, `webhook_test`, `webhook_retry`).
- Seeds `permission_catalog('quizzes','Quiz Funnels','Tools','admin')` and
  `role_tool_visibility` on for admin only, following migrations 078 and 080.

The exact column types for `locations.id` and the audit check constraint are
copied from 078 at implementation time.

**Quiz-only settings** live in the existing `forms.settings` jsonb:

```json
{
  "contact_step": {
    "heading": "Where should we send your plan?",
    "subtext": "",
    "require_first_name": true, "require_last_name": false,
    "require_phone": true            // email is always shown + required
  },
  "thank_you": { "heading": "You're in!", "message": "", "redirect_url": "" },
  "tracking":  { "meta_pixel_id": "", "gtm_id": "" }
}
```

Quizzes are created with `location_id = NULL` because they belong to clubs via
`quiz_clubs`. The sheet is titled `"<Title> (Quiz)"` and filed in a
`Quiz Funnels` Drive subfolder under `forms_drive_folder_id`.

**Questions** reuse the Forms `schema` array and its field types
(`radio, checkbox, dropdown, short_text, long_text, number, email, phone, date`).
Each input field is one screen. The quiz builder does not offer the display
types (`header`, `description`); instead, each question gets an optional
`help_text` subtext. The form's `description` becomes an optional intro
screen: if it's empty, the quiz opens on question 1.

## 2. Backend (auth/)

### Validation — `services/quizSchema.js` (new, pure, unit tested)
- `parseGhlTrackingSnippet(text)` accepts either the pasted `<script ...>` tag or
  a bare `tk_` id plus an existing src, and returns `{src, trackingId}` or an error.
  - `src` must be `https:`, its path must end in `/js/external-tracking.js`, and
    its host must end in `msgsndr.com`, `leadconnectorhq.com`, `gohighlevel.com`
    or `westcoaststrength.com` (the white-label link domain).
  - `trackingId` must match `/^tk_[A-Za-z0-9]{8,64}$/`.
- `validateTracking({meta_pixel_id, gtm_id})`: pixel `/^\d{6,20}$/`, GTM
  `/^GTM-[A-Z0-9]{4,12}$/`. Both optional.
- `validateWebhookUrl(url)`: `https:` only, max 1000 characters.
- `validateContact(contact, contactStep)`: email is required and must be
  well-formed. Name and phone are required per settings. Phone is normalised
  with the existing NANP normaliser in `formsSchema`.
- `buildWebhookPayload({form, club, submission})`: the payload in §4.
- `quizSheetFields(form)`: the pseudo-fields `club, first_name, last_name, email,
  phone` placed ahead of the question fields, so `formsSheets.computeColumns`
  keeps its append-only guarantees.

### Routes
- **Shared handlers.** The CRUD handlers in `routes/forms.js` (get, patch,
  publish, archive, delete, shares, audit, submissions, retry-sync) move into a
  small factory, `routes/formsHandlers.js`. It is mounted twice:
  - `/forms` with `requireFormsBuilder` and `kind = 'form'`
  - `/quizzes` with `requireQuizBuilder` (admin tier or the `quizzes` grant) and `kind = 'quiz'`

  Every by-id handler 404s when the row's `kind` doesn't match its mount, so
  neither permission can reach the other kind's rows. `GET /forms` filters to
  `kind = 'form'`, which keeps quizzes out of the existing Forms list.
- **Quiz-only endpoints** (`routes/quizzes.js`):
  - `GET /quizzes/:id/clubs` returns every club with its `quiz_clubs` row, or
    blanks if it has none.
  - `PUT /quizzes/:id/clubs` bulk-upserts club rows (validated) and records the
    `clubs_updated` audit entry.
  - `POST /quizzes/:id/clubs/:locationId/test-webhook` posts a sample payload
    (`"test": true`, sample answers taken from the question options) and returns
    GHL's status code and first 500 characters of its response. Rate-limited to
    10 per minute. Records a `webhook_test` audit entry.
  - `GET /quizzes/:id/submissions?location_id=` is the shared list plus club
    name and webhook fields.
  - `POST /quizzes/:id/submissions/:subId/retry-webhook` resends one failed
    submission's webhook.
- **Public** (`routes/publicQuizzes.js`, mounted at `/public/quizzes`, no auth,
  covered by the existing CORS origin forms.westcoaststrength.com):
  - `GET /:club/:slug` requires a published quiz and an active club row. It
    returns title, description, questions, `contact_step`, `thank_you`, the
    club display name, and
    `tracking: {ghl: {src, tracking_id} | null, meta_pixel_id, gtm_id}`.
    **The webhook URL is never returned.** Anything else gets a 404.
  - `POST /:club/:slug/submit` is rate-limited to 20 per minute like forms.
    The body is `{answers, contact, utm}`. Steps:
    1. `validateSubmission(schema, answers)` and `validateContact`. Failure
       returns 400 `{errors}`.
    2. `sanitizeUtm`.
    3. Insert into `form_submissions` with `data = {...answers, club, first_name,
       last_name, email, phone}`, `location_id`, `utm`, and
       `webhook_status = 'pending'` (or `'none'` if the club has no URL).
    4. Record the `submission_received` audit entry.
    5. Respond `{ok: true, redirect_url}`.
    6. After responding, fire `appendSubmission` and `deliverWebhook`. Neither
       failure affects the lead.
  - `/public/forms/:slug` refuses `kind = 'quiz'` (404), so a quiz can't be
    submitted without a club.

### Webhook delivery — `services/quizWebhook.js`
- `deliverWebhook(submissionId)` loads the submission, quiz and club row,
  builds the payload and POSTs JSON with a 10s timeout.
  - 2xx: `sent`.
  - Otherwise: `failed`, `webhook_attempts + 1`, and `webhook_error`
    (status + first 300 characters).
- **Retry:** the existing 10-minute sweep in `formsSheets.start()` also calls
  `retryWebhooks()`. It picks rows with `webhook_status in ('pending','failed')`,
  `webhook_attempts < 5`, submitted in the last 7 days, oldest first, 100 per
  sweep. `pending` rows only qualify after 2 minutes, which avoids racing the
  first send. After 5 attempts a row stays `failed`, and the portal Retry
  button can still resend it.
- If a club's URL is later removed, its pending rows become `none` on the next sweep.

### Sheets
- `appendSubmission` / `ensureSheet` get the quiz pseudo-fields via
  `quizSheetFields`. Header order for a new quiz:
  `Submitted At | Club | First Name | Last Name | Email | Phone | <Q1> | <Q2> … | utm_source | utm_medium | utm_campaign`.
- Questions added later append per the existing append-only rules.
- Checkbox answers are joined with `", "`.
- Renaming a question renames its header only; the column never moves.

## 3. Portal UI

- **Tile:** in `ToolGrid.jsx`, `marketingCells` gains **Quiz Funnels**, gated by
  `isAdmin || visible_tools.includes('quizzes')`. App.jsx gains the
  `showQuizzes` wiring: state, reset lists, pinnable entry `tool:quizzes`,
  active-key mapping, and a render branch. Also update `portalTiles.js`,
  `CUSTOM_TILE_KEYS`, the custom-board case, and a `changelog.js` entry.
- **`QuizFunnelsView.jsx`:** list with search, status filter
  (Active/Archived/All), club filter, and a create modal (title only). Cards
  show title, status, "Live at N clubs" and submission count.
- **Builder:** reuses `FormBuilder.jsx` with a `kind` prop that switches the API
  client (`forms` vs a new `quizzes` client in `lib/api.js`), hides display
  field types, and swaps tabs. The new quiz tabs are separate files so
  FormBuilder (already 672 lines) doesn't grow much:
  - **Questions:** the existing field editor, plus a one-question-per-screen
    preview.
  - **Contact:** `QuizContactPanel.jsx` holds the heading, subtext and required
    toggles. The email toggle is shown locked on.
  - **Clubs:** `QuizClubsPanel.jsx` has one row per club with:
    - an Active toggle
    - a webhook URL field
    - a "Paste GHL tracking snippet" textarea that shows the parsed `tk_` id
      and a ✓ or an error
    - **Send test**, which shows GHL's response
    - **Copy link** (with a "Copied!" confirmation), for the published quiz only
  - **Tracking:** `QuizTrackingPanel.jsx` holds the Meta Pixel ID and GTM ID,
    validated inline.
  - **Settings:** thank-you heading, message and redirect URL.
  - **Submissions:** `QuizSubmissionsPanel.jsx` has an Open Sheet button, a
    club filter, and recent rows showing name, email, club, time and a webhook
    badge (sent / retrying n/5 / failed + error tooltip) with a **Retry** button.
  - **Share / Audit:** the existing panels.
- **Dark-backdrop rule:** every content block sits in a card, per the portal convention.

## 4. Webhook payload

```json
{
  "event": "quiz_submission",
  "test": false,
  "quiz": "Find Your Fit",
  "quiz_slug": "find-your-fit-k3x9",
  "club": "Salem",
  "club_slug": "salem",
  "first_name": "Jane", "last_name": "Doe",
  "email": "jane@example.com", "phone": "(503) 555-0101",
  "answers": {
    "What's your main goal?": "Lose weight",
    "Which days work for you?": "Mon, Wed, Fri"
  },
  "questions": [
    { "question": "What's your main goal?", "answer": "Lose weight" },
    { "question": "Which days work for you?", "answer": "Mon, Wed, Fri" }
  ],
  "utm_source": "meta", "utm_medium": "cpc", "utm_campaign": "fall-promo",
  "page_url": "https://forms.westcoaststrength.com/q/salem/find-your-fit-k3x9",
  "submission_id": "uuid",
  "submitted_at": "2026-09-25T18:04:11.000Z"
}
```

Unanswered optional questions send `""`. If two questions share the same text,
the later key in `answers` gets a ` (2)` suffix; `questions` keeps both.
`page_url` is sent by the renderer and capped at 500 characters.

## 5. Public renderer (wcs-forms-renderer)

- **Routing** (`App.jsx`): add `^/q/([a-z-]+)/([a-z0-9-]+)$` →
  `<QuizPage club slug>`. The `/f/<slug>` route is untouched.
- **`QuizPage.jsx`:**
  - Fetches `GET /public/quizzes/:club/:slug`. A 404 shows "This quiz isn't
    available."
  - Screens: optional intro, then one question per screen, then contact, then
    thank-you (or a redirect).
  - A progress bar shows the question number out of the total.
  - Radio and dropdown questions render as large tap cards and **auto-advance**
    on tap. Checkbox, text, number and date questions get a **Next** button.
    Required fields block Next with an inline error. **Back** keeps answers.
  - The contact screen is a real `<form>` with `name="first_name"`,
    `name="last_name"`, `type="email" name="email"` and
    `type="tel" name="phone"` inputs, visible in the DOM, so GHL External
    Tracking captures it. We handle `onSubmit` ourselves (`preventDefault`) and
    POST to our API.
  - The existing UTM capture and phone auto-format are reused. `richText` is
    used for description and help text.
  - 429 shows the slow-down notice. A 400 on answers jumps back to the first
    question with an error.
- **`tracking.js`** (new) is injected once after the quiz loads, and only for
  IDs that are set:
  - **GHL:** `<script src={src} data-tracking-id={id} defer>` appended to the end
    of `<body>`, which is where GHL's docs place it.
  - **Meta:** the standard `fbq` base code, `fbq('init', id)`,
    `fbq('track','PageView')`, and `fbq('track','Lead')` after a successful submit.
  - **GTM:** the standard container snippet. `dataLayer` events:
    - `quiz_start` with `{quiz, club}`
    - `quiz_step` with `{quiz, club, step, total}`
    - `quiz_submit` with `{quiz, club}`
  - IDs are re-validated client-side with the same regexes before injection.
- Mobile-first styling reuses `styles.css` tokens. Deploy is unchanged: Workers
  Builds deploys `main` automatically.

## 6. Error handling summary

| Failure | Behavior |
|---|---|
| Quiz unpublished / club inactive / unknown club | Public GET and submit return 404; the page says it's unavailable. |
| Invalid answers or contact | 400 `{errors}`, shown inline. |
| Sheets append fails | Existing `sync_error` + 10-min retry + admin Retry Sync. |
| Webhook fails | `failed` + error, retried up to 5 times over the 10-min sweep, manual Retry in the portal. |
| Club has no webhook URL | `webhook_status = 'none'`, Sheet still written. |
| Tracking ID invalid | Rejected at save in the portal and skipped in the renderer. |

## 7. Testing

- **auth unit tests** (`node --test`, next to each service):
  - `quizSchema.test.js`: snippet parsing (good snippet, bare id, bad host,
    http, missing id), tracking validators, contact validation, payload
    building (duplicate question text, checkbox join, blank optional answers).
  - `quizWebhook.test.js`: status transitions (2xx, 500, timeout), attempt cap,
    pending-age gate, and the `none` downgrade. `fetch` is injected.
  - `formsSheets.test.js` additions: quiz header order and appending a new
    question after publish.
  - Route-level tests: kind isolation (a form id on `/quizzes` returns 404 and
    vice versa), public GET never includes `ghl_webhook_url`, inactive club
    returns 404, and `/public/forms` refuses quizzes.
- **Renderer:** `npm run build` stays clean, plus a manual click-through.
- **End to end, before links go out:** one quiz, one club, pointed at a test
  GHL inbound webhook:
  - "Send test" maps fields in GHL.
  - A real submission lands in the Sheet with the Club column filled, the
    webhook shows `sent`, and the contact appears in GHL with External
    Tracking attribution.
  - The Meta Pixel Helper and GTM preview both show their events.

## 8. Delivery

1. **Portal PR** (`feat/quiz-funnels`): migration 208 + backend + portal UI.
   Migration applied to prod at merge, with Justin's explicit OK.
2. **Renderer PR** (`wcs-forms-renderer`, base `main`): `/q/` route, QuizPage,
   and tracking. Merge after the portal PR is live. Until then the renderer's
   `/q/` pages just 404 gracefully.

Justin merges both. No auto-merge.

## Ops checklist (no code)
- Per club: copy the GHL snippet from Settings → External Tracking, and create
  an Inbound Webhook workflow trigger in GHL, then paste both into the Clubs tab.
- Optional: the Meta Pixel ID and GTM container for the quiz.
