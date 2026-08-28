# Tour Completion API

The contract for the portal product that records tours. **You own the interface;
this endpoint owns the schema and the validation.**

Everything below is live in the `auth` service. Nothing else needs to be built
on the Supabase side — post here and the tour is recorded, reportable, and
credited.

---

## `POST /tours/complete`

Records a finished tour. Authenticated as a staff session (same bearer token as
the rest of the portal API).

### Body

| Field | Type | Required | Notes |
|---|---|---|---|
| `clubNumber` | string | **yes** | One of `30935` Salem, `31599` Keizer, `7655` Eugene, `31598` Springfield, `31600` Clackamas, `31601` Milwaukie, `32073` Medford. |
| `outcome` | string | **yes** | One of the keys from `GET /tours/outcomes`. Do not hardcode the list — fetch it. |
| `passDays` | integer | **when the outcome grants access** | 1–90. Required for any outcome with `grants_pass: true`, refused on any outcome without it. For `Custom Pass` this is the only record of the length. |
| `givenByEmployeeId` *or* `givenByName` | string | **yes** (either) | Who **gave** the tour. Send the ABC employee id where you have it; the name is accepted as a fallback. |
| `tourIntakeId` *or* `ghlContactId` *or* `abcMemberId` | string | **yes** (any one) | Who the tour was for. |
| `abcMemberId` | string | strongly preferred | The ABC member id. Without it the tour cannot be joined to membership, so conversion cannot be measured. |
| `completedAt` | ISO 8601 | no | Defaults to now. Send it if the tour is being recorded after the fact. |
| `notes` | string | no | |
| `contactName`, `contactEmail`, `contactPhone` | string | no | Used only when no intake row exists and one has to be created. |

### Example

```json
{
  "abcMemberId": "4455",
  "ghlContactId": "kx8Fq2...",
  "clubNumber": "30935",
  "outcome": "Custom Pass",
  "passDays": 30,
  "givenByEmployeeId": "0f3c...",
  "givenByName": "Jane Doe",
  "completedAt": "2026-08-28T18:00:00.000Z",
  "notes": "Toured the turf and the pool."
}
```

### Responses

**200**

```json
{ "ok": true, "tourId": "uuid", "created": false, "outcome": "Custom Pass",
  "passDays": 30, "clubNumber": "30935", "givenBy": "Jane Doe" }
```

`created: true` means no matching check-in existed and a tour record was made
from scratch — see *Tours that were never checked in* below.

**400** — validation failed. **Every** problem is returned at once, so one fix
pass is enough:

```json
{ "error": "Invalid tour completion",
  "details": ["clubNumber must be one of 30935, 31599, ...",
              "outcome must be one of Custom Pass, Membership Sale, ...",
              "passDays is required for outcome Custom Pass"] }
```

**404** — an explicit `tourIntakeId` was sent that does not exist.

---

## `GET /tours/outcomes`

The allowed outcomes, for populating your picker.

```json
{ "outcomes": [
  { "outcome": "Membership Sale",  "is_sale": true,  "sort_order": 10, "grants_pass": false, "default_pass_days": null },
  { "outcome": "Started Trial",    "is_sale": false, "sort_order": 20, "grants_pass": true,  "default_pass_days": 7 },
  { "outcome": "Started VIP Pass", "is_sale": false, "sort_order": 30, "grants_pass": true,  "default_pass_days": 14 },
  { "outcome": "Only Tour",        "is_sale": false, "sort_order": 40, "grants_pass": false, "default_pass_days": null },
  { "outcome": "Custom Pass",      "is_sale": false, "sort_order": 50, "grants_pass": true,  "default_pass_days": null }
] }
```

(`label` is returned too; it equals `outcome` for all five.)

**Fetch this rather than hardcoding.** Outcomes live in the `tour_outcomes`
table so a new one is a row, not a deploy on either side. `is_sale` is what the
reports count as a converted tour.

**These five replaced the sales vocabulary that shipped in 147.** They answer
what the person LEFT WITH rather than whether they bought, and three of them do
real work: Started Trial, Started VIP Pass and Custom Pass each write an
expiration date and a visit allowance into ABC and put an alert on the front
desk. A sales disposition carries no day count, so adopting one would have meant
rebuilding pass granting as a separate control for no gain. Nothing was lost in
the swap: no tour had ever been recorded with a 147 outcome.

**`grants_pass` is not the same as `default_pass_days != null`.** Only Tour and
Custom Pass both have a null length and mean opposite things — one grants
nothing, the other grants whatever staff chose. Read the flag, not the number.

---

## Three things worth knowing

**Who gave the tour is not who recorded it.** `givenByEmployeeId` is the person
who walked the member around; the staff session posting the request is stored
separately as `completed_by`. A manager closing out a colleague's tour must not
take the credit — the Trainer report already had exactly this confusion between
*booking* a Day One and *servicing* one, and it took a while to spot.

**Tours that were never checked in are still tours.** If no open intake matches,
a record is inserted rather than the request being rejected. Refusing would push
staff back to recording tours on paper, which is the thing this replaces.

Matching by `ghlContactId` only ever attaches to the most recent **open** intake.
A completed one is left alone, so a second tour never overwrites the first
tour's outcome.

**A pass length is part of the outcome, not a detail.** A 30-day Custom Pass
and a 3-day one are the same outcome and very different things to have given
away, and nothing downstream can work the length out from the outcome alone. It
is validated against the outcome in both directions: required where access is
granted, refused where it is not. Sending it on `Only Tour` is a 400, because a
length there is a mistake worth surfacing rather than a value worth storing.

**Send `abcMemberId` whenever you have it.** It is the only field that lets a
tour be joined to membership, and therefore the only way "tours given → members
signed" can ever be measured. A tour without it still records, but it is a tally
rather than something a report can follow through to a join.

---

## What happens after you post

The tour lands in `tour_intakes` with `status = 'completed'`, and becomes
available to the Analytics reports — Tours Given and Tour Conversion on
Membership Snapshot, and the tour columns on Salesperson Performance. Both read
as pending today for want of exactly this data, and start showing figures on
the first completion recorded. Tour Conversion counts an outcome with
`is_sale: true`, which of the five is Membership Sale alone.

Only rows with `status = 'completed'` are counted. One still sitting at `ready`
is a check-in nobody closed out, not a tour that happened, so it is not reported
as one.

They read as pending for a second reason that has now been fixed. The front-desk
check-in **deleted** the row on completion, on the reasoning that the iPad is a
transient queue and the outbound webhook is the record on the way out. So no
tour had ever survived to be reported on, whatever posted here. The row is now
kept and marked completed; the queue filters on `status = 'ready'` so nothing
changed at the desk. A cancel still deletes — somebody who walked out before
being seen is not a tour.

The check-in fills the same columns directly rather than posting here, because
`/tours/complete` sits behind the staff session middleware and the iPad app is
deliberately login-free and token-gated. Both paths write the identical row
shape, so a report cannot tell them apart.
