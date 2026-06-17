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

## GHL custom fields to create by hand

The GHL API can't create custom fields (see `reference_clickup_custom_fields`),
so create these on the contact in each WCS University location. Field **keys**
(the system writes `contact.<key>`):

Mirrored after each graded call:
- `last_call_score` (number), `last_call_summary` (text)

Grade-gated competency booleans (flip on a fresh pass):
- `roleplay_easy_passed`, `roleplay_medium_passed`, `roleplay_hard_passed`,
  `objection_handling_passed`

Curriculum booleans (event-driven via `/curriculum`):
- `mod1_complete` … `modN_complete`, `first_call_made`

Graduation rollup (mirrored on recompute):
- `graduation_progress_pct` (number), `graduation_eligible` (boolean)

Missing fields are logged and skipped — they never break a call or a grade.

## Milestone config (no redeploy needed)

Lives in the `milestone_config` table (single row), seeded with the spec §9.6
defaults (`pass_threshold` 75/80/85 for easy/medium/hard, default 80). Edit via
`PUT /university/config` (admin) or directly in Supabase. Pass thresholds and
the required-milestone set are tunable without a code change.

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
