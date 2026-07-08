# WCS Form Builder & Submission System — Design

**Date:** 2026-07-08
**Owner:** Justin (Director of Operations)
**Status:** Approved (all open questions resolved with Justin 2026-07-08)

Replaces Jotform (free plan, 5 forms / 100 submissions per month) with an internal form
builder in the WCS Staff Portal. Staff create flat forms (no conditional logic), public
submissions append to Google Sheets with a Supabase backup, and forms carry a sharing
model plus an append-only audit trail. Primary use case: event signups.

## Resolved decisions (Justin, 2026-07-08)

1. **Google auth:** reuse the shared **Google Business OAuth account** (refresh token in
   Supabase `app_config` key `google_business_tokens`, client `GOOGLE_BUSINESS_CLIENT_ID/SECRET`).
   No service account exists in the ecosystem and none is introduced.
2. **Builder access:** `manager` tier and above (manager, corporate/director, admin).
   Leads are NOT included by default; a `forms` RBAC v2 catalog key allows granting
   builder access to custom roles or individuals.
3. **Sheets layout:** **one spreadsheet file per form**, created on first publish, inside a
   WCS-owned shared drive folder (folder ID configured in an admin setting).
4. **Public URL:** `https://forms.westcoaststrength.com/f/:slug` — a standalone renderer
   deployed on **Cloudflare Pages** from its own private repo (same Git-connect pattern as
   `wcs-7day-trial`). Justin attaches the repo to Cloudflare and sets DNS at the end.
5. **Design:** builder matches the portal design system exactly (bg-surface cards over the
   dark backdrop, wcs-red, Inter, rounded-xl). Public renderer borrows the online-join
   editorial look: white card, light background, red primary button, mobile-first.
6. **Copy rule:** no em dashes anywhere in UI copy, labels, or generated text.

## Codebase facts this design is built on (verified 2026-07-08)

- Repo `wcs-staff-portal`: `auth/` (Express API on Render, pnpm) + `portal/` (React 19 +
  Vite 8 + Tailwind 4). Supabase accessed ONLY via service role (`supabaseAdmin`); every
  table gets RLS enabled with no policies (migration 035 convention).
- The Supabase JWT carries no role/location. `auth/src/middleware/auth.js` resolves
  `req.staff` per request: staff row + `staff_locations` junction. Handlers receive
  `req.staff.location_ids` (uuid[]), `primary_location_id`, `role`. Staff can be
  multi-location. No Auth Service extension needed (spec section 4 blocker: RESOLVED).
- Role hierarchy (`auth/src/middleware/role.js`): `team_member < lead < custom < manager
  < corporate < marketing(legacy) < admin`. Aliases: `front_desk`/`personal_trainer` ->
  `team_member`, `director` -> `corporate`. RBAC v2: `permission_catalog` +
  `role_tool_visibility` + `staff_permission_overrides`; gate via
  `requireReportAccess(minRole, [grantKeys])` pattern.
- Canonical location identifier: `locations.id` uuid. Slugs (`salem` ... `medford`) are
  derived from `locations.name` at runtime (`utils/locationSlug.js`,
  `services/locationScope.js`). Store uuids on rows.
- Migrations: `auth/migrations/NNN_snake_case.sql`, raw SQL applied in order. Highest
  existing = `077`. **This module uses `078_form_builder.sql`.**
- Route mounting: `auth/src/index.js`, one router per feature, per-route `authenticate`.
  Public routers mount without authenticate (pattern: `/public/tour`). Global CORS
  whitelist `ALLOWED_ORIGINS` at `index.js` top; add `https://forms.westcoaststrength.com`.
  Path-specific body parsers must register BEFORE the global `express.json()`.
- Existing audit pattern: `audit_log` table + fire-and-forget `services/auditLog.js`.
  This module gets its own `form_audit_log` (per-form timeline requirement) but mirrors
  the fire-and-forget writer style.
- Google plumbing that exists: Sheets create + batchUpdate in
  `auth/src/services/googleSheets.js` (NO append support yet; its Drive move lacks
  `supportsAllDrives`), shared-drive-correct Drive calls in
  `ghl-sync/src/google/driveClient.js` (`supportsAllDrives=true`,
  `includeItemsFromAllDrives=true`, `corpora=allDrives`), Business token refresh against
  `oauth2.googleapis.com/token`. All Google calls are hand-rolled `fetch`, no googleapis
  npm package; keep it that way.
- Portal: no router (App.jsx boolean state machine), no component library, no drag
  library. Tiles in `ToolGrid.jsx` gated by `ROLE_LEVELS`; grantable keys in
  `portal/src/config/portalTiles.js` + server allow-list in `auth/src/routes/admin.js`.
  API client `portal/src/lib/api.js` (Bearer token, 401 refresh-retry). Copy buttons use
  the local `copiedField` + 1.5s timeout pattern. Mobile sheets must `createPortal` to
  `document.body` at `z-[60]`.

## Architecture

Three deliverables:

1. **Backend** in `wcs-staff-portal/auth`: migration 078, authed router `routes/forms.js`,
   public router `routes/publicForms.js` (mounted at `/public/forms`), services
   `formsPermissions.js`, `formsSheets.js`, `formsAudit.js`, RBAC catalog seed, retry sweep.
2. **Builder UI** in `wcs-staff-portal/portal`: Forms tile + `FormsView` (list, builder,
   sharing, QR, audit timeline), `forms` API namespace in `api.js`, `qrcode` dependency.
3. **Public renderer**: new private repo `wcs-forms-renderer` (working copy on Desktop,
   like the other Cloudflare repos), tiny Vite React app, `_redirects` SPA rule
   (`/* /index.html 200`) so `/f/:slug` works on Cloudflare Pages, calls the auth API.

## Data model (migration `078_form_builder.sql`)

All tables: RLS enabled, no policies (service-role only).

### `forms`
| column | type | notes |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| slug | text UNIQUE NOT NULL | slugified title + 4-char random suffix, immutable after create |
| title | text NOT NULL | |
| description | text | optional intro shown on the public form |
| schema | jsonb NOT NULL default '[]' | ordered field array, see Field schema |
| owner_id | uuid NOT NULL REFERENCES staff(id) | |
| location_id | uuid NOT NULL REFERENCES locations(id) | stamped at creation |
| visibility | text NOT NULL default 'private' CHECK in ('private','location','shared') | |
| location_can_edit | boolean NOT NULL default false | only meaningful when visibility='location' |
| status | text NOT NULL default 'draft' CHECK in ('draft','published','archived') | |
| sheet_id | text | Google spreadsheet file ID, set on first publish |
| sheet_tab | text | tab name (default 'Submissions') |
| sheet_columns | jsonb NOT NULL default '{}' | field_id -> 1-based column index; append-only |
| created_at | timestamptz default now() | |
| updated_at | timestamptz default now() | bumped on every save; last-write protection token |

### `form_submissions`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| form_id | uuid NOT NULL REFERENCES forms(id) | |
| data | jsonb NOT NULL | field_id -> value map |
| submitted_at | timestamptz default now() | |
| synced_to_sheet | boolean NOT NULL default false | |
| sync_error | text | last Sheets failure message, for admin visibility |

Index on `(form_id, submitted_at)` and partial index on `synced_to_sheet = false`.

### `form_shares`
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| form_id | uuid NOT NULL REFERENCES forms(id) ON DELETE CASCADE | |
| staff_id | uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE | |
| permission | text NOT NULL CHECK in ('viewer','editor') | |
| granted_by | uuid REFERENCES staff(id) | |
| created_at | timestamptz default now() | |
| | | UNIQUE (form_id, staff_id) |

### `form_audit_log` (append-only)
| column | type | notes |
|---|---|---|
| id | uuid PK | |
| form_id | uuid NOT NULL | no FK cascade delete; audit must survive |
| actor_id | uuid | staff id; null for public submission events |
| action | text NOT NULL CHECK in ('created','edited','published','archived','deleted','shared','unshared','permission_changed','visibility_changed','submission_received','sheet_retry') | |
| detail | jsonb | diff/snapshot; share actions carry target staff_id + permission |
| created_at | timestamptz default now() | |

Append-only enforced with a trigger: `BEFORE UPDATE OR DELETE ON form_audit_log` raises
an exception. (Service role bypasses RLS, so a trigger is the only real enforcement.)

Forms are never hard-deleted once they have submissions; `deleted` action + status
`archived` is the terminal state. A draft with zero submissions may be hard-deleted
(audit rows kept).

## Field schema (forms.schema jsonb)

Ordered array. Element shape:

```json
{
  "id": "f_a1b2c3",
  "type": "short_text|long_text|email|phone|number|dropdown|radio|checkbox|date|header|description",
  "label": "Your name",
  "required": true,
  "placeholder": "optional",
  "options": ["A", "B"],
  "help_text": "optional"
}
```

- `id` generated client-side (`f_` + 6 random alphanumerics), immutable once saved
  (Sheets columns map to it).
- `header`/`description` are display blocks: no input, `required` ignored, never written
  to Sheets, excluded from `sheet_columns`.
- `options` only for dropdown/radio/checkbox. `checkbox` = multi-select; its submitted
  value is an array, serialized to Sheets as comma-joined text.
- Server-side validation on save: types in whitelist, non-empty labels for input fields,
  options present and non-empty for option types, unique ids.
- Extension point: the type whitelist and renderer switch are single-point registries so
  file-upload/signature can be added later without schema migration. Do not implement them.

## Permission logic

Single function `canAccessForm(staff, form, shares) -> { view, edit }` in
`auth/src/services/formsPermissions.js`, evaluated in order, first match wins:

1. `roleLevel(staff.role) >= roleLevel('corporate')` or role resolves to `admin` ->
   `{view:true, edit:true}` for ALL forms. (Director == corporate alias.)
2. `staff.id === form.owner_id` -> full access.
3. `form.visibility === 'location'` and `form.location_id ∈ staff.location_ids` ->
   view; edit only if `form.location_can_edit`.
4. A `form_shares` row for this staff -> viewer = view, editor = view+edit.
5. Otherwise no access: form absent from lists, 403 on direct fetch.

Builder entry (create forms, see the tile): manager+ via the RBAC v2 pattern with grant
key `forms`, i.e. a `requireFormsAccess` middleware equivalent to
`requireReportAccess('manager', ['forms'])` semantics (below-tier users pass if they hold
an effective `forms` permission). Catalog row seeded in migration 078:
`permission_catalog (perm_key='forms', label='Forms', category='Tools')` plus
`role_tool_visibility` seeds for manager/corporate/admin. Portal side adds key `forms`
to `portalTiles.js` catalog and the server allow-list.

The public renderer bypasses all of this: anyone with the URL can read the schema of a
`published` form and submit. Draft/archived return 404 on the public endpoints.

**Last-write protection:** `PATCH /forms/:id` requires `known_updated_at` in the body.
If the DB `updated_at` is newer, respond `409 {error, server_updated_at}`; the UI warns
"This form changed since you opened it" and offers reload. No merge, no collaboration.

## Google Sheets integration

New service `auth/src/services/formsSheets.js`, using the Google Business account token.
Token access: reuse/extract the existing Business token refresh used by
`routes/driveFolders.js` (auth side) into a shared helper if not already shared.
All calls hand-rolled `fetch`, matching `googleSheets.js` style.

- **Admin setting** `forms_drive_folder_id` (app-settings key-value store, surfaced in the
  Forms admin panel; accepts a pasted folder URL, parsed with the `extractFolderId`
  approach). The folder lives in the WCS shared drive, so access survives staff turnover.
- **First publish:** create spreadsheet named after the form title via
  `POST https://sheets.googleapis.com/v4/spreadsheets`, rename default tab to
  `Submissions`, move the file into the configured folder via Drive
  `PATCH /drive/v3/files/{id}?addParents=...&removeParents=...&supportsAllDrives=true`
  (the existing googleSheets.js move omits supportsAllDrives; this module must not).
  Write the header row (input-field labels in schema order, then `Submitted At`), store
  `sheet_id`, `sheet_tab`, and `sheet_columns` (field_id -> column index) on the form.
  Republishing after archive reuses the existing sheet.
- **Schema edits after publish:** for each NEW input field, append a column at the right
  end (header cell = label) and extend `sheet_columns`. Existing columns are NEVER
  remapped, reordered, or rewritten. Removed fields keep their column (historical data
  intact); label edits update the header cell only, mapping unchanged.
- **Submission flow** (`POST /public/forms/:slug/submit`):
  1. Load published form, validate payload against schema (required fields, email/phone/
     number/date formats, option membership, unknown field ids rejected).
  2. Insert `form_submissions` row (backup is never conditional on Sheets).
  3. Append to the sheet via
     `POST .../spreadsheets/{id}/values/{tab}!A1:append?valueInputOption=USER_ENTERED`
     mapping values through `sheet_columns`; blank cells for missing/removed fields;
     `Submitted At` in Pacific time.
  4. On success set `synced_to_sheet=true`; on failure store `sync_error` and return
     success to the submitter anyway (data is safe in Supabase).
  5. Audit `submission_received` (actor null, detail = submission id).
- **Retry path:** `setInterval` sweep in the auth service every 10 minutes: fetch
  unsynced submissions (published forms with sheet_id), re-append in submitted_at order,
  audit `sheet_retry` with counts. Plus a manual "Retry sync" button per form in the
  builder (admin/editors) hitting `POST /forms/:id/retry-sync`.
- Quota (~60 writes/min) is a non-issue for event signups; the retry sweep batches with
  one append call per submission and stops on repeated auth failure.

## API surface (auth service)

Authed router `routes/forms.js`, all routes `authenticate` + builder gate where noted;
every mutation writes `form_audit_log`:

- `GET /forms` — list, permission-filtered via `canAccessForm`; includes owner name,
  location, status, submission count, caller's `{view,edit}`.
- `POST /forms` — create (builder gate). Body: title, description, location_id (must be
  in caller's `location_ids` unless corporate/admin; single-location staff auto-stamp).
- `GET /forms/:id` — fetch for editing (view access), returns shares if edit access.
- `PATCH /forms/:id` — update title/description/schema/visibility/location_can_edit
  (edit access + last-write check).
- `POST /forms/:id/publish` — edit access; creates sheet on first publish.
- `POST /forms/:id/archive` — edit access.
- `DELETE /forms/:id` — owner or corporate/admin; only drafts with zero submissions
  hard-delete, otherwise 409 telling the caller to archive.
- `POST /forms/:id/shares` — edit access; body `{staff_id, permission}`; upsert.
- `DELETE /forms/:id/shares/:staffId` — edit access.
- `GET /forms/:id/audit` — view access; corporate/admin can also
  `GET /forms/audit/all?staff=&form=` across forms.
- `GET /forms/staff-directory` — id + display_name list for the share picker (builder gate).
- `POST /forms/:id/retry-sync` — edit access.
- `GET /forms/:id/submissions` — view access, paginated, for an in-portal peek
  (Sheets stays the primary consumption surface).

Public router `routes/publicForms.js` mounted at `/public/forms`, no authenticate:

- `GET /public/forms/:slug` — published only: title, description, schema (input +
  display blocks), location name. 404 otherwise.
- `POST /public/forms/:slug/submit` — validate + store + append; per-IP rate limit
  (simple in-memory bucket, e.g. 20/min) to keep bot noise down.

CORS: add `https://forms.westcoaststrength.com` to `ALLOWED_ORIGINS` in `index.js`.

## Builder UI (portal)

- **Tile:** "Forms" SvgTileButton in the Tools grid, visible at manager+ or effective
  `forms` permission; key added to `portalTiles.js` + server allow-list; view state
  `showForms` wired through App.jsx (state machine, reset blocks, `logEvent('view.forms')`).
- **FormsView** (own component tree under `portal/src/components/forms/`):
  - **List:** bg-surface cards/table: title, owner, location, status pill, submission
    count, updated. New Form button (wcs-red primary). Multi-location staff pick a
    location in the create modal; single-location staff skip it.
  - **Builder:** two-pane like AdminRolesV2Tab: left = ordered field list with up/down
    arrow reordering (no drag library exists in the codebase; arrows match convention),
    right = selected field's settings (label, type, required, placeholder, help text,
    options editor for option types). Add-field menu covers all 11 types incl. header +
    description blocks. Live preview column or toggle, styled like the public renderer.
    Save uses last-write token; on 409 shows the reload warning.
  - **Sharing panel:** visibility radio (Private / My location / Specific people),
    location-edit toggle, staff picker with viewer/editor per person, remove buttons.
  - **QR panel:** visible once published. `qrcode` npm package client-side, error
    correction H, WCS logo centered. PNG download (print) + SVG download (signage).
    Public URL shown with the standard copy button ("Copied!" pulse pattern).
  - **Audit tab:** per-form timeline (actor, action, detail, timestamp). Corporate/admin
    get an all-forms audit view with user/form filters.
  - Mobile: read-only list + QR/share access is fine; builder editing is desktop-first.
    Any mobile sheet must createPortal to document.body at z-[60].
- **Admin panel tile** "Forms" (Setup section): drive folder setting + unsynced
  submissions overview.
- api.js: `export const forms = { list, get, create, update, publish, archive, remove,
  shares, audit, retrySync, submissions, staffDirectory }` namespace object (newer-area
  convention).

## Public renderer (new repo `wcs-forms-renderer`)

- Vite + React, no router lib: parse `location.pathname` (`/f/:slug`), fetch schema,
  render, submit, thank-you state. `public/_redirects`: `/* /index.html 200`.
- Styling: online-join editorial direction. White rounded card on `#f6f6f4` light
  background, WCS logo header, Inter, red (#e53e3e) primary button, mobile-first,
  clean field spacing, inline validation messages. No em dashes in any copy.
- Config: `VITE_FORMS_API_URL` (auth API base). All URLs absolute so it works on any
  domain.
- States: loading, 404 ("This form is not available"), validation errors, submitting,
  success ("Thanks, you're signed up"), network-error retry.
- Deploy: private GitHub repo, Justin connects to Cloudflare Pages (framework Vite,
  build `pnpm build`, output `dist`) and attaches `forms.westcoaststrength.com`. QR
  codes encode `https://forms.westcoaststrength.com/f/:slug` regardless (env-configurable
  base in the portal QR panel so it works before DNS lands).

## Testing

- **Unit (vitest or node:test, match repo's existing test setup):** `canAccessForm` all
  branches + short-circuit order; submission validator (required, formats, options,
  unknown ids, checkbox arrays); sheet row mapping incl. removed/new fields; slug
  generation collision behavior; last-write 409.
- **Integration-ish:** route tests with a stubbed supabaseAdmin where the repo already
  does so; otherwise manual verification checklist.
- **End-to-end acceptance (§12 of Justin's spec, verified manually before rollout):**
  manager single-location auto-stamp; private invisible to peers, visible to
  corporate/admin; location-shared view vs edit toggle; explicit viewer vs editor;
  corporate/admin see all; every mutation writes an immutable audit row; concurrent edit
  warns; public submit appends correct row + Supabase backup; Sheets failure leaves
  backup retryable; QR PNG+SVG; post-submission field additions append columns without
  breaking rows; no em dashes.

## Out of scope (do not build)

Conditional logic, payments, file upload/signature (extension point only), real-time
collaboration, autoresponders/workflows.

## Delivery

- One feature PR on `wcs-staff-portal` (branch `feat/form-builder`, worktree
  `.claude/worktrees/form-builder`) containing auth + portal changes. Justin merges.
- Migration 078 applied to Supabase project `ybopxxydsuwlbwxiuzve` only with Justin's
  explicit consent (prod-write rule).
- New repo `wcs-forms-renderer` created locally (Desktop, next to the other Cloudflare
  repos) + pushed to a private GitHub repo; Cloudflare connect + DNS are Justin's steps.
- Ops steps for Justin at the end: create/choose the shared drive folder and paste it
  into the admin setting, connect Cloudflare Pages, add the DNS record.
