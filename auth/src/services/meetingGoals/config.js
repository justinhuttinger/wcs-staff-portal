// auth/src/services/meetingGoals/config.js
// Static config for the weekly meeting goals articles.
'use strict'

module.exports = {
  // Operandio process name -> article kind. An explicit map, NOT a prefix
  // match: "PT Audit" and "PT - Check In" are unrelated processes that a
  // startsWith('PT') test would happily swallow.
  KINDS: {
    'MC Weekly Meeting': 'MC',
    'PT Weekly Meeting': 'PT',
  },

  // Article titles are `${kind} Goals - ${Club}`, e.g. "MC Goals - Salem".
  // The 14 articles are hand-made in Operandio (category "Meeting Takeaways",
  // permissions set in the UI). We only ever write them — never create one, so
  // a typo can't spawn a duplicate the jobs' embedded links don't point at.
  titleFor: (kind, slug) => `${kind} Goals - ${slug.charAt(0).toUpperCase()}${slug.slice(1)}`,

  // Weeks of history kept in the article (one quarter). Older entries stay in
  // Supabase; they just stop rendering.
  WEEKS_KEPT: 12,

  // Steps that carry the payload, in the "Weekly Action Plan" section.
  ACTION_PLAN_RE: /^Action Plan\s*([1-5])$/i,

  // Runs at 5/20/35/50 past the hour: the compliance sync fires on the :00/:15
  // boundaries and takes ~90s across 7 clubs, so this reads settled rows.
  CRON: '5-59/15 * * * *',
  TZ: 'America/Los_Angeles',
  ENABLED_ENV: 'OPERANDIO_GOALS_ENABLED',
}
