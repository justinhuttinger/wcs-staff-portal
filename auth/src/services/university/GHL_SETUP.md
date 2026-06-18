# WCS University — GHL sub-account setup

This is the GoHighLevel side: the "WCS University" sub-account, the practice
(persona) contacts, and the workflow custom-code action that kicks off a call.
The backend it talks to is documented in `README.md`.

The persona is **not** tied to a phone number — it's the practice contact's
custom fields. One Retell number + one base agent serves every persona; each
practice contact sends different fields, so it behaves like a different lead.

---

## 1. Sub-account + trainee users

- Create the **WCS University** sub-account (or a folder/pipeline inside an
  existing one).
- Each trainee = a restricted user with **"Only assigned data"** enabled, so they
  see only their assigned practice contacts (spec §3.1).
- (Optional, agency CSS/JS injection) hide nav chrome that isn't part of the
  training surface — reuse the existing `app.westcoaststrength.com` injection.

## 2. Practice (persona) contacts

Each practice contact = one lead the trainee can call. Create these custom
fields on the contact (the field **key** is what matters):

| Field key | Type | Example |
|---|---|---|
| `persona_scenario` | text | `price_sensitive_snapchat` |
| `persona_difficulty` | text | `medium` |
| `call_type` | text | `cold_lead` |
| `lead_source` | text | `instagram` |
| `trainee_phone` | phone | the rep's cell (see §4 for options) |

> The write-back fields (`last_call_score`, `*_passed`, `graduation_*`) live on
> the **trainee's** contact/record, not the persona — see `README.md`.

### Starter practice contacts (one per call type)

Create these four to cover the call types. `scenario`/`difficulty` are flavor;
swap freely. Contact name is just a label for the trainee.

| Contact name | `call_type` | `persona_scenario` | `persona_difficulty` | `lead_source` |
|---|---|---|---|---|
| Marcus — IG cold lead | `cold_lead` | `price_sensitive_snapchat` | `hard` | `instagram` |
| Dana — mid-trial check-in | `mid_trial` | `tire_kicker` | `medium` | `facebook` |
| Greg — expired-trial winback | `expired_trial` | `hostile` | `hard` | `google` |
| Priya — new member onboarding | `new_member` | `confused` | `easy` | `referral` |

Valid values:
- `call_type`: `cold_lead` | `mid_trial` | `expired_trial` | `new_member`
- `persona_difficulty`: `easy` | `medium` | `hard`
- `persona_scenario`: any key in `scenarios.js` (controls lead name + objection);
  unknown values fall back to a generic prospect.

## 3. Workflow: "Start University call"

Trigger it however you like the trainee to launch a call — a contact tag added,
an inbound-webhook button, a manual workflow trigger. Then add a **Custom Code**
action with the body below. It POSTs to the portal backend, which creates the
Retell call.

```javascript
// GHL workflow Custom Code action.
// Map these from the practice contact + trainee context in the action's inputs:
//   contact custom fields -> persona_scenario, persona_difficulty, call_type, lead_source
//   trainee_phone         -> the rep's cell (see section 4)
//   trainee_id/name       -> the assigned user (or a field)
//   university_api_key     -> your UNIVERSITY_API_KEY secret (store as an input)

const payload = {
  trainee_id:        inputData.trainee_id,
  trainee_name:      inputData.trainee_name,
  trainee_phone:     inputData.trainee_phone,     // E.164, e.g. +1503...
  contact_id:        inputData.contact_id,        // the practice contact id
  location_id:       inputData.location_id,       // GHL location id
  persona_scenario:  inputData.persona_scenario,
  persona_difficulty:inputData.persona_difficulty,
  call_type:         inputData.call_type,          // cold_lead | mid_trial | expired_trial | new_member
  lead_source:       inputData.lead_source,        // facebook | instagram | ...
};

const res = await fetch("https://<PORTAL_AUTH_DOMAIN>/university/calls/start", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${inputData.university_api_key}`,
  },
  body: JSON.stringify(payload),
});

const data = await res.json();
return { session_id: data.session_id, retell_call_id: data.retell_call_id, status: data.status };
```

- Replace `<PORTAL_AUTH_DOMAIN>` with the portal auth API host (same host as
  `/auth`, `/reports`, …).
- `university_api_key` must equal the backend's `UNIVERSITY_API_KEY` env. Store it
  as a workflow input/secret, not inline.
- The backend returns `{ session_id, retell_call_id, status }`; Retell then dials
  `trainee_phone` and the agent opens already in character.

## 4. Where `trainee_phone` comes from (pick one)

The persona contact is the *lead*; we still need the *trainee's* cell to dial.
Options, simplest first:

1. **Assigned user's phone** — assign each practice contact to the trainee, map
   the assigned user's phone → `trainee_phone`. Cleanest with "only assigned data."
2. **Per-trainee cloned contacts** — clone the persona set per trainee on
   enrollment and stamp `trainee_phone` on each (spec §10.3). More setup, but
   bulletproof scoping.
3. **A `trainee_phone` field** on the contact — quick to start; fine for a pilot.

## 5. (Optional) Curriculum milestones

For event-driven curriculum steps (module done, first call made), add a second
Custom Code action on the relevant workflow that records the milestone in the
ledger so graduation math stays complete (spec §9.7):

```javascript
await fetch("https://<PORTAL_AUTH_DOMAIN>/university/curriculum", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${inputData.university_api_key}`,
  },
  body: JSON.stringify({
    trainee_id:   inputData.trainee_id,
    milestone_key:inputData.milestone_key,   // e.g. "mod1" or "first_call_made"
    contact_id:   inputData.contact_id,      // trainee's contact (for the GHL boolean mirror)
    location_id:  inputData.location_id,
  }),
});
```

The native GHL side can still set the boolean field directly for instant
visibility; this POST keeps the Supabase ledger (the source of graduation
truth) in sync.

## 6. Test order

1. Tune Retell voice realism with a manual dashboard call first (see `README.md` §H).
2. Create one practice contact + the workflow, set `UNIVERSITY_ENABLED=true` and
   the env, then trigger the workflow against your own cell.
3. Confirm the call personalizes, then check `roleplay_sessions` / `roleplay_grades`
   in Supabase and the mirrored fields on the contact.
