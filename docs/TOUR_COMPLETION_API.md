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
  "outcome": "joined",
  "givenByEmployeeId": "0f3c...",
  "givenByName": "Jane Doe",
  "completedAt": "2026-08-28T18:00:00.000Z",
  "notes": "Toured the turf and the pool."
}
```

### Responses

**200**

```json
{ "ok": true, "tourId": "uuid", "created": false, "outcome": "joined",
  "clubNumber": "30935", "givenBy": "Jane Doe" }
```

`created: true` means no matching check-in existed and a tour record was made
from scratch — see *Tours that were never checked in* below.

**400** — validation failed. **Every** problem is returned at once, so one fix
pass is enough:

```json
{ "error": "Invalid tour completion",
  "details": ["clubNumber must be one of 30935, 31599, ...",
              "outcome must be one of joined, no_sale, ..."] }
```

**404** — an explicit `tourIntakeId` was sent that does not exist.

---

## `GET /tours/outcomes`

The allowed outcomes, for populating your picker.

```json
{ "outcomes": [
  { "outcome": "joined",      "label": "Joined",            "is_sale": true,  "sort_order": 10 },
  { "outcome": "no_sale",     "label": "No Sale",           "is_sale": false, "sort_order": 20 },
  { "outcome": "thinking",    "label": "Thinking About It", "is_sale": false, "sort_order": 30 },
  { "outcome": "not_a_fit",   "label": "Not a Fit",         "is_sale": false, "sort_order": 40 },
  { "outcome": "no_show",     "label": "No Show",           "is_sale": false, "sort_order": 50 },
  { "outcome": "rescheduled", "label": "Rescheduled",       "is_sale": false, "sort_order": 60 }
] }
```

**Fetch this rather than hardcoding.** Outcomes live in the `tour_outcomes`
table so a new one is a row, not a deploy on either side. `is_sale` is what the
reports count as a converted tour.

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

**Send `abcMemberId` whenever you have it.** It is the only field that lets a
tour be joined to membership, and therefore the only way "tours given → members
signed" can ever be measured. A tour without it still records, but it is a tally
rather than something a report can follow through to a join.

---

## What happens after you post

The tour lands in `tour_intakes` with `status = 'completed'`, and becomes
available to the Analytics reports — the tour panel on Membership Snapshot and
the tour columns on Salesperson Performance, both of which currently read N/A
for want of exactly this data.
