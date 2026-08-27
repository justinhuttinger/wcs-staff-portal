// Shapes the window payload from analytics_topline() into the eight Topline
// cards. Pure: no I/O, so the arithmetic is testable without a database.
//
// Each card is a headline plus the periods it is judged against. Every
// comparison stops at the same day of month / day of year as the headline, so
// a month to date is never measured against a whole month.

function num(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pctChange(current, prior) {
  const a = num(current)
  const b = num(prior)
  if (a === null || b === null || b === 0) return null
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10
}

function ratio(numerator, denominator) {
  const a = num(numerator)
  const b = num(denominator)
  if (a === null || b === null || b === 0) return null
  return Math.round((a / b) * 100) / 100
}

// Computed from the raw values, NOT from ratio(): ratio rounds to 2 decimals
// for display, and feeding that into a percentage turned 23.2% into 23%.
function pctOf(numerator, denominator) {
  const a = num(numerator)
  const b = num(denominator)
  if (a === null || b === null || b === 0) return null
  return Math.round((a / b) * 1000) / 10
}

/**
 * Check-in figures come back as 0 for a window that predates collection, which
 * would read as "nobody came in". Convert those to null so the card can say
 * N/A instead.
 */
function checkins(window) {
  if (!window) return null
  return window.has_checkin_data === false ? null : num(window.checkins)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * "2026-07-01" -> "July 2026", for the check-in card's label.
 *
 * Parsed by hand rather than via Date: new Date('2026-07-01') is midnight UTC,
 * and getMonth() on a server west of Greenwich reports June.
 */
function monthLabel(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  const idx = Number(m[2]) - 1
  return MONTHS[idx] ? `${MONTHS[idx]} ${m[1]}` : null
}

function buildTopline(payload) {
  const w = payload?.windows || {}
  const members = payload?.members || {}
  const win = (name) => w[name] || null
  const val = (name, field) => (win(name) ? num(win(name)[field]) : null)

  // Check-ins come from their own monthly source, outside the window machinery.
  const rawCi = payload?.checkins || {}
  const ci = {
    month: rawCi.month || null,
    checkins: num(rawCi.checkins),
    prior_checkins: num(rawCi.prior_checkins),
    members_visited: num(rawCi.members_visited),
  }

  const ytdLost = val('ytd', 'lost_members')
  const pyYtdLost = val('py_ytd', 'lost_members')
  const ytdNew = val('ytd', 'new_members')

  // Attrition is losses over the members those losses came out of. Measured
  // against the headcount at the END of the period, matching how the external
  // tool's own figures reconcile (its 4,385 lost over 18,917 members is the
  // 23.5% it prints).
  const attritionRate = pctOf(ytdLost, num(members.now))
  const priorAttritionRate = pctOf(pyYtdLost, num(members.prior_year))

  const cards = [
    {
      key: 'revenueMtd',
      label: 'Revenue MTD',
      format: 'money',
      value: val('mtd', 'revenue'),
      rows: [
        { label: 'Prior Year MTD', value: val('py_mtd', 'revenue'), format: 'money' },
        { label: 'Prior MTD', value: val('prior_mtd', 'revenue'), format: 'money' },
        { label: 'YOY Change', value: pctChange(val('mtd', 'revenue'), val('py_mtd', 'revenue')), format: 'pct' },
        { label: '% Change from Prior MTD', value: pctChange(val('mtd', 'revenue'), val('prior_mtd', 'revenue')), format: 'pct' },
      ],
    },
    {
      key: 'newMembersMtd',
      label: 'New Members MTD',
      format: 'int',
      value: val('mtd', 'new_members'),
      rows: [
        { label: 'Prior Year MTD', value: val('py_mtd', 'new_members'), format: 'int' },
        { label: 'Prior MTD', value: val('prior_mtd', 'new_members'), format: 'int' },
        { label: 'YOY Change', value: pctChange(val('mtd', 'new_members'), val('py_mtd', 'new_members')), format: 'pct' },
        { label: '% Change from Prior MTD', value: pctChange(val('mtd', 'new_members'), val('prior_mtd', 'new_members')), format: 'pct' },
      ],
    },
    {
      key: 'netMemberYtd',
      label: 'Net Member Gain/Loss YTD',
      format: 'int',
      value: ytdNew === null || ytdLost === null ? null : ytdNew - ytdLost,
      signed: true,
      rows: [
        { label: 'New Member Units YTD', value: ytdNew, format: 'int' },
        { label: 'Lost Members YTD', value: ytdLost, format: 'int' },
        { label: 'Net Dues YTD', value: val('ytd', 'new_dues'), format: 'money' },
      ],
    },
    {
      key: 'revenueYtd',
      label: 'Revenue YTD',
      format: 'money',
      value: val('ytd', 'revenue'),
      rows: [
        { label: 'Prior YTD', value: val('py_ytd', 'revenue'), format: 'money' },
        { label: 'YOY Change', value: pctChange(val('ytd', 'revenue'), val('py_ytd', 'revenue')), format: 'pct' },
        { label: 'PT Revenue YTD', value: val('ytd', 'pt_revenue'), format: 'money' },
      ],
    },
    {
      key: 'totalMembers',
      label: 'Total Members',
      format: 'int',
      value: num(members.now),
      rows: [
        { label: 'Prior Year', value: num(members.prior_year), format: 'int' },
        { label: 'YOY Change', value: pctChange(members.now, members.prior_year), format: 'pct' },
        { label: 'Start of Year', value: num(members.start_of_year), format: 'int' },
      ],
    },
    // A WHOLE month, not the last 30 days, and not month-to-date.
    //
    // The accurate source (abc_member_checkin_months) has month granularity, so
    // a 30-day window is not available from it. The month that IS available is
    // the last complete one: month-to-date on the 3rd would compare three days
    // against a full year-ago month and read as a 90% collapse.
    {
      key: 'checkinsLastMonth',
      label: ci.month ? `Check-ins ${monthLabel(ci.month) || ''}`.trim() : 'Check-ins Last Month',
      format: 'int',
      value: ci.checkins,
      rows: [
        { label: 'Same Month Prior Year', value: ci.prior_checkins, format: 'int' },
        { label: 'YOY Change', value: pctChange(ci.checkins, ci.prior_checkins), format: 'pct' },
        { label: 'Members Who Visited', value: ci.members_visited, format: 'int' },
      ],
    },
    {
      key: 'attritionYtd',
      label: 'Attrition YTD',
      format: 'pct',
      value: attritionRate,
      rows: [
        { label: 'Attrition Rate Prior YTD', value: priorAttritionRate, format: 'pct' },
        { label: 'Lost Members YTD', value: ytdLost, format: 'int' },
        { label: 'Lost Members Prior YTD', value: pyYtdLost, format: 'int' },
        { label: 'Lost Members YOY Change', value: pctChange(ytdLost, pyYtdLost), format: 'pct' },
      ],
    },
    {
      key: 'revenuePerMember',
      label: 'Avg Revenue Per Member, Past 3 Months',
      format: 'money2',
      value: ratio(val('past3mo', 'revenue'), num(members.now)),
      rows: [
        { label: 'Past 3 Months Prior Year', value: ratio(val('py_past3mo', 'revenue'), num(members.prior_year)), format: 'money2' },
        { label: 'Prior 3 Months', value: ratio(val('prior3mo', 'revenue'), num(members.prior3mo_end)), format: 'money2' },
        {
          label: 'YOY Change',
          value: pctChange(
            ratio(val('past3mo', 'revenue'), num(members.now)),
            ratio(val('py_past3mo', 'revenue'), num(members.prior_year))
          ),
          format: 'pct',
        },
        {
          label: '% Change from Prior 3 Months',
          value: pctChange(
            ratio(val('past3mo', 'revenue'), num(members.now)),
            ratio(val('prior3mo', 'revenue'), num(members.prior3mo_end))
          ),
          format: 'pct',
        },
      ],
    },
  ]

  return {
    cards,
    asOf: payload?.as_of || null,
    windows: Object.fromEntries(
      Object.entries(w).map(([name, o]) => [name, { start: o.start, end: o.end }])
    ),
  }
}

module.exports = { buildTopline, pctChange, ratio, pctOf, checkins, monthLabel }
