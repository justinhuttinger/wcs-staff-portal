# Till-Close Auto-Print — Design

**Date:** 2026-06-29
**Status:** Approved design, pending implementation plan
**Branch:** `feat/till-receipt-print`

## 1. Problem & Goal

When a gym closes its cash drawer for the night, staff submit a "Drawer Close
Count" in Operandio. We want a physical receipt to print automatically on the
printer at that gym, showing the till reconciliation (counted vs. expected,
over/short, bag-drop) plus the WCS logo and date.

The hard constraint: **the portal is cloud-hosted (Render) but the printer is
USB-attached at the gym.** The cloud cannot reach a USB printer directly. The
bridge is the **downloadable desktop app** (the Electron launcher, v1.6.0) that
already runs on the front-desk machine at each location. It becomes the local
**print agent**.

### Goals
- A till-close receipt prints automatically at the correct gym within ~30s of
  the Operandio drawer-close submission.
- An admin can, per location, see the gym's desktop device, pick which installed
  printer it uses, enable/disable printing, and fire a test print.
- An admin can wire "PM Till Closing submission → print" per location.

### Non-goals (v1 — YAGNI)
- A generic inbound print webhook for external systems (GHL/Zapier/ABC). The job
  queue is built generically so this is a small future add, but no external
  endpoint ships now.
- Near-instant (<5s) printing / push delivery (SSE/WebSocket). Pull at ~30s.
- Receipt-printer-specific formatting (Star TSP143 narrow paper). v1 prints to
  any installed Windows printer queue via `deviceName`; the narrow-paper layout
  is a later template variant.
- Signature lines or an over/short banner on the receipt.

## 2. Architecture

Three tiers, communicating over HTTP that the desktop **initiates** (no inbound
networking into the gym):

```
Operandio ──(email)──► Portal API (Render)  ◄──(poll every ~30s)── Desktop app (gym)
                        Supabase (Postgres)                         USB printer
```

- **Portal API** (`auth/` Express service): receives the Operandio submission
  (already), decides whether to enqueue a print job, serves the job to the
  desktop, renders the receipt HTML, records the result. New router `print.js`.
- **Supabase**: three new tables — device registry, job queue, automation rules.
- **Desktop app** (`launcher/` Electron): reports its installed printers, polls
  for jobs, prints the receipt HTML silently to the selected printer, acks.

### End-to-end flow
```
1. Staff submit "Drawer Close Count (Jun 29)" in Operandio at Salem.
2. Operandio emails the submission → POST /operandio/webhook  [EXISTS]
   - existing code parses job name + "Salem" and writes till_counts(close).
3. NEW hook maybeEnqueueTillReceipt(event):
   - Is there an ENABLED print_automation for this location whose job-name
     pattern matches "Drawer Close Count …"? If not, stop.
   - Does the location have an enabled print_device with a selected printer?
     If not, stop (optionally alert).
   - Build receipt data via tillReconcile (counted, expected, over/short,
     bag-drop, float, cash sales, cash-drop line items, closed-by).
   - INSERT a print_jobs row (status='pending', type='till_close', payload).
4. Desktop polls GET /print/jobs?install_id=… every ~30s, receives the job,
   marks it 'claimed'.
5. Desktop opens GET /print/receipt/:jobId (HTML: logo + date + reconciliation)
   in a hidden BrowserWindow → webContents.print({ silent:true,
   deviceName: selectedPrinter }).
6. Desktop POST /print/jobs/:id/ack { status:'printed' | 'failed', error? }.
   Status is visible in the admin Print Devices page.
```

## 3. Data Model (new migrations, numbered after till-cash-tracking merges)

> **Dependency:** these migrations and code depend on `feat/till-cash-tracking`
> (tables `till_counts`, `till_settings`, function `tillReconcile`) being merged
> to master first. Migration numbers continue from whatever that branch lands
> (master is at 066 today; till adds ~070–071, so these are ~072+).

### `print_devices`
One row per desktop install that can print. Extends the launcher install concept.
```
install_id        text PRIMARY KEY        -- from launcher config.json
location_id       uuid REFERENCES locations(id)
hostname          text
available_printers jsonb                  -- [{name, isDefault}] reported by desktop
selected_printer  text                    -- deviceName the admin chose
enabled           boolean DEFAULT false   -- printing on/off for this device
last_seen         timestamptz             -- updated on each poll/heartbeat
created_at        timestamptz DEFAULT now()
```

### `print_jobs`
Generic queue (only `type='till_close'` is produced in v1).
```
id            uuid PRIMARY KEY DEFAULT gen_random_uuid()
location_id   uuid REFERENCES locations(id)
install_id    text                        -- target device (nullable until claimed)
type          text                        -- 'till_close'
payload       jsonb                       -- reconciliation data for the template
status        text DEFAULT 'pending'      -- pending|claimed|printed|failed
attempts      int  DEFAULT 0
error         text
created_at    timestamptz DEFAULT now()
claimed_at    timestamptz
printed_at    timestamptz
```
Index: `(location_id, status)`, `(install_id, status)`.

### `print_automations`
Per-location rule mapping an Operandio job to a print action.
```
id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
location_id     uuid REFERENCES locations(id)
job_name_match  text         -- ILIKE pattern, default '%drawer close%'
print_type      text         -- 'till_close'
enabled         boolean DEFAULT false
created_at      timestamptz DEFAULT now()
```
RLS enabled, no policy (service-role only), per the repo's standard.

## 4. Portal Backend

New router `auth/src/routes/print.js`, mounted under `/print`, all admin routes
behind `authenticate` + `requireRole('admin')`. Device routes authenticated by
`install_id` + the launcher's existing bearer token (same trust model as
`/launcher/heartbeat`).

| Method & path | Caller | Purpose |
|---|---|---|
| `POST /print/devices/report` | desktop | Upsert `print_devices` with available printers + last_seen (or fold into heartbeat response). |
| `GET  /print/jobs?install_id=` | desktop | Return ≤1 pending job for this device; mark `claimed`. |
| `POST /print/jobs/:id/ack` | desktop | Set `printed`/`failed`, store error, bump attempts. |
| `GET  /print/receipt/:id` | desktop | Render the receipt as standalone HTML (logo inline, no auth cookie needed — short-lived signed job id). |
| `GET  /print/devices` | admin | List devices for the admin's locations (+ status). |
| `PUT  /print/devices/:install_id` | admin | Set `selected_printer`, `enabled`. |
| `POST /print/devices/:install_id/test` | admin | Enqueue a `type='test'` job to that device. |
| `GET/PUT /print/automations` | admin | Read/write per-location automation rules. |

**Trigger hook:** in the Operandio submission path (`operandio.js`, after a
`submitted` event is recorded), call `maybeEnqueueTillReceipt(event)` in a new
`auth/src/services/printing/tillReceipt.js`. It is best-effort and must never
block or fail the Operandio webhook (wrap in try/catch, log on error).

**Receipt rendering:** server-side HTML template in
`auth/src/services/printing/receiptTemplate.js`. Logo shipped as a static asset
(or inlined base64) so the desktop needs no auth to load it. Fields from the
chosen set: logo, date/time, location, closed-by, starting float, cash sales,
expected, counted, over/short, **itemized cash drops**, bag-drop amount.

## 5. Desktop App (launcher)

New modules under `launcher/src/`:
- `printers.js` — `webContents.getPrintersAsync()` (or `printDevices`) to
  enumerate installed printers; report them to the portal (piggyback on
  heartbeat or `POST /print/devices/report`).
- `print-poller.js` — every ~30s, `GET /print/jobs?install_id=`. On a job:
  open `/print/receipt/:id` in a hidden `BrowserWindow`, wait for load, call
  `webContents.print({ silent:true, deviceName: selectedPrinter,
  printBackground:true })`, then ack. Selected printer comes from the device
  record (admin-chosen) returned with the job, cached in `config.json`.
- Wire both into `main.js` startup; gate on `enabled`.

This is the launcher's first use of local printing; it already has the network
+ config plumbing. Ships as **launcher v1.7.0** via the existing
GitHub-Releases auto-update flow.

## 6. Admin UI (portal)

Two new tiles in `AdminPanel.jsx` (Setup section), following the existing
`AdminStaffTab` pattern (`portal/src/components/`, calls in `lib/api.js`):

- **Print Devices** (`AdminPrintDevicesTab.jsx`): per location, list the
  registered device(s) with online status (last_seen), a dropdown of that
  device's `available_printers`, an Enabled toggle, and a **Test Print** button.
- **Print Automations** (`AdminPrintAutomationsTab.jsx`): per location, toggle
  "Print receipt when PM drawer close is submitted" and (advanced) edit the
  `job_name_match` pattern.

Both admin-gated and scoped to the caller's `location_ids`, matching `admin.js`.

## 7. Security

- Device endpoints trust the launcher's existing bearer token + `install_id`;
  an install can only fetch/ack jobs for its own `install_id`.
- `/print/receipt/:id` is fetched by the desktop without a session. Protect with
  an unguessable job id (uuid) that is single-render and short-lived (valid only
  while the job is `claimed`), so the URL leaks nothing reusable.
- Admin routes: `authenticate` + `requireRole('admin')`, location-scoped.
- All new tables: RLS enabled, no policy (service-role only).

## 8. Error Handling & Edge Cases

- **Device offline / app closed:** job stays `pending`; prints when the desktop
  next polls. A stale-job cutoff (e.g. 12h) avoids printing yesterday's close.
- **No enabled device for the location:** skip enqueue; surface a "no printer
  configured" note in the admin page (and optionally the existing sync-alert SMS).
- **Print failure on the desktop:** ack `failed` with the error; allow up to N
  retries (attempts), then leave `failed` and visible in admin.
- **Duplicate submissions:** dedupe by `(location_id, business_date, type)` so a
  re-submitted drawer close doesn't double-print.
- **Operandio hook must never break ingestion:** best-effort, try/catch, logged.

## 9. Testing

- **Pure unit:** `maybeEnqueueTillReceipt` rule-matching (job-name pattern,
  enabled flags, dedupe) with mocked DB.
- **Template:** snapshot the rendered receipt HTML for a known payload.
- **Endpoint:** job claim is single-delivery (two concurrent polls don't both
  get the same job); ack transitions; admin location scoping.
- **Desktop:** manual + a thin test of the print-poller against a fake job
  (print to "Microsoft Print to PDF" to verify the silent-print path without
  paper).
- **End-to-end manual:** submit a real drawer-close in Operandio sandbox → see
  the job enqueue → desktop prints.

## 10. Dependencies & Rollout

1. **Depends on `feat/till-cash-tracking` merged** (till_counts, till_settings,
   tillReconcile). Without it, the receipt has no reconciliation source.
2. Ship backend (tables + `print.js` + Operandio hook) — dark, no devices
   enabled.
3. Ship launcher v1.7.0 (printer reporting + poller).
4. Admin enables one pilot location, sets its printer, fires a test print.
5. Enable the automation for the pilot; verify a real close prints. Roll out
   to the other gyms.

## 11. Open Questions

- Should "Test Print" and the real receipt share one template with sample data,
  or a distinct test page? (Lean: shared template, sample payload.)
- Is one device per location guaranteed, or can a gym have multiple desks that
  could print? (Design allows N devices/location; v1 admin picks one as the
  receipt printer — revisit if needed.)
