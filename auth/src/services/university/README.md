# WCS University — voice roleplay sales training

Backend scaffold for the spec in `wcs-university-retell-spec.md`. A trainee taps
"call" in GoHighLevel, a **Retell** AI agent role-plays a prospect and dials the
trainee, the transcript is graded by an LLM against the WCS 7-stage pipeline,
scores land in Supabase, and a summary + milestone progress is mirrored back to
the GHL contact.

**Supabase is the ledger; GHL custom fields are the visible mirror.** (spec §9.1)

This ships **dark** behind `UNIVERSITY_ENABLED=true`. With the flag off, nothing
mounts and nothing runs.

## What's built (this scaffold)

- **Migration** `auth/migrations/047_wcs_university.sql` — `roleplay_sessions`,
  `roleplay_grades`, `trainee_milestones`, `trainee_graduation`,
  `milestone_config` (seeded). RLS-on-no-policy per migration 035.
- **Routes** `routes/university.js` (mounted at `/university`):
  - `POST /university/calls/start` — GHL custom-code action → creates the Retell
    call with dynamic vars, records the session. *(shared secret)*
  - `POST /university/retell/webhook` — Retell post-call event → captures
    transcript/recording, grades asynchronously. *(shared secret)*
  - `POST /university/curriculum` — record an event-driven curriculum milestone.
    *(shared secret)*
  - `GET /university/sessions`, `GET /university/trainees/:id`,
    `GET/PUT /university/config` — manager dashboard reads + config. *(staff JWT)*
- **Services** `services/university/`: `scenarios.js`, `config.js`, `retell.js`,
  `grade.js`, `ghlWriteback.js`, `milestones.js`, `index.js` (orchestrator).

## What's NOT built yet (next steps, spec §11)

1. **Retell agent + voice realism** (spec build order steps 1–2) — manual setup
   in the Retell dashboard. *Do this first; if the AI lead doesn't feel real,
   nothing else matters.*
2. **GHL sub-account wiring** — restricted trainee users, practice/persona
   contacts, the workflow + custom-code action.
3. **Manager dashboard UI** in `portal/` — reads the `GET` endpoints above.

## Call types (the backbone) vs persona color

Two orthogonal dimensions drive a call:

- **`call_type`** — the *situation* the trainee calls into. Changes the lead's
  mindset, the rep's goal, and **the grading rubric**. Defined in `callTypes.js`:
  `cold_lead`, `mid_trial`, `expired_trial` (winback), `new_member`.
- **persona color** — `scenario` (lead name + primary objection), `difficulty`
  (lead resistance), and `lead_source` (facebook / instagram / snapchat / …).
  Pure flavor; doesn't change how the call is graded.

**One base Retell agent plays every call type.** The scaffold computes the
call-type `situation` and injects it as a dynamic variable, so you do NOT create
a separate Retell agent per type. You only need separate agents if you want a
different *voice* per type. In GHL, each "practice contact" is a persona: its
custom fields (`call_type`, `persona_scenario`, `persona_difficulty`,
`lead_source`) flow through `/calls/start` and become the dynamic variables — so
the same Retell number + agent produces a different lead per contact.

### Grading is per call type

Each call type has its own scored dimensions and its own competency milestone:

| call_type | rep's goal | milestone key |
|---|---|---|
| `cold_lead` | book a tour / Day One | `roleplay_cold_lead` |
| `mid_trial` | re-engage, book next session | `roleplay_mid_trial` |
| `expired_trial` | win back a lapsed trial | `roleplay_winback` |
| `new_member` | Day One setup + PT positioning | `roleplay_new_member` |

`objection_handling` is a cross-cutting competency fed by each type's objection
dimension (objection_handling for cold_lead, overcame_resistance for winback, …).

## Dynamic variables sent to Retell

`scenarios.js → buildDynamicVariables` sends: `trainee_name`, `scenario`,
`difficulty`, `call_type`, `lead_source`, `lead_name`, `primary_objection`,
`situation`, `session_id`. The base persona prompt (§5, updated) references
`{{lead_name}}`, `{{trainee_name}}`, `{{lead_source}}`, `{{situation}}`,
`{{difficulty}}`, `{{primary_objection}}`. The rep's goal is **not** sent — it's
grader-only, so the lead can't play along.

## Environment variables

| Var | Purpose |
|---|---|
| `UNIVERSITY_ENABLED` | `true` to mount the routes. Off = dark. |
| `UNIVERSITY_API_KEY` | Shared secret for the machine endpoints (`calls/start`, `curriculum`). Sent by the GHL custom-code action as `Authorization: Bearer …`. If unset, endpoints are open (set it in prod). |
| `RETELL_API_KEY` | Retell API key. |
| `RETELL_FROM_NUMBER` | The Retell phone number that dials the trainee (E.164). |
| `RETELL_BASE_URL` | Default `https://api.retellai.com`. |
| `RETELL_CREATE_CALL_PATH` | Default `/v2/create-phone-call`. Override if the API path drifts (spec §10.5). |
| `RETELL_WEBHOOK_SECRET` | Verifies the Retell post-call webhook (header `x-retell-secret` / `x-webhook-secret`, or `?secret=`). |
| `RETELL_DEFAULT_AGENT_ID` | Fallback agent if a scenario / payload doesn't specify one. |
| `RETELL_AGENT_*` | Per-scenario agent ids (e.g. `RETELL_AGENT_PRICE_SENSITIVE`). See `scenarios.js`. |
| `UNIVERSITY_GRADER_MODEL` | Grader model. Default `claude-opus-4-8`. |
| `MASTERMIND_ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY` | Anthropic key for grading (same resolution as the mastermind module). |

GHL location API keys reuse the existing `GHL_LOCATION_*` / `GHL_API_KEY_*` env
(see `config/ghlLocations.js`).

## GHL custom fields

The GHL API can't create custom fields (see `reference_clickup_custom_fields`),
so create these by hand in each WCS University location.

**On each practice (persona) contact — the inputs that drive the call:**
- `persona_scenario` (text, e.g. `price_sensitive_snapchat`)
- `persona_difficulty` (text: easy | medium | hard)
- `call_type` (text: cold_lead | mid_trial | expired_trial | new_member)
- `lead_source` (text: facebook | instagram | snapchat | google | referral)

**On the trainee contact — written back by the system** (keys; system writes `contact.<key>`):

Mirrored after each graded call:
- `last_call_score` (number), `last_call_summary` (text)

Grade-gated competency booleans (flip on a fresh pass):
- `roleplay_cold_lead_passed`, `roleplay_mid_trial_passed`,
  `roleplay_winback_passed`, `roleplay_new_member_passed`,
  `objection_handling_passed`

Curriculum booleans (event-driven via `/curriculum`):
- `mod1_complete` … `modN_complete`, `first_call_made`

Graduation rollup (mirrored on recompute):
- `graduation_progress_pct` (number), `graduation_eligible` (boolean)

Missing fields are logged and skipped — they never break a call or a grade.

## Milestone config (no redeploy needed)

Lives in the `milestone_config` table (single row). After migration 048 the
competency milestones are call-type-keyed: `roleplay_cold_lead`,
`roleplay_mid_trial`, `roleplay_winback`, `roleplay_new_member`, plus the
cross-cutting `objection_handling` (all default `pass_threshold` 80) and the
`mod1` / `first_call_made` curriculum milestones. Edit via `PUT /university/config`
(admin) or directly in Supabase — thresholds and the required set are tunable
without a code change.

## Flow

```
GHL "call" → POST /calls/start → Retell dials trainee (in character)
                                       │
                          (call happens; Retell records + transcribes)
                                       ▼
Retell post-call → POST /retell/webhook → capture transcript → grade (async)
                                                                   │
                          roleplay_grades + status=graded ◄────────┘
                                       │
                 milestone ledger advances → graduation recompute
                                       │
                 GHL contact ◄── score, summary, milestone booleans, rollup
```
