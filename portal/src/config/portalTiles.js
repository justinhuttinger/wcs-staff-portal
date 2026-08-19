// Catalog of portal tiles that can be granted to a "custom" role member, and
// the reports that can be granted to them. Keep the keys in sync with the
// allow-lists in auth/src/routes/admin.js (CUSTOM_TILE_KEYS / CUSTOM_REPORT_KEYS)
// and with how ToolGrid renders the custom-role layout.
//
// `group` is just for organizing the admin picker (Apps vs Tools).

export const PORTAL_TILE_CATALOG = [
  // Apps (external services + in-portal Drive)
  { key: 'grow',          label: 'Grow (CRM)',        desc: 'CRM',           group: 'apps' },
  { key: 'abc',           label: 'ABC Financial',     desc: 'Billing',       group: 'apps' },
  { key: 'wheniwork',     label: 'WhenIWork',         desc: 'Scheduling',    group: 'apps' },
  { key: 'paychex',       label: 'Paychex',           desc: 'Payroll',       group: 'apps' },
  { key: 'gmail',         label: 'Gmail',             desc: 'Email',         group: 'apps' },
  { key: 'drive',         label: 'Shared Drive',      desc: 'Documents',     group: 'apps' },
  { key: 'insights',      label: 'Insights',          desc: 'ABC',           group: 'apps' },
  { key: 'notifications', label: 'Send Notifications', desc: 'Member App',    group: 'apps' },
  // Tools (in-portal views)
  { key: 'calendar',        label: 'Calendar',         desc: 'Tours & Day Ones', group: 'tools' },
  { key: 'leaderboard',     label: 'Leaderboard',      desc: 'Rankings',      group: 'tools' },
  // HR Docs is intentionally omitted — it is manager-gated and above the
  // custom role's tier, so it can't be granted to a custom member.
  { key: 'helpCenter',      label: 'Help Center',      desc: 'Guides',        group: 'tools' },
  { key: 'ordering',        label: 'Ordering',         desc: 'Vendors',       group: 'tools' },
  { key: 'ticketing',       label: 'Tickets',          desc: 'Submit & Track', group: 'tools' },
  { key: 'trainerAvail',    label: 'D1 Availability',  desc: 'Trainers',      group: 'tools' },
  { key: 'reporting',       label: 'Reporting',        desc: 'Reports',       group: 'tools' },
  { key: 'forms',           label: 'Forms',            desc: 'Signups',       group: 'tools' },
  // Note: the Marketing Tracker tile is NOT listed here — it is controlled by
  // the marketing add-on toggle (with its own club/type scope), not the custom
  // tile picker, so the tile and its API gate never disagree.
]

export const TILE_BY_KEY = Object.fromEntries(PORTAL_TILE_CATALOG.map(t => [t.key, t]))

// Reports an admin can grant to a custom-role member. The lead-tier reports the
// custom role can already load, plus KPIs and the marketing reports (Meta Ads /
// Google) — these are normally manager/corporate-gated but a custom member who
// is granted them is let through per-report (see requireReportAccess on the
// server). Keep in sync with CUSTOM_REPORT_KEYS in auth/src/routes/admin.js.
// Payroll, Revenue, Operations and Audits remain excluded by design.
export const CUSTOM_REPORT_CATALOG = [
  { key: 'club-health',       label: 'Club Health' },
  { key: 'membership',        label: 'Membership' },
  { key: 'cancels',           label: 'Cancels' },
  { key: 'pt',                label: 'Day One' },
  { key: 'pt-roster',         label: 'PT Roster' },
  { key: 'pt-projections',   label: 'PT Projections' },
  { key: 'nps',               label: 'NPS' },
  { key: 'checkins',          label: 'Check-ins' },
  { key: 'pt-sessions',       label: 'Trainer Load' },
  { key: 'pt-new-clients',    label: 'New Clients' },
  { key: 'session-frequency', label: 'Session Frequency' },
  { key: 'deactivated-pt',    label: 'Deactivated PT' },
  { key: 'pt-health',         label: 'PT Health' },
  { key: 'kpis',              label: 'KPIs' },
  { key: 'meta-ads',          label: 'Meta Ads' },
  { key: 'google-marketing',  label: 'Google' },
  { key: 'email-marketing',   label: 'Email Marketing' },
  { key: 'marketing-engagement', label: 'Marketing Engagement' },
]
