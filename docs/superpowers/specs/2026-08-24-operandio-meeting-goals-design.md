# Operandio weekly meeting goals

**Date:** 2026-08-24
**Status:** designed

## What this is

Two Operandio jobs — `MC Weekly Meeting` and `PT Weekly Meeting` — each end with
five `long_text` steps, "Action Plan 1" through "Action Plan 5". This feature
carries those action plans into the club's knowledge article so the next week's
meeting opens with last week's priorities in front of it.

Fourteen articles already exist, built by hand in the "Meeting Takeaways"
category: `MC Goals - <Club>` and `PT Goals - <Club>` for each of the seven
clubs. This feature writes them; it does not create them.

## Why

Goal setting only works if last week's priorities are visible while this week's
are being set. Today an action plan is submitted into a job and never seen
again.

The read half is already solved natively, and nothing here changes it. Step 1
of each job is an `instruction` step whose description embeds a live article
link:

```
@[MC Goals - Salem](KnowledgeArticle:6a8c73701eb966480722b2f2)
```

Staff already open the article from inside the job. This feature only makes
sure there is something worth reading there.

## Architecture

A new service, `auth/src/services/meetingGoals/`, running on the existing
15-minute Operandio sync cadence, immediately after `operandioSync` so it reads
fresh rows.

```
operandioSync (existing, live in prod, all 7 clubs)
  └─ operandio_api_jobs + operandio_api_job_steps
       └─ meetingGoals.collect()  → new submissions → operandio_goal_entries
            └─ meetingGoals.publish() → render last 12 weeks
                 → knowledge(id){ update } on the club's article
```

Two decisions define the shape:

**The trigger is the API sync, not the inbound email.** `POST
/operandio/webhook` is SendGrid Inbound Parse of Operandio *email*, routed by
sniffing subject and HTML. Free-text action plans with embedded newlines are
exactly the input that breaks an HTML parser, and adding a fifth branch to that
chain risks a repeat of the till-vs-audit ordering bug (see the comment at
`auth/src/routes/operandio.js:217-228`). The sync already stores each step's
typed `response`. Cost is up to 15 minutes of latency, which is irrelevant for a
weekly meeting.

**Supabase is the source of truth; the article is a pure render.** Each
submission is stored as a row, and publishing rebuilds the whole document from
the last 12 weeks of rows. The alternative — reading the article back, parsing
last week's entries out of our own TipTap output, and prepending — means
parsing our own rendered format, and `update` creates no version, so a partial
write would lose history with no undo. With rows as the truth, any article can
be rebuilt at will, and the data stays queryable for later portal work.

## The in-place update

`knowledge(id){ update(input: KnowledgeInput!) }` is an undocumented namespace
mutation, confirmed working with a plain OAuth service token on 2026-08-24. The
public API has no `updateKnowledgeV2` and no version-creating mutation; the
`Mutation.knowledge` namespace holds exactly `update`, `move`, `restore`, and
`delete`.

```graphql
mutation($id: ID!, $input: KnowledgeInput!) {
  knowledge(id: $id) {
    update(input: $input) {
      ... on KnowledgeArticle { id title richTextContent }
    }
  }
}
```

Three properties this design leans on, all verified by round trip:

- **Omitted input fields are preserved, not wiped.** The update sends only
  `type`, `title`, and `tipTapContent`. Category, groups, locations, and tags
  stay exactly as set in the Operandio UI — the service never needs to know
  them. This is the opposite of the GHL calendar PUT behaviour.
- **The id is stable.** No delete-and-recreate, so the article link embedded in
  each job's step 1 keeps working. This is why the KPI digest's
  create-then-delete approach must not be copied here: it changes the id every
  run and would break those links.
- **`update` does not add a version.** `versions` stays at 1 across edits. There
  is no API-side undo, which is the whole reason Supabase holds the truth.

`auth/src/lib/operandioApi.js` gains `updateKnowledgeArticle({ id, title,
tipTapContent })`. Its header comment currently states that in-place editing is
impossible; that comment is corrected as part of this work.

## Data model

One migration, two tables. Both get RLS enabled with no policies, per the
service-role-only rule for this database.

### `operandio_goal_entries`

One row per job submission. `job_id` as primary key makes re-collection
idempotent for free — the 15-minute sync re-reads the same jobs repeatedly.

| Column | Type | Notes |
|---|---|---|
| `job_id` | `text` PK | Operandio job instance id, from `operandio_api_jobs.id` |
| `location_slug` | `text` | one of the seven known slugs |
| `kind` | `text` | `MC` or `PT`, CHECK constrained |
| `job_date` | `date` | Pacific calendar day of the job |
| `week_start` | `date` | Monday on-or-before `job_date` |
| `submitted_at` | `timestamptz` | |
| `submitted_by` | `text` | |
| `action_plans` | `jsonb` | ordered array of non-empty trimmed strings |
| `synced_at` | `timestamptz` | |

Index on `(kind, location_slug, week_start desc)` — the render query.

### `operandio_goal_articles`

Publish bookkeeping, one row per article.

| Column | Type | Notes |
|---|---|---|
| `kind`, `location_slug` | `text` | composite PK |
| `article_id` | `text` | resolved by title, cached here |
| `article_title` | `text` | exact title, sent back on every update |
| `last_rendered_hash` | `text` | sha256 of the rendered doc |
| `last_published_at` | `timestamptz` | |
| `last_error` | `text` | |

`last_rendered_hash` is what stops the service rewriting all 14 articles every
15 minutes. Publish only when the newly rendered document differs.

## Collection

`collect()` queries `operandio_api_jobs` for `process_name IN ('MC Weekly
Meeting', 'PT Weekly Meeting')` with `submitted = true`, joins
`operandio_api_job_steps`, and keeps steps whose `name` matches `/^Action Plan
[1-5]$/` with a non-empty trimmed `response`, ordered by `position`.

Job name to kind is an explicit config map, not a prefix guess:

```js
const KINDS = { 'MC Weekly Meeting': 'MC', 'PT Weekly Meeting': 'PT' }
```

`response` for a `long_text` step is plain text and routinely carries trailing
newlines and stray whitespace, so each value is trimmed. A submission with zero
non-empty action plans is still recorded — it is evidence the meeting happened
— but contributes nothing to the render.

Rows are upserted on `job_id`, so a job edited after submission updates in
place rather than duplicating.

## Article resolution

Title is the authority; the cached `article_id` is a convenience.

```
title = `${kind} Goals - ${titleCase(location_slug)}`
```

The seven slugs title-case directly onto the existing article names (`salem` →
`Salem`). `listKnowledgeArticles()` is matched on exact title. If the title is
missing from Operandio, that club/kind is skipped with a logged warning rather
than creating an article — the 14 articles are hand-curated, with categories and
permissions set in the UI, and silently creating a fifteenth would produce a
duplicate that the embedded job links do not point at.

A resolved id is written to `operandio_goal_articles`. On later runs the cached
id is used, but a title mismatch on read-back re-resolves.

## Rendering

`meetingGoals/tiptap.js`, mirroring `services/kpiDigest/tiptap.js` and reusing
its `p` / `t` / `b` / `i` / `h` / `ul` / `hr` node helpers.

Entries descending by `week_start`, newest first, trimmed to 12 weeks:

```
Week of Monday, August 24          (bold paragraph)
Submitted by Ryan Harris           (italic paragraph)
  • Action plan 1 text
  • Action plan 2 text
  ───
```

Entries with no non-empty action plans are omitted entirely, per the standing
rule against printing "nothing here" rows.

Week labelling reuses `services/kpiDigest/week.js` (`pacificYmd`, `addDays`,
Monday-anchored), including its UTC-noon anchoring to avoid DST drift.

## Failure handling

Per club/kind `try`/`catch`; one failing article never blocks the other 13.

After each update the service re-reads `richTextContent` and compares it to what
it sent, the same round-trip verification `kpiDigest/publish.js` performs. A
mismatch logs, writes `last_error`, and alerts — it does not retry blindly,
because there is no version to roll back to.

Failures write `last_error` and fire `sendAlert` from `blogAutomation/alerts`.
The top-level run never throws, matching `kpiDigest/index.js`.

Because Supabase holds the truth, recovery from any article-side damage —
including someone editing an article by hand in the UI — is just the next
publish. The hash check will see the drift and rewrite it.

## Rollout

Ships dark behind `OPERANDIO_GOALS_ENABLED`, default off. Merging changes
nothing until it is set on the auth service in Render.
`OPERANDIO_API_EMAIL` / `OPERANDIO_API_PASSWORD` are already set there, and
`OPERANDIO_API_SYNC_ENABLED` is already live (verified: all seven clubs synced
within the last 15 minutes).

Admin-only routes on a new `auth/src/routes/meetingGoals.js`:

- `GET /meeting-goals/status` — per-article last publish, hash, error
- `POST /meeting-goals/run` — optional `{ kind, club }` to force one article

Migration applied by hand at merge, per the standing rule for this repo.

## Testing

`node:test`, alongside the kpiDigest tests:

- week derivation, including a Sunday job date and a DST boundary
- action-plan extraction: gaps (1, 3, 5 filled), whitespace-only responses,
  all-empty submissions, ordering by `position`
- 12-week trim keeps the newest 12
- render snapshot for a two-week article
- hash-skip: unchanged data produces no update call
- article resolution: missing title skips rather than creates

## Open items

Neither blocks the build.

1. **The two jobs' section content looks swapped.** `MC Weekly Meeting`
   contains *PT KPI Review*, *Trainer Performance & Accountability*, and
   *Coaching & Training Needs* while linking to the MC article; `PT Weekly
   Meeting` contains *Membership KPI Review*, *CRM & Follow-Up*, and *Front
   Desk Standards* while linking to the PT article. Worth resolving before the
   Salem pair is duplicated to the other six clubs. This design keys off job
   name and club, never section content, so it is unaffected either way.

2. **Both processes are currently Salem-only.** The code is club-agnostic and
   picks up the other twelve process copies automatically as they are created.
   Collection starts from the moment the flag is enabled; these jobs are new, so
   there is no history to backfill.
