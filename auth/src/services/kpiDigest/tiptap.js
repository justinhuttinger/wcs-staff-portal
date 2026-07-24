// auth/src/services/kpiDigest/tiptap.js
// Builds the TipTap doc for the weekly digest from the RPC result.
//
// Content rules (all set by Justin): prior WEEK only; per-person rows, no
// per-location aggregate stats; omit empty clubs/people entirely (the RPC
// already returns only qualifiers); Day One section lists SALES only. Two
// sections: Day One sales, then Membership sales and Day One bookings.
'use strict'

// --- TipTap node helpers ---
const p = (...content) => ({ type: 'paragraph', content })
const t = (text) => ({ type: 'text', text })
const b = (text) => ({ type: 'text', text, marks: [{ type: 'bold' }] })
const i = (text) => ({ type: 'text', text, marks: [{ type: 'italic' }] })
const h = (level, text) => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const ul = (items) => ({ type: 'bulletList', content: items.map((c) => ({ type: 'listItem', content: [c] })) })
const hr = { type: 'horizontalRule' }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Weekday for a YYYY-MM-DD (anchored at UTC noon; date-only, no tz drift).
function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()]
}

// "Monday, July 13" (no year).
function longDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number)
  return `${weekdayOf(ymd)}, ${MONTHS[m - 1]} ${d}`
}

// Tidy a name for display. Source names are inconsistent: some lowercase
// ("brian francis" from GHL full_name), some ALL CAPS ("DANIEL JENSEN"), some
// already proper. Title-case each word, but leave short all-caps initials
// (JT, AJ, JC) alone, and title-case each part of hyphenated names
// (Pagano-Jackson). Already-mixed-case words (McPherson) are left untouched.
function titleCaseWord(w) {
  if (!w) return w
  // Short all-caps token = an initialism; keep as-is (JT, AJ, JC).
  if (w.length <= 2 && w === w.toUpperCase()) return w
  // Already mixed-case (has a lowercase AND an interior uppercase) -> leave.
  if (/[a-z]/.test(w) && /[A-Z]/.test(w.slice(1))) return w
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
}

function tidyName(name) {
  if (!name) return name
  return name
    .split(' ')
    .map((word) => word.split('-').map(titleCaseWord).join('-'))
    .join(' ')
}

const salesLabel = (n) => `${n} ${n === 1 ? 'sale' : 'sales'}`
const dayOnesLabel = (n) => `${n} ${n === 1 ? 'Day One' : 'Day Ones'}`

// Group an array of rows by their `club` field, preserving first-seen order.
function groupByClub(rows) {
  const order = []
  const byClub = new Map()
  for (const r of rows) {
    if (!byClub.has(r.club)) { byClub.set(r.club, []); order.push(r.club) }
    byClub.get(r.club).push(r)
  }
  return order.map((club) => [club, byClub.get(club)])
}

// weekData = RPC output; generatedYmd = the run date (YYYY-MM-DD).
function buildDigestDoc(weekData, generatedYmd) {
  const { window, totals, day_one_sales: daySales, roster } = weekData
  const year = window.end.split('-')[0]

  const content = []

  content.push(p(
    b(`Week of ${longDate(window.start)} to ${longDate(window.end)}, ${year}.`),
    t(` Generated ${longDate(generatedYmd)}, ${generatedYmd.split('-')[0]}. This article is replaced in full each week.`),
  ))
  content.push(p(i(
    `Company totals: ${totals.sales} membership sales, ${totals.booked} Day Ones booked, ${totals.d1_sales} Day One PT sales.`,
  )))
  content.push(hr)

  // --- Day One sales (SALE only), grouped by club, led by trainer ---
  content.push(h(2, 'Day One sales'))
  content.push(p(t('Closed Day Ones from the week, credited to the trainer who ran the session.')))
  for (const [club, rows] of groupByClub(daySales)) {
    content.push(h(3, club))
    content.push(ul(rows.map((r) => {
      const trainer = r.trainer ? tidyName(r.trainer) : 'No trainer assigned'
      return p(b(trainer), t(` with ${tidyName(r.member)}: ${r.pkg}`))
    })))
  }

  content.push(hr)

  // --- Membership sales and Day One bookings, grouped by club ---
  content.push(h(2, 'Membership sales and Day One bookings'))
  content.push(p(i(
    'Listed: staff with 5 or more membership sales, or 2 or more Day Ones booked. Format is sales / Day Ones booked.',
  )))
  for (const [club, rows] of groupByClub(roster)) {
    content.push(h(3, club))
    content.push(ul(rows.map((r) =>
      p(b(tidyName(r.person)), t(`: ${salesLabel(r.sales)}, ${dayOnesLabel(r.day_ones)}`)),
    )))
  }

  content.push(hr)
  content.push(p(i(
    'Source: ghl_contacts_report (Supabase), staff-entered GHL fields. Membership sales credited to sale_team_member by member_sign_date. Day One bookings credited to day_one_booking_team_member by day_one_booking_date where day_one_booked = Yes. Day One sales credited to day_one_trainer by day_one_date where day_one_sale = Sale. Package from pt_sale_type; dollar values are not tracked.',
  )))

  return { type: 'doc', content }
}

module.exports = { buildDigestDoc, tidyName, longDate, weekdayOf }
