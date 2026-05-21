# Marketing Mastermind — Ops Runbook

How to flip on the WCS Marketing Mastermind end-to-end and what to do when it misbehaves.

Related docs:
- Spec: [`../specs/2026-05-21-wcs-marketing-mastermind-design.md`](../specs/2026-05-21-wcs-marketing-mastermind-design.md)
- Plan: [`../plans/2026-05-21-marketing-mastermind-implementation.md`](../plans/2026-05-21-marketing-mastermind-implementation.md)

---

## Env vars (Render → wcs-auth-api service)

| Env var | Required | Default | What it does |
|---|---|---|---|
| `MASTERMIND_ENABLED` | **Yes** to turn it on | `false` | Master switch. When `'true'`, processor polls queue and rhythms register. Everything else gates on this. |
| `MASTERMIND_ANTHROPIC_API_KEY` | Yes | falls back to `ANTHROPIC_API_KEY` | Dedicated Anthropic key for Mastermind. Use a separate key from any other usage so Anthropic Console gives a clean per-month total. |
| `MASTERMIND_DAILY_CAP_USD` | No | `25` | Daily cost ceiling. When exceeded, processor refuses new work for the rest of the day; resumes at midnight PT. |
| `MASTERMIND_TASK_CAP_USD` | No | `2` | Per-task ceiling. Tasks over this still complete (cost is already incurred when we know it), but the output is prefixed with a ⚠️ warning. |
| `CLICKUP_API_KEY` | Yes | — | Already in use by `tickets.js`. Same key works. |
| `CLICKUP_WEBHOOK_SECRET` | Yes | — | The shared secret you set when registering the ClickUp webhook. Used to verify the `X-Signature` HMAC. |
| `CLICKUP_WORKSPACE_ID` | Required for Docs output | — | Workspace ID containing the Marketing space. Needed for the ClickUp Docs v3 API. |
| `CLICKUP_MASTERMIND_FIELD_ID` | Optional (now auto-detected) | — | Fallback Mastermind field UUID. Processor now looks the field up dynamically on each task; this env var only kicks in if the dynamic lookup fails. |
| `CLICKUP_FOLDER_CAMPAIGNS` | Required for Campaign Lab promotion | — | Folder ID of the "Campaigns" folder. When an approved concept gets `Mastermind = Brief Me`, the processor creates a new campaign list inside this folder. |
| `CLICKUP_SPACE_MARKETING` | Optional (informational) | — | Space ID of "WCS Marketing". Not used by code; kept for reference and future provisioning re-runs. |
| `CLICKUP_LIST_PERFORMANCE` | Required for performance rhythms | — | List ID for the "Performance" lane. Drives weekly Meta review, weekly digest, monthly report, quarterly strategy. |
| `CLICKUP_LIST_FLYERS` | Required for flyer audit rhythm | — | List ID for "Channels → Flyers & Print". |
| `CLICKUP_LIST_EMAIL` | Required for email queue rhythm | — | List ID for "Channels → Email & SMS". |
| `CLICKUP_LIST_STRATEGY` | Required for annual review rhythm | — | List ID for the "Strategy" lane. |

When any rhythm's `CLICKUP_LIST_*` env is unset, that single rhythm is skipped — others still run. Boot log shows which ones were scheduled vs skipped.

---

## Rollout sequence

### Step 0 — pre-deploy

1. **Generate a dedicated Anthropic API key** at https://console.anthropic.com/. Name it `wcs-mastermind`. Save it somewhere safe.
2. **Confirm Supabase tables exist:** `mastermind_queue`, `mastermind_errors`. They were created via `apply_migration` named `mastermind_queue_init`. Verify with:
   ```sql
   select count(*) from public.mastermind_queue;
   select count(*) from public.mastermind_errors;
   ```

### Step 1 — Deploy code with switch OFF

Merge the `feat/marketing-mastermind` branch to `master`. Render auto-deploys.

Required env on the auth Render service before/during this deploy:
- `MASTERMIND_ENABLED=false` (explicit — don't rely on absence)

Verify deploy is healthy. Boot log should include:
```
[mastermind] disabled (MASTERMIND_ENABLED != "true")
```

### Step 2 — Build the ClickUp space (automated, ~3 min)

Use the provisioning script. It creates the entire space — folders, lists, statuses, custom fields, location dropdowns — and outputs the env vars you need.

**Get your workspace (team) ID:**
Open ClickUp in a browser. The URL has the form `https://app.clickup.com/<TEAM_ID>/...`. That number is your `CLICKUP_TEAM_ID`.

**Run it (in the `wcs-staff-portal/auth` directory):**
```bash
cd auth
CLICKUP_API_KEY=<your existing pk_... key> \
CLICKUP_TEAM_ID=<workspace ID from URL> \
  node scripts/provision-mastermind-space.js
```

You can preview first with `DRY_RUN=true` prepended — no API calls, just shows what would be created.

The script:
- Verifies no existing space named "WCS Marketing" (refuses if there is — archive it first)
- Creates the space with the right feature flags (custom fields + tags enabled, time tracking off)
- Creates the 5 lane folders
- Creates 14 lists across the lanes with their per-list statuses
- Creates universal custom fields (`Mastermind` dropdown + `Mastermind Paused`) on every list
- Creates list-specific extras (Channel, Location, Publish Date, Format, Quantity, etc.)

Total ClickUp API calls: ~120 with a 250ms gap between each (well under rate limits). Takes about 30–60 seconds.

**Output:** the script prints, and also writes to `auth/scripts/mastermind-env-additions.txt`, the exact env-var block to paste into Render:

```
CLICKUP_WORKSPACE_ID=...
CLICKUP_SPACE_MARKETING=...
CLICKUP_FOLDER_CAMPAIGNS=...
CLICKUP_MASTERMIND_FIELD_ID=...
CLICKUP_LIST_PERFORMANCE=...
CLICKUP_LIST_FLYERS=...
CLICKUP_LIST_EMAIL=...
CLICKUP_LIST_STRATEGY=...
```

**If the script fails partway:** archive the partial "WCS Marketing" space in ClickUp, then re-run. The script refuses to run if a space by that name already exists, so partial state has to be cleared first.

**Optional follow-up (manual):** the script does not save default views (Calendar / Gantt / Board variants) on each list — ClickUp's view API is finicky. After running, open each Channels list and add a Calendar view filtered by `Publish Date`, a Board view grouped by status, and a Gantt view where useful (Meta Ads, Promotions, Flyers).

### Step 3 — Register webhooks in ClickUp

Two webhooks (or one webhook subscribing to two events):
- Event: `taskUpdated`
- Event: `taskCommentPosted`

Endpoint URL: `https://<your-auth-host>/webhooks/mastermind`
Secret: generate a random string (e.g., `openssl rand -hex 32`) → save to `CLICKUP_WEBHOOK_SECRET`.

The webhook should be scoped to the **WCS Marketing space** only — not the whole workspace — to avoid noisy fires from unrelated tasks.

### Step 4 — Set the env vars on Render

```
MASTERMIND_ENABLED=true
MASTERMIND_ANTHROPIC_API_KEY=<from step 0>
CLICKUP_WEBHOOK_SECRET=<from step 3>
CLICKUP_WORKSPACE_ID=<from step 2>
CLICKUP_MASTERMIND_FIELD_ID=<from step 2>
CLICKUP_LIST_PERFORMANCE=<from step 2>
CLICKUP_LIST_FLYERS=<from step 2>
CLICKUP_LIST_EMAIL=<from step 2>
CLICKUP_LIST_STRATEGY=<from step 2>
MASTERMIND_DAILY_CAP_USD=25
MASTERMIND_TASK_CAP_USD=2
```

Trigger a redeploy. Boot log should now include:
```
[mastermind] queue polling enabled (every 60s)
[mastermind] rhythm 'weekly_meta_review' scheduled: 0 7 * * 1
... etc
[mastermind] 7 rhythm(s) scheduled, 0 skipped (missing list IDs)
```

### Step 5 — Smoke test one task end-to-end

In ClickUp, create a test task in the Channels → Email & SMS list:
- Title: `Test — write me a sample broadcast`
- Description: `Free-form invite to existing members. Themes: spring, gratitude. Tone: warm not promo. CTA: book a free PT assessment.`
- Set `Mastermind = Draft`

Within ~90s you should see:
1. An acknowledgement comment from the integration user (TBD — see step 6 for how to make this clean).
2. A `Draft — Mastermind (claude-sonnet-4-6)` comment with code-fenced email copy.
3. Status moved to whatever your list calls "review".
4. `Mastermind` field cleared.
5. A row in `public.mastermind_queue` with `status='done'`, `cost_usd` populated.

If something fails:
- Check `/admin/mastermind/errors` page in the portal for sig mismatch / parse errors.
- Check `/admin/mastermind/queue?status=failed` for handler failures.
- Check Render auth-service logs.

### Step 6 — Onboard Paige

Spec recommends a 30-minute walkthrough. The minimum she needs to know:
- How to create a task in **Channels → Email & SMS**
- The Mastermind dropdown values and what each means (point her at the in-portal dashboard's overview)
- `@mastermind` in any comment continues the conversation

### Step 7 — Migrate existing marketing work

Move active tasks from the old messy marketing space into the right new lanes. Archive the old space after one week.

### Step 8 — Watch for one billing cycle

Daily check: `/admin/mastermind` dashboard. Monitor cost trajectory. Tune caps if needed.

---

## Troubleshooting

### "Mastermind isn't firing on a task I set"

1. Check `/admin/mastermind/errors`. Is there a `sig_mismatch`? Webhook secret mismatch between ClickUp and Render env.
2. Check `/admin/mastermind/queue`. Is there a row for the task at all?
   - **No row:** webhook isn't reaching the server. Check ClickUp's webhook delivery log + Render logs.
   - **Row exists, status=`pending`** for >90s: processor isn't running. Check `MASTERMIND_ENABLED` boot log line.
   - **Row exists, status=`working`** indefinitely: handler hung. Restart the Render service.
   - **Row exists, status=`failed`:** read the `error` field.

### "Dashboard shows costs but no breakdown by lane"

The `lane` field is populated only after a handler completes successfully. If you see `null` lanes for old rows, those predate the lane-inference logic. Future rows will populate it.

### "Daily cap is locking me out and I need to ship"

Bump `MASTERMIND_DAILY_CAP_USD` and re-deploy. There is no UI override yet.

### "I want to silence Mastermind on one task without disabling globally"

Set the `Mastermind Paused` boolean field to `true` on that task. The processor checks it before running.

### "Mastermind generated something terrible"

Reply to the task comment with `@mastermind redo with [direction]`. Or set `Mastermind = Review` after pasting a better version in a comment.

---

## Cost monitoring

- **Anthropic Console** (claude.ai/console): canonical truth for total spend. Look at the `wcs-mastermind` API key's daily/monthly view.
- **Portal dashboard** (`/admin/mastermind`): breakdowns by mode/lane/task. Catches "which mode is eating budget" questions the Console can't answer.

If the two diverge significantly, the in-portal `cost_usd` is using the `PRICING` table in `auth/src/mastermind/cost.js`. That table needs manual update when Anthropic changes prices. Compare to Console; if rates moved, update the constants and redeploy.

---

## Disabling in an emergency

```
MASTERMIND_ENABLED=false
```

Redeploy. ClickUp webhooks still hit the endpoint; they're queued in Supabase (insert succeeds) but the processor doesn't drain. When you re-enable, accumulated queue rows are picked up unless you `delete from mastermind_queue where status='pending';` first.

Or — to leave it enabled but stop accepting new work without losing inflight: temporarily change the webhook URL in ClickUp to a 404 endpoint.

---

## Known limitations

- **`Analyze` mode** only has the Meta ROAS adapter wired. Other reports (GA4, GBP, Flyer Audit, Email Queue) return a "paste data, I'll write the report" stub until adapters are added in a follow-up PR.
- **Comment storm cap** (>5 mentions/hour on the same task) is not enforced. If a task gets spammed, Mastermind processes every mention.
- **ClickUp Docs API v3 is recent** — payload shape may evolve. If doc creation starts failing, check the Docs v3 API docs and update `auth/src/mastermind/clickup.js` `createDoc()`.
- **Default views** (Calendar / Gantt / Board variations) aren't created by the provisioning script — set them manually after running it.
