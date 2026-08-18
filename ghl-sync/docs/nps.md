# NPS cohort job

Nightly job that finds members hitting a lifecycle milestone, records an
`nps_invites` row for each, and (when not dry running) tags them in GHL so a
workflow sends the survey email.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NPS_ENABLED` | unset (off) | Must be exactly `true` to register the cron |
| `NPS_HOUR` | `7` | Hour in US Pacific to run |
| `NPS_TAGGING_DRY_RUN` | `true` | Must be exactly `false` to enable GHL writes |
| `NPS_SURVEY_BASE_URL` | `https://survey.westcoaststrength.com` | Base for the tokenised link |

Dry run still writes `nps_invites` rows, flagged `dry_run = true`. That is
deliberate: it is how the cohorts get verified against real data before any
email exists.

## Verifying a dry run

```sql
select s.slug, i.dry_run, count(*), min(i.trigger_date), max(i.trigger_date)
from nps_invites i join nps_surveys s on s.id = i.survey_id
where i.created_at > now() - interval '1 day'
group by 1, 2 order by 1;
```

Sanity-check the counts against the expected daily volumes: roughly 39 new
joins, 16 cancels, 28 six-month and 11 one-year anniversaries per day.

## Going live

1. Confirm a few nights of dry-run cohorts look right.
2. Create the GHL tag and custom field for the survey, and set `ghl_tag` /
   `ghl_field_key` on the `nps_surveys` row.
3. Build the GHL workflow that triggers on the tag.
4. Set the survey's `audience_filter` to a single club to pilot.
5. Set `NPS_TAGGING_DRY_RUN=false`.
6. Widen the audience once delivery is confirmed.
