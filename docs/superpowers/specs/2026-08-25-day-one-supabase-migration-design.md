# Day One outcomes out of GHL custom fields and into Supabase

**Date:** 2026-08-25
**Status:** Phases 1 and 2 built. Reports still read the legacy path on purpose,
so the two systems can be compared for a week before anything is cut over.

---

## Why

Day One booking, trainer assignment, and outcome data lives in GHL **contact
custom fields**. A GHL custom field holds exactly one value per contact, forever.

That single sentence causes everything below.

### 1. History is destroyed on write

A member who books a second Day One overwrites the first. There is no version, no
archive, no way back.

This is not hypothetical. After backfilling, **443 contacts have more than one Day
One**. Every one of those members had at least one earlier session silently
erased from the record.

The same reasoning already produced `day_one_cancellations` (migration 107), whose
own comment reads: *"a GHL custom field only ever holds the most recent value and
is overwritten on the next cancellation."* That problem was solved once, for the
cancel half. This generalises it to the whole lifecycle.

### 2. Missing data was invisible rather than missing

Measured 2026-08-25 across 3,929 contacts carrying `day_one_booked`:

| Field | Populated | Rate |
|---|---|---|
| `day_one_status` | 1,712 | 44% |
| `day_one_date` | 1,641 | 42% |
| `day_one_trainer` | 1,503 | 38% |
| `day_one_booking_team_member` | 1,236 | **31%** |

Every report filters on `day_one_date`, so a row with no date silently vanishes
rather than showing as a gap. And the coverage is wildly uneven:

| Club | Booked | Has status | Coverage |
|---|---|---|---|
| Medford | 403 | 403 | **100%** |
| Milwaukie | 642 | 380 | 59% |
| Keizer | 571 | 230 | 40% |
| Clackamas | 654 | 231 | 35% |
| Salem | 426 | 133 | 31% |
| Springfield | 737 | 216 | 29% |
| Eugene | 496 | 119 | **24%** |

Cross-club show-rate comparison today is largely a comparison of data-entry
discipline. Worse, `leaderboard.js` awards `POINTS.DAY_ONE_BOOKED` off a field
that is blank two times out of three.

The backfill sharpened this further: of the 3,929, only **1,642 were ever real
records**. The other 2,287 carry `day_one_booked = 'Yes'` and nothing else: no
date of any kind, and 98% have no status, trainer, or booker either. They were
never recoverable data, only a flag.

### 3. Everything is stringly typed

- Dates are epoch-milliseconds **text** at UTC midnight (date pickers, no time of
  day), which is the source of the recurring `AT TIME ZONE` day-walk bugs.
- Trainers are free-text display names, so `leaderboard.js` fuzzy-matches on
  `normalizeName()`. There is no `staff.ghl_user_id`.
- `why_no_sale` is `LARGE_TEXT` at all 7 clubs. It collected 400+ distinct values,
  nearly all with a count of 1, including `Poor` / `poor` / `Poor ` as three
  separate answers and `Money` / `money` / `MOney` as three more. Unreportable.
- Reading any of it requires `ghl_contacts_report`, a view that LEFT JOINs
  `ghl_custom_field_defs` **23 times** against an 88k-row table on every load.

---

## Decisions

| Decision | Choice |
|---|---|
| GHL's future role | **Full cut.** Nothing reads a custom field. One field survives as a write-only courier (below). |
| Scheduling | **GHL keeps the calendar.** It stays the scheduling engine; the portal owns the record. |
| Backfill | **Everything mappable, flagged** as `source = 'ghl_custom_field_backfill'`. |
| Outcome form access | **Public, self-attested submitter.** No login; picks their name from the trainer roster. |
| Form scope | 1:1 port of the existing fields, plus a curated no-sale dropdown. |

### Why the calendar stays

`dayOneBooking.js` is 886 lines of hard-won GHL knowledge: round-robin fairness,
the rate-limit work that took a warm trainer pick from 11.6s to a single call, and
the discovery that the widget's "verify you are human" box is a 429 from
`/forms/submit` rather than a WAF rule. Replacing GHL scheduling is a separate,
worse-odds project. Owning the *record* is the high-value, low-risk half.

---

## Probe findings

Read-only probes against the live GHL calendars, 853 appointments over 90 days,
2026-08-25. These drove several design choices, so they are recorded here.

**`createdBy` is present on the list endpoint, but only useful for a minority:**

| `createdBy.source` | Events | Carries `userId`? |
|---|---|---|
| `booking_widget` | 803 (**94%**) | null, always |
| `calendar_page` / `contactdetails_page` / `opportunity_page` | 50 (6%) | yes, 49/49 |

This is the finding that makes the courier field necessary. For 94% of Day Ones
the booking team member cannot be read off the appointment at all.

**Other findings:**

- `rescheduledAt` is a native field. **162/853 (19%)** of Day Ones are rescheduled.
- **Appointment IDs survive edits.** 424/853 had `dateUpdated` ahead of `dateAdded`
  with the ID intact, so diffing by ID is precise rather than heuristic.
- **The calendar's own `showed`/`noshow` marks are not maintained**: 40/853 (5%).
  The outcome form therefore stays the sole source of truth for show vs no-show,
  and the reconciler never derives one from the calendar.
- `cancelled` (128/853, 15%) *is* well maintained, so it is taken from the calendar.

Roughly a third of Day Ones change state after booking. Any design capturing only
booking and outcome would be wrong about a third of the time.

---

## Schema

`day_one_appointments`, one row per Day One. Three choices worth explaining:

**`scheduled_date` (date) alongside `scheduled_start` (timestamptz).** Reports
group on the date, so nothing re-derives a Pacific local day from a UTC instant.
That retires the day-walk bug class outright. Backfilled rows get a date and a
**null** instant, because the legacy field genuinely is date-only; fabricating a
time would invent precision that was never recorded.

**`ghl_appointment_id` nullable, plain unique index.** Backfilled rows have no
appointment and never will. The index is deliberately *not* partial: `ON CONFLICT`
cannot infer a partial unique index, and the upsert fails against one. A plain
unique index is inferable and still permits many NULLs, since Postgres treats
NULLs as distinct by default.

**`booked_by_source`** records *how* attribution was learned (`webhook`,
`created_by`, `booking_widget`, `reconciler_field`, `legacy_field`), so a
possibly-stale value is never mistaken for a first-hand one.

`day_one_appointment_events` is append-only history. The parent row holds current
state; this holds how it got there. Given the 19% reschedule and 15% cancel rates,
it is not optional.

Both tables have RLS enabled with no policy, per the standing rule that the portal
DB is service-role only.

---

## The outcome form

Replaces the GHL Form currently sent to the trainer.

### Routing without a custom field

The workflow link carries only:

```
https://api.wcstrength.com/day-one/outcome?c={{contact.id}}
```

`{{contact.id}}` is a **native** GHL merge variable, already proven in this stack
by the Day One program success redirect. The trap it avoids: any per-appointment
token would need somewhere GHL can interpolate it, and the only such place is a
custom field, which is the thing being escaped.

The server resolves *which* Day One from `day_one_appointments`. That query is only
expressible because a contact can now have many appointments; against the old
fields "the open Day One for this contact" was undefined. Two open, and the form
asks rather than guessing.

`{{appointment.id}}` was **not** relied on. It may work on appointment-triggered
workflows, but it was not probed, and the design does not need it.

### Conditional flow

```
What happened?
├── They showed up ──> Sale or No Sale?
│                       ├── Sale     ──> What did they buy?  (7 packages)
│                       └── No Sale  ──> Why?  (14 reasons)
│                                          └── Other ──> type it
├── No show      ──> done
├── Cancelled    ──> optional reason
└── Rescheduled  ──> done, stays open for the real result
```

Cancelled and Rescheduled sit alongside show/no-show because a Day One that never
happened is not a no-show, and counting it as one is what makes show rate
untrustworthy.

Every rule is re-validated server-side. The form is public; the client's
conditional logic is a convenience, never the gate.

### The no-sale dropdown

14 buckets derived from the 400+ free-text answers, ordered by observed frequency,
with `Other` last opening a text box. Backfilled history lands in `Other` with the
original text preserved in `why_no_sale_other`, because that is honestly what it
was: uncategorised.

---

## Keeping the table honest

Three writers:

| Writer | Covers |
|---|---|
| `POST /webhooks/day-one-booked` | bookings, carrying the booking team member |
| `dayOneReconcile` cron, every 15 min | anything booked in GHL directly, reschedules, cancellations |
| The outcome form | the outcome half |

**The reconciler is not optional.** Webhook-only ingestion is how
`ghl_opportunities` counted deleted records (#363) and how the ABC calendar
undercounted late completions (#252). Polling makes the table self-healing: a
missed webhook, a bad deploy, or an outage is repaired on the next pass.

### The courier pattern

The one custom field that survives is `contact.day_one_booking_team_member`,
demoted from a **store** to a **courier**: GHL fills it, the webhook drains it
into Supabase, and the portal then clears it. Nothing reads it for reporting.

Clearing matters for a better reason than tidiness: a value left behind gets
misattributed to the *next* Day One that member books, which is precisely the bug
this migration exists to kill.

**Ordering is deliberate: store first, clear second, and only on success.** If the
portal is mid-deploy or throws, the field stays populated and the reconciler picks
it up. Clearing inside the GHL workflow instead would destroy the value the moment
a webhook failed, with no way to recover it.

### Reschedule detection

Two shapes, both handled:

1. **Edited in place.** GHL keeps the appointment ID, so the reconciler diffs the
   stored row against live state and writes a `rescheduled` event. Precise.
2. **Cancelled and rebooked.** Two unrelated appointments that are a reschedule in
   every way a report cares about. `linkReschedules()` pairs a cancellation with
   the same contact's replacement booking inside a window (default 72h,
   `DAY_ONE_RESCHEDULE_WINDOW_HOURS`). It compares an **absolute** time
   difference, so cancel-then-rebook and rebook-then-cancel both link. Nearest
   candidate wins; one replacement is never claimed by two cancellations.

---

## Phasing

| Phase | Ships | Status |
|---|---|---|
| 1 | table, backfill, reconciler | **built** |
| 2 | webhook, outcome form, dual-write | **built** |
| 3 | cut reports over to the new table | not started, deliberately |
| 4 | delete the legacy GHL writes | blocked, see below |

Phases 1 and 2 are live-but-parallel: the legacy GHL custom-field writes stay
**on**, so both systems are fed by the same submissions and can be diffed.

**Phase 3 needs care.** The new table will legitimately report *more* Day Ones than
today, because the bookings currently invisible for lack of a date become visible.
Show rate will move. That is a correction, not a regression, but it will look like
a break on a dashboard if nobody expects it.

**Phase 4 is gated on two things:**

1. **`notes_for_trainer`.** The calendar's "Day One Booked!" SMS interpolates it.
   Stop writing it and trainers get `Notes:` with nothing after. Either move that
   line into a portal notification or accept losing it.
2. **The unaudited workflow.** Something writes `day_one_status = 'Scheduled'` and
   `day_one_trainer` on booking that is **not** in this repo. Someone has to open
   GHL and inventory which workflows touch `day_one_*`. That is ops work.

---

## What this deletes eventually

A dead v1 of this exact idea is already in the repo and unused (`appointments` had
0 rows in prod): `POST /webhooks/ghl-appointment`, `POST /webhooks/ghl-form-complete`,
the `appointments` table, and the `form_url` iframe overlay in `DayOneView.jsx`.
Left in place for now so this change stays reviewable; removed in phase 3 or 4.

---

## Known limitations

- The 2,287 date-less legacy contacts are not backfilled and cannot be. They have
  no date of any kind.
- Backfilled rows collapse a member's entire Day One history into one row. That
  history was destroyed years ago; no backfill recovers it.
- Booking attribution does not jump to 100%. It becomes *visible*: `booked_by_name
  IS NULL` is now a number a manager can be handed.
- GHL intermittently returns `401 {"message":"Command timed out"}` on
  `/calendars/`. It is a timeout mislabelled as auth. The reconciler isolates it
  per location and recovers on the next pass.
