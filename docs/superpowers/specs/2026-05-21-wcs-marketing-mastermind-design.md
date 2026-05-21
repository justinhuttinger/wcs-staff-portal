# WCS Marketing Mastermind — Design

**Status:** Approved 2026-05-21, pending implementation plan
**Owner:** Justin
**Collaborators:** Paige (email/SMS lead), GMs (out-of-ClickUp routing targets)
**Surface:** ClickUp (Marketing space) + wcs-staff-portal (webhook + queue + cost dashboard) + scheduled remote Claude agent

## Goal

Stand up a "marketing mastermind" that lives in ClickUp and acts as strategist, performance analyst, campaign executor, and operations coordinator for WCS marketing. Justin and Paige drive interaction through ClickUp tasks and comments; a webhook-triggered Claude agent does the work and posts results back into the same tasks.

The system covers four roles in one surface:
- **Strategist** — positioning, channel mix, quarterly plans
- **Performance analyst** — weekly/monthly reads of FB ROAS, GA4, GBP, GHL
- **Campaign executor** — produces ad copy, emails, social captions, blog drafts, flyer briefs
- **Operations coordinator** — runs the marketing backlog, breaks initiatives into tasks, keeps the calendar honest

## Non-goals

- **No content auto-publishing.** Mastermind drafts captions, emails, push notifications; it does not post to Instagram/TikTok or send broadcasts. Out of MVP scope.
- **No image/video generation.** Captions only; authentic gym content beats AI-generated.
- **No auto-creation of campaigns.** Even when ROAS drops, Mastermind flags it in the weekly review — it does not conjure new campaigns on its own.
- **No GM onboarding to ClickUp.** GMs remain out of ClickUp; GM-facing actions become routing tasks for Justin or Paige.

## Architecture overview

```
┌────────────────────────────────────────────────────────────┐
│  ClickUp: task updated (Mastermind field set non-blank)    │
│           OR comment posted with @mastermind mention       │
└──────────────────────────┬─────────────────────────────────┘
                           │ webhook
                           ▼
┌────────────────────────────────────────────────────────────┐
│  wcs-staff-portal · auth service                           │
│  POST /clickup/mastermind/webhook                          │
│   ├─ verify ClickUp HMAC signature                         │
│   ├─ filter: only Mastermind field changes or              │
│   │          @mastermind mentions, debounce 30s            │
│   └─ INSERT into Supabase mastermind_queue                 │
└──────────────────────────┬─────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Supabase: mastermind_queue table                          │
│   task_id · clickup_list · lane · mode · requested_by      │
│   requested_at · status · started_at · completed_at        │
│   input_tokens · output_tokens · model · cost_usd          │
│   output_comment_id · output_doc_id · error                │
└──────────────────────────┬─────────────────────────────────┘
                           │ scheduled agent polls every 60-90s
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Scheduled remote Claude agent (via /schedule)             │
│   1. Pull task: title, description, comments, lane context │
│   2. Pull external data per mode (FB / GA4 / GBP / GHL)    │
│   3. Run mode-specific prompt template                     │
│   4. POST comment (and optional Doc + subtasks) back       │
│   5. Update task status, reset Mastermind field to blank   │
│   6. Log tokens + cost to queue row                        │
└────────────────────────────────────────────────────────────┘
```

## ClickUp space structure

New space: **"WCS Marketing"** (built alongside the existing messy marketing space; old space archived after migration).

### Lane 1 — Inbox & Ideas

Single list. Raw drop zone for anything that doesn't have an obvious home yet.

- **Statuses:** `New` → `Triaged` → `Routed` → `Archived`
- **Custom fields:** `Source` (Me / Paige / GM / Member feedback / Other), `Mastermind`

Mastermind sweeps daily at 5pm PT, posts triage suggestions on any task >3 days old still in `New`. Tasks with no action 7 days after triage auto-move to `Archived`.

### Lane 2 — Strategy

Single list + ClickUp Docs.

- **Docs hold:** brand positioning, ICP, channel playbooks, quarterly plans, voice guidelines
- **Tasks:** only when there's an outcome to produce ("Refresh Q3 plan", "Document new-member journey")
- **Statuses:** `Open` → `Drafting` → `Review` → `Locked`

### Lane 3 — Campaigns

Folder containing one sub-list and one folder per active campaign.

```
Campaigns/
├─ 🧪 Campaign Lab                (single list — idea generation, approval gate)
├─ 🟢 [Active] <campaign name>    (folder — created on approval)
└─ 📦 [Archive] <campaign name>   (folder — moved here on Wrap Up)
```

**Campaign Lab list:**
- **Statuses:** `Brainstorming` → `Ideas Posted` → `Concept Picked` → `Promoted` → `Archived`
- **Workflow:**
  1. User creates a parent task with brief; sets `Mastermind = Strategize`
  2. Mastermind generates **3 concept subtasks** (configurable per request)
  3. User reviews subtasks; comments `@mastermind variations on #2` to iterate; marks chosen subtask status `Approved`
  4. On approved concept subtask, user sets `Mastermind = Brief Me`
  5. Mastermind promotes the concept: creates new `🟢 [Active] <name>` folder under Campaigns with parent task + deliverable subtasks + linked ClickUp Doc with full plan
  6. Non-chosen concepts auto-archive
  7. Lab parent task moves to `Promoted`

**Active campaign folder template:**
- Parent campaign task with `Campaign Type`, `Start Date`, `End Date`, `KPI`, `Budget`
- Deliverable subtasks (channel-specific) — generated based on `Campaign Type`
- Linked ClickUp Doc with strategy / audience / messaging / timeline
- Performance review task (auto-creates at campaign close)

**Campaign Type field** — drives default channel mix when Mastermind builds out a campaign:

| Value | Default deliverable channels |
|---|---|
| **Acquisition** | Meta Ads + Landing Page + Email Nurture + Promotions |
| **Retention** | App Blast + Email Blast + Flyers + In-Gym |
| **Upsell** | Email Blast + App Blast + Flyers + Trainer talking points |
| **Operational** | App Blast + Email + Flyers (no paid) |

### Lane 4 — Channels

Folder containing seven channel-specific lists (the non-campaign drumbeat work).

```
Channels/
├─ Meta Ads
├─ Organic Social/              (folder — see below)
├─ SEO & Blogs
├─ Email & SMS                  (Paige's home base)
├─ App Blasts
├─ Flyers & Print
└─ Promotions & In-Gym
```

**Universal Channels custom fields:** `Location` (Centralia / Chehalis / Aberdeen / Olympia / Lacey / etc. / All), `Publish Date`, `Linked Campaign` (optional relation), `Mastermind`

**Universal Channels statuses:** `Idea` → `Drafting` → `Scheduled` → `Live` → `Done`

**Saved views per list:** Calendar (by Publish Date), Board (by status), Timeline/Gantt (by Start/End where applicable).

#### Organic Social (sub-folder)

```
Organic Social/
├─ 🧪 Post Lab                  (idea generation, same pattern as Campaign Lab)
├─ 📅 Content Calendar          (approved + scheduled posts)
└─ 📦 Published Archive
```

- **Post Lab statuses:** `Brainstorming` → `Ideas Posted` → `Picked` → `Promoted` → `Archived`
- **Content Calendar statuses:** `Drafting` → `Caption Ready` → `Asset Needed` → `Scheduled` → `Published`
- **Content Calendar fields:** `Platform` (IG / TikTok / FB), `Format` (Feed / Reel / Story / Carousel), `Location Tag`, `Asset Status` (Needed / Captured / Edited / Ready), `Caption`, `Hashtags`

Weekly auto-brainstorm is **disabled at launch** (per user preference). Idea generation is on-demand only.

#### Email & SMS — Paige's Idea Lab

The Lab pattern (Campaign Lab / Post Lab) extends here too:

```
Email & SMS/
├─ 🧪 Broadcast Lab              (idea generation for monthly broadcasts, themed sequences, win-back campaigns)
└─ (main list — drafting → scheduled → sent)
```

- **Broadcast Lab statuses:** `Brainstorming` → `Ideas Posted` → `Approved` → `Promoted` → `Archived`
- Mastermind generates 3 broadcast concepts per request

#### App Blasts

In-app push notifications to members.

- **Statuses:** `Idea` → `Drafting` → `Approved` → `Scheduled` → `Sent` → `Archived`
- **Custom fields:** `Target Audience` (All Members / PT Clients / Inactive 30d / By Location / Custom), `Notification Title`, `Notification Body`, `CTA / Deep Link`, `Send Date / Time`, `Linked Campaign`
- **Mastermind = Draft** produces title + body + CTA copy, mobile-first, ≤140 chars body

#### Flyers & Print

Physical print collateral lifecycle.

- **Statuses:** `Idea` → `Design Brief` → `In Design` → `Proof Review` → `Approved` → `Printed` → `Distributed` → `Expired`
- **Custom fields:**
  - `Format` (A-frame / Window Cling / 8.5×11 Handout / 11×17 Poster / Trifold / Postcard / Door Hanger / Bag Stuffer)
  - `Locations` (multi-select)
  - `Quantity per location` (number)
  - `Print Vendor` (Vistaprint / Local Print Shop / In-House)
  - `Estimated Cost` (currency)
  - `Distribute By` (date)
  - `Pull By` (date — expiry)
  - `Design File` (URL — Canva / Drive link)
  - `Linked Campaign` (relation)
- **Mastermind capabilities:**
  - `Brief Me` → full design brief (headline, subhead, body, CTA, suggested layout, tone notes)
  - `Draft` → copy ready to paste into Canva
  - `Review` → critique a proof
- Cannot generate the designed artwork itself.

### Lane 5 — Performance

Single list of recurring analyst tasks (most auto-created on schedule).

- **Statuses:** `Pending` → `Analyzing` → `Drafted` → `Reviewed` → `Sent`

## The Mastermind trigger — single custom field

Custom field name: **`Mastermind`** (dropdown, applies to every list in the space).

| Value | What Mastermind does |
|---|---|
| *(blank)* | Ignore — Mastermind does not touch the task |
| `Brief Me` | Read task + linked context; propose scope/audience/channels/KPI/deliverables. In Campaign Lab on an `Approved` concept, this promotes to a full Active Campaign folder. |
| `Strategize` | Strategic recommendation: should we do this, alternatives, positioning fit. In any Lab list, generates 3 concept subtasks. |
| `Analyze` | Pull data (FB ROAS, GA4, GBP, GHL, internal reports) and write the analysis. |
| `Draft` | Produce the deliverable (ad copy / email / caption / blog draft / push body / flyer copy). |
| `Review` | Critique existing draft on the task; suggest line-item changes; flag risks. |
| `Wrap Up` | Post-mortem + recommendations + auto-create follow-up subtasks. Archives the task. |

**Behavior on trigger:**
1. Mastermind posts an acknowledgement comment within 5 seconds (`Mastermind: <mode> — working, ETA ~Ns`)
2. Performs the work
3. Posts the result (comment, optional ClickUp Doc, optional subtasks per Section 4 rules)
4. Updates task status (lane-appropriate auto-transition)
5. Resets `Mastermind` field to blank so it can be re-triggered

**Second universal field — `Mastermind Paused`** (boolean, default false) — per-task mute. When true, Mastermind ignores the task regardless of the `Mastermind` field. Used by Justin/Paige to lock a task off-limits without removing it from the workflow.

**Mode + Lane composition:** the lane provides context; the mode provides intent. Same dropdown value behaves differently depending on lane:
- `Brief Me` in `Inbox` → flesh out a raw idea
- `Brief Me` on Campaign Lab `Approved` concept → promote to full Active Campaign with subtasks + Doc
- `Analyze` in Performance lane → weekly/monthly report
- `Analyze` on Channel task → channel-specific data read

### `@mastermind` comment-mention trigger

For follow-up conversation after initial output. Mentioning `@mastermind` in any task comment triggers a "continue conversation" mode where Mastermind reads the task + all prior comments and responds inline.

Storm protection: same task replied to >5x in an hour → Mastermind posts one consolidated response instead of firing 5 separate jobs.

## Output destinations

| Mode | Output destination |
|---|---|
| `Brief Me` | Task comment (structured: Scope / Audience / Channels / KPI / Deliverables / Open Questions) |
| `Strategize` | Task comment + optional link to relevant Strategy Doc |
| `Analyze` | Task comment for headline read + ClickUp Doc for full analysis |
| `Draft` (short — caption / push / SMS / headline) | Task comment, code-fenced |
| `Draft` (long — full email / blog / landing copy) | **ClickUp Doc** attached to the task |
| `Draft` (ad creative brief / flyer brief) | ClickUp Doc attached |
| `Review` | Task comment threaded under the draft |
| `Wrap Up` | Task comment + auto-created follow-up subtasks for action items |

**No Google Drive integration in MVP.** All long-form output lives in ClickUp Docs (per user preference — keeps everything in one tool).

**Auto-subtask creation** is limited to two circumstances:
1. `Wrap Up` — action items from a post-mortem
2. `Brief Me` on a Campaign Lab approved concept — deliverable subtasks per the campaign type's default channel mix

## Recurring rhythms (auto-scheduled, all enabled at launch)

| Cron | Task | Lane | Mode | Output |
|---|---|---|---|---|
| Mon 7am PT | "Weekly Meta ROAS Review — week of \<date\>" | Performance | `Analyze` | Last week's FB ROAS read; what's working/bleeding; recommended budget shifts |
| Fri 4pm PT | "Weekly Marketing Digest — week of \<date\>" | Performance | `Analyze` | Cross-channel roll-up: posted / shipped / live / queued / broken |
| 1st of month 7am PT | "Monthly Marketing Report — \<month\>" | Performance | `Analyze` | Full GBP + GA4 + FB ROAS + 12-month trends report in a Doc |
| 1st of quarter 7am PT | "Quarterly Strategy Review — \<Q\>" | Performance | `Strategize` | Strategic memo: hitting goals, double down, kill, test next |
| Daily 5pm PT | Inbox sweep (no task created; comments only) | Inbox | n/a | Triage suggestions on stale Inbox tasks |
| 1st of month | "Flyer Audit — what's expired" | Channels → Flyers & Print | `Analyze` | List of flyers past `Pull By` date still not `Expired`; forward to GMs |
| Tue 8am PT | "Email & SMS — what's queued?" | Channels → Email & SMS | `Analyze` | This week's scheduled broadcasts + gap flags |
| 1st of year | "Annual Brand Review" | Strategy | `Strategize` | Read all locked Strategy Docs; propose refreshes |
| On campaign close | "Post-Mortem: \<campaign\>" | Performance | `Wrap Up` | Generated automatically when campaign parent task → Closed |

Estimated cost of all recurring rhythms together: **~$1.40/month**. Negligible.

## Cost tracking

**Two layers, both enabled:**

1. **Anthropic Console** — dedicated API key `wcs-mastermind` used by the processor and only the processor. Console shows one clean line per month: total Mastermind spend.
2. **In-portal dashboard** — new page at `wcs-staff-portal/admin/mastermind`. Reads from `mastermind_queue`. Shows:
   - Current month: total $, total invocations
   - Breakdown by mode (which Mastermind values eat the budget)
   - Breakdown by lane (where the value flows)
   - Top 10 most expensive tasks
   - Last 30 days trend

**Model routing:**
- Sonnet 4.6: `Draft`, `Analyze` (data-heavy, light-novel-reasoning)
- Opus 4.7: `Brief Me`, `Strategize`, `Review`, `Wrap Up` (strategic thinking)

**Realistic monthly estimates** assuming smart model routing:
- Light (5 invocations/day): $15–25
- Medium (15 invocations/day): $40–70
- Heavy (50 invocations/day with daily analysis): $150–250

## Safety rails

| Rail | Default | Behavior when hit |
|---|---|---|
| **Daily cost cap** | $25/day | Processor pauses for the day; drops 🚨 notification task; auto-resumes at midnight PT |
| **Per-task cost cap** | $2/task | Processor posts permission-to-proceed comment instead of running |
| **Concurrent work cap** | 3 tasks | Queue handled serially when depth > 3 |
| **Per-task mute** | `Mastermind Paused` boolean field | Mastermind ignores the task regardless of Mastermind field |
| **Global kill switch** | `MASTERMIND_ENABLED=false` env on auth service | Instantly halts all processing; webhooks still queue |
| **Field flap debounce** | 30s window | Only last Mastermind value processed if changed multiple times rapidly |
| **Comment storm cap** | 5 mentions/hour/task | Single consolidated response instead of N separate jobs |

## Components to build

### In `wcs-staff-portal/auth/` (existing service)

| Component | Path | Effort |
|---|---|---|
| Webhook endpoint | `auth/src/routes/marketing.js` (new) — `POST /clickup/mastermind/webhook` | ~100 LOC |
| HMAC signature verification | same file, util function | small |
| Queue insert + debounce logic | same file | small |
| Cost tracking admin route | `auth/src/routes/admin/mastermind.js` (new) — `GET /admin/mastermind/stats` | ~150 LOC |
| Feature flag | `MASTERMIND_ENABLED` env var, default `false` | trivial |

### In `wcs-staff-portal/portal/` (existing frontend)

| Component | Path | Effort |
|---|---|---|
| Admin dashboard page | `portal/src/components/admin/MastermindDashboard.jsx` (new) | ~200 LOC |
| Route + tile | wire into existing admin nav | small |

### In Supabase

| Object | Notes |
|---|---|
| `mastermind_queue` table | task_id, lane, mode, status, requested_at/by, started_at, completed_at, input_tokens, output_tokens, model, cost_usd, output_comment_id, output_doc_id, error, retries |
| `mastermind_errors` table | error_at, payload, error_message |
| RLS | Admin-only read; service-role write |
| Indexes | `(status, requested_at)` for processor polling; `(requested_at)` for dashboard |

### Scheduled remote Claude agent (new — separate from wcs-staff-portal)

Built via the `/schedule` skill or as a small Render worker depending on cost analysis at build time.

| Component | Responsibility |
|---|---|
| Queue poller | Every 60–90s: select pending rows, claim them |
| ClickUp client | Read task / comments / list metadata; write comments / Docs / subtasks / status / custom fields |
| External data adapters | Reuse existing FB ROAS / GA4 / GBP / GHL helpers from current reports |
| Per-mode prompt templates | One template per Mastermind value × major lane combinations |
| Cost logger | Write tokens + computed cost back to queue row |
| Rhythm scheduler | Crons for the recurring rhythms; creates the task + sets `Mastermind` field |

### ClickUp configuration (one-time)

- Create "WCS Marketing" space
- Build all five lanes with lists, custom fields, statuses, saved views
- Register webhooks: `taskUpdated`, `taskCommentPosted`
- Generate ClickUp API token (use existing `CLICKUP_API_KEY` from `wcs-staff-portal/auth`)

## Migration / rollout

| Week | Actions |
|---|---|
| **1** | Build webhook endpoint, queue table, processor skeleton. All behind `MASTERMIND_ENABLED=false`. Create `wcs-mastermind` Anthropic API key. |
| **2** | Build ClickUp space, lanes, custom fields, saved views. Register webhooks (point at staging if available, else paused production endpoint). |
| **3** | Smoke test end-to-end with one test task per Mastermind mode. Tune prompts. Test `@mastermind` mention flow. Manually fire each recurring cron once to verify output quality. |
| **4** | 30-minute Paige walkthrough. Migrate Paige's active email work into Channels → Email & SMS. Justin moves active strategy/campaign work over. |
| **5** | Recurring rhythms enabled one per week in this order: Mon Meta Review → Fri Digest → Monthly Report → Quarterly Strategy → Inbox sweep → Flyer Audit → Email queue check → Annual review. |
| **6** | Archive old marketing space. |

## Error handling

| Failure mode | Behavior |
|---|---|
| ClickUp webhook signature mismatch | Reject 401, log to `mastermind_errors`, no queue insert |
| ClickUp API unavailable when posting output | Queue row stays `working`, exponential backoff up to 5 retries; final failure → marked `failed` + notification task in `🚨 Mastermind Failures` list |
| Anthropic rate limit | Backoff + retry; no work lost |
| Task missing required context for the mode | Mastermind posts a clarifying comment instead of guessing; field resets; status unchanged; no loop |
| ClickUp Doc creation fails | Fall back to long-form inline comment with a note about the failure |

## Testing

| Layer | Approach |
|---|---|
| Webhook endpoint | Unit tests: signature verification, payload parsing, queue insert, debounce |
| Queue processor | Integration tests against a separate ClickUp test workspace; one task per Mastermind mode × major lane combination; assert output structure + status transitions + field resets |
| Per-mode prompt quality | Eval set of 5–10 representative tasks per mode; manual review of first ~20 real productions; tune prompts based on user feedback |
| Recurring rhythms | Each cron fired manually first; verified output quality; *then* schedule enabled |
| Dry-run flag | Processor supports `--dry-run` mode (outputs to log file, never posts to ClickUp) for prompt tuning |

## Open questions for implementation plan

1. **Scheduled remote agent vs Render worker** — final decision based on `/schedule` cost-per-run analysis once we know exact billing model.
2. **ClickUp webhook secret storage** — Render env var vs Supabase Vault.
3. **Doc template format** — exact Markdown/structure for the long-form Docs (Brief Me output, Campaign Plan doc, Analysis Doc). Will iterate during prompt tuning.
4. **Eventual Meta Graph integration** — out of MVP; flag for post-launch if organic social analytics become important.
5. **Eventual auto-posting integration** — Buffer/Later/Meta Graph for Organic Social Calendar; out of MVP.

## Success criteria

- Justin and Paige use Mastermind on ≥10 tasks per week within 4 weeks of launch
- Monthly cost stays within forecasted range (light–medium: $15–70/mo)
- Weekly Meta Review and Monthly Report run reliably without manual intervention for 4 consecutive weeks
- At least one Campaign Lab → Active Campaign promotion completes end-to-end in the first month
- Paige independently uses Mastermind for an email broadcast draft without Justin's help within 6 weeks
