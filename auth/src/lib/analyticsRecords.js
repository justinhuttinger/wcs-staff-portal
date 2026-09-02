const {
  CLUBS, CLUB_BY_SLUG, personKey, displayName, ACH_PAYMENT_METHOD,
} = require('./salespersonPerformance')

// ---------------------------------------------------------------------------
// The rows behind the numbers.
//
// Every Analytics report answers with aggregates: analytics_pt_snapshot returns
// one pooled row for a whole club, buildReport returns one row per salesperson.
// That is what makes them fast, and it is also why "click 14 and see which 14"
// cannot come out of the payload a report already has. The rows have to be
// fetched separately, on demand, and only for the metric that was clicked —
// August alone is 27,990 revenue transactions.
//
// ONE REGISTRY, NOT ONE ENDPOINT PER REPORT. Twelve record sets cover every
// clickable figure across the thirty-four reports, because the reports are
// different arrangements of the same handful of underlying tables. A per-report
// endpoint would be thirty-four chances for "what counts as a PT sale" to drift
// from what the report itself counted.
//
// Each set declares its own columns, so the modal renders whatever it is given
// and no column list is written twice.
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

/** Column shapes the modal knows how to render. */
const T = { text: 'text', date: 'date', int: 'int', money: 'money', pct: 'pct' }

function lazySupabase() {
  return require('../services/supabase').supabaseAdmin
}

/** Club numbers for the requested slugs, or null for every club. */
function clubNumbersFor(slugs) {
  if (!slugs || slugs.length === 0 || slugs.length === CLUBS.length) return null
  return slugs.map(s => CLUB_BY_SLUG[s]?.clubNumber).filter(Boolean)
}

/**
 * Name matching, the same normalisation the reports group people on.
 *
 * Done in JS rather than SQL because the source columns are inconsistent —
 * "Katie  Castlio" with two spaces exists in ABC — and ilike cannot collapse
 * inner whitespace. The row counts here are small enough that filtering after
 * the fetch costs nothing; the window and club filters are what keep it small.
 */
function matchesPerson(value, wanted) {
  if (!wanted) return true
  return personKey(value) === personKey(wanted)
}

function money(v) {
  return Math.round((Number(v) || 0) * 100) / 100
}

function name(first, last) {
  return displayName(`${first || ''} ${last || ''}`)
}

// ---------------------------------------------------------------------------
// The sets.
//
// Each is { label, columns, load(params) } where load returns an array of rows
// already shaped to the columns. Filtering that SQL cannot express cleanly
// (name normalisation, derived flags) happens after the fetch.
// ---------------------------------------------------------------------------

const SETS = {
  // -- Training -------------------------------------------------------------
  'pt-sessions': {
    label: 'Sessions',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'date', label: 'Date', format: T.date },
      { key: 'status', label: 'Status', format: T.text },
      { key: 'minutes', label: 'Minutes', format: T.int },
      { key: 'trainer', label: 'Trainer', format: T.text },
    ],
    async load({ start, end, clubNumbers, person, filter }) {
      const q = lazySupabase()
        .from('abc_calendar_events')
        .select('member_first_name, member_last_name, event_timestamp_local, status, duration_minutes, employee_first_name, employee_last_name, category, club_number')
        .gte('event_timestamp_local', `${start}T00:00:00`)
        .lte('event_timestamp_local', `${end}T23:59:59.999`)
        .not('employee_first_name', 'is', null)
      if (clubNumbers) q.in('club_number', clubNumbers)
      const rows = await fetchAllRows(q)
      return rows
        .filter(r => matchesPerson(`${r.employee_first_name} ${r.employee_last_name}`, person))
        // 'Canceled' is the only cancelled state ABC records on these events,
        // and it is spelled with one L.
        .filter(r => filter === 'cancelled'
          ? String(r.status || '').startsWith('Canceled')
          : filter === 'pt'
            ? r.status === 'Completed' && r.category === 'Appointment'
            : filter === 'all' ? true : r.status === 'Completed')
        .map(r => ({
          member: name(r.member_first_name, r.member_last_name),
          date: String(r.event_timestamp_local).slice(0, 10),
          status: r.status,
          minutes: Number(r.duration_minutes) || 0,
          trainer: name(r.employee_first_name, r.employee_last_name),
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },

  'pt-clients': {
    label: 'Clients',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'sessions', label: 'Sessions', format: T.int },
      { key: 'minutes', label: 'Minutes', format: T.int },
      { key: 'lastSeen', label: 'Last Session', format: T.date },
    ],
    // Built from the session rows rather than a second query, so "clients" is
    // by construction the distinct members of the sessions the card counted.
    async load(params) {
      return groupSessionsIntoClients(
        await SETS['pt-sessions'].load({ ...params, filter: 'completed' })
      )
    },
  },

  'pt-sales': {
    label: 'PT Sales',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'item', label: 'Package', format: T.text },
      { key: 'type', label: 'Type', format: T.text },
      { key: 'value', label: 'Value', format: T.money },
      { key: 'date', label: 'Sold', format: T.date },
      { key: 'seller', label: 'Credited', format: T.text },
    ],
    async load({ start, end, clubNumbers, person, filter }) {
      const q = lazySupabase()
        .from('abc_pt_services')
        .select('member_name, service_item, recurring_type_desc, invoice_total, sale_date, trainer_name, sales_person_name, club_number')
        .gte('sale_date', start)
        .lte('sale_date', end)
      if (clubNumbers) q.in('club_number', clubNumbers)
      const rows = await fetchAllRows(q)
      return rows
        // Either side of the sale can be the person asked about: a trainer sees
        // what they closed, a salesperson what they sold.
        .filter(r => !person
          || matchesPerson(r.trainer_name, person)
          || matchesPerson(r.sales_person_name, person))
        .filter(r => {
          const pif = /paid in full/i.test(r.recurring_type_desc || '')
          return filter === 'pif' ? pif : filter === 'rs' ? !pif : true
        })
        .map(r => ({
          member: r.member_name || 'Unnamed member',
          item: r.service_item || '—',
          type: /paid in full/i.test(r.recurring_type_desc || '') ? 'Paid in Full' : 'Recurring',
          value: money(r.invoice_total),
          date: String(r.sale_date).slice(0, 10),
          seller: r.trainer_name || r.sales_person_name || '—',
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },

  'pt-losses': {
    label: 'PT Deactivations',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'item', label: 'Package', format: T.text },
      { key: 'value', label: 'Value', format: T.money },
      { key: 'date', label: 'Deactivated', format: T.date },
      { key: 'reason', label: 'Reason', format: T.text },
      { key: 'trainer', label: 'Trainer', format: T.text },
    ],
    // Recurring services only, matching every loss figure in Analytics: no
    // paid-in-full package has ever carried an inactive_date, so a spent package
    // cannot be seen from here. Stated on the report, and true of this list too.
    async load({ start, end, clubNumbers, person }) {
      const q = lazySupabase()
        .from('abc_pt_services')
        .select('member_name, service_item, invoice_total, inactive_date, deactivate_reason, trainer_name, recurring_type_desc, club_number')
        .not('inactive_date', 'is', null)
        .gte('inactive_date', start)
        .lte('inactive_date', end)
      if (clubNumbers) q.in('club_number', clubNumbers)
      const rows = await fetchAllRows(q)
      return rows
        .filter(r => !/paid in full/i.test(r.recurring_type_desc || ''))
        .filter(r => matchesPerson(r.trainer_name, person))
        .map(r => ({
          member: r.member_name || 'Unnamed member',
          item: r.service_item || '—',
          value: money(r.invoice_total),
          date: String(r.inactive_date).slice(0, 10),
          reason: r.deactivate_reason || '—',
          trainer: r.trainer_name || '—',
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },

  // -- Day Ones -------------------------------------------------------------
  'day-ones': {
    label: 'Day Ones',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'date', label: 'Date', format: T.date },
      { key: 'status', label: 'Status', format: T.text },
      { key: 'outcome', label: 'Outcome', format: T.text },
      { key: 'trainer', label: 'Trainer', format: T.text },
      { key: 'bookedBy', label: 'Booked By', format: T.text },
    ],
    async load({ start, end, slugs, person, personField, filter, window }) {
      const q = lazySupabase()
        .from('day_one_appointments')
        .select('contact_name, scheduled_date, status, outcome, trainer_name, booked_by_name, booked_at, location_slug')
        .in('location_slug', slugs)
      // WHICH DATE THE WINDOW APPLIES TO IS THE CALLER'S TO SAY, because the
      // reports disagree on purpose. Day Ones Booked counts when it went in the
      // diary; Day Ones on Calendar counts when it was due. Those are different
      // cohorts, and a drill-down that picked one would open the wrong list
      // under the right number on half the cards.
      if (window === 'booked') {
        q.gte('booked_at', `${start}T00:00:00Z`).lte('booked_at', `${end}T23:59:59.999Z`)
      } else {
        q.gte('scheduled_date', start).lte('scheduled_date', end)
      }
      const rows = await fetchAllRows(q)
      const field = personField === 'bookedBy' ? 'booked_by_name' : 'trainer_name'
      return rows
        .filter(r => matchesPerson(r[field], person))
        .filter(r => {
          switch (filter) {
            case 'completed': return r.status === 'completed'
            case 'sold': return r.outcome === 'Sale'
            case 'no-sale': return r.outcome === 'No Sale'
            case 'no-show': return r.status === 'no_show'
            case 'cancelled': return r.status === 'cancelled'
            default: return true
          }
        })
        .map(r => ({
          member: r.contact_name || 'Unnamed member',
          date: String(r.scheduled_date).slice(0, 10),
          status: DISPLAY_STATUS[r.status] || r.status,
          outcome: r.outcome || '—',
          trainer: r.trainer_name || 'Unassigned',
          bookedBy: r.booked_by_name || '—',
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },

  'day-ones-pending': {
    label: 'Pending Outcome',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'date', label: 'Was Due', format: T.date },
      { key: 'overdue', label: 'Days Overdue', format: T.int },
      { key: 'trainer', label: 'Trainer', format: T.text },
      { key: 'bookedBy', label: 'Booked By', format: T.text },
    ],
    // Straight off migration 180's function rather than re-deriving the rule
    // here: "passed with no outcome" is defined once, in SQL, and every surface
    // that shows it agrees by construction.
    async load({ start, end, clubNumbers, person, personField }) {
      const { data, error } = await lazySupabase().rpc('analytics_day_one_pending', {
        p_start: start, p_end: end, p_clubs: clubNumbers,
      })
      if (error) throw new Error(error.message)
      const field = personField === 'bookedBy' ? 'booked_by_name' : 'trainer_name'
      return (data || [])
        .filter(r => matchesPerson(r[field], person))
        .map(r => ({
          member: r.contact_name || 'Unnamed member',
          date: String(r.scheduled_date).slice(0, 10),
          overdue: Number(r.days_overdue) || 0,
          trainer: r.trainer_name || 'Unassigned',
          bookedBy: r.booked_by_name || '—',
        }))
        .sort((a, b) => b.overdue - a.overdue)
    },
  },

  // -- Membership -----------------------------------------------------------
  'new-members': {
    label: 'New Members',
    columns: [
      { key: 'member', label: 'Member', format: T.text },
      { key: 'type', label: 'Membership', format: T.text },
      { key: 'joined', label: 'Joined', format: T.date },
      { key: 'dues', label: 'Monthly Dues', format: T.money },
      { key: 'down', label: 'Down Payment', format: T.money },
      { key: 'method', label: 'Payment', format: T.text },
      { key: 'salesperson', label: 'Sold By', format: T.text },
    ],
    // Counted on since_date, the day the MEMBERSHIP started, for the same
    // reason every other report does: sign_date moves onto the latest agreement,
    // so selecting on it both double-counts re-signs and loses the original sale.
    async load({ start, end, clubNumbers, person, filter }) {
      const q = lazySupabase()
        .from('abc_members')
        .select('first_name, last_name, membership_type, since_date, next_due_amount, down_payment, agreement_payment_method, sales_person_name, club_number')
        .gte('since_date', start)
        .lte('since_date', end)
      if (clubNumbers) q.in('club_number', clubNumbers)
      const rows = await fetchAllRows(q)
      return rows
        .filter(r => matchesPerson(r.sales_person_name, person))
        // EXACTLY the report's own test, imported rather than restated: ABC
        // writes 'EFT' for a bank draft and Salesperson Snapshot counts that
        // one value. A looser match here would open a longer list than the
        // number it was clicked from, which is the one thing a drill-down must
        // never do.
        .filter(r => filter === 'ach' ? r.agreement_payment_method === ACH_PAYMENT_METHOD : true)
        .map(r => ({
          member: name(r.first_name, r.last_name),
          type: r.membership_type || '—',
          joined: String(r.since_date).slice(0, 10),
          dues: money(r.next_due_amount),
          down: money(r.down_payment),
          method: r.agreement_payment_method || '—',
          salesperson: r.sales_person_name ? displayName(r.sales_person_name) : '—',
        }))
        .sort((a, b) => b.joined.localeCompare(a.joined))
    },
  },

  // -- Referrals and tours --------------------------------------------------
  'vips': {
    label: 'VIP Referrals',
    columns: [
      { key: 'member', label: 'Referred By', format: T.text },
      { key: 'date', label: 'Collected', format: T.date },
      { key: 'employee', label: 'Collected By', format: T.text },
      { key: 'source', label: 'Source', format: T.text },
    ],
    // vip_credits stores the employee and a GHL contact id but no member name,
    // so without the contact lookup this list is a column of blanks. Chunked
    // because PostgREST caps how long an `in` list can be.
    async load({ start, end, clubNumbers, person }) {
      const q = lazySupabase()
        .from('vip_credits')
        .select('ghl_contact_id, employee_name, credited_at, source, club_number')
        .gte('credited_at', `${start}T00:00:00Z`)
        .lte('credited_at', `${end}T23:59:59.999Z`)
      if (clubNumbers) q.in('club_number', clubNumbers)
      const rows = (await fetchAllRows(q)).filter(r => matchesPerson(r.employee_name, person))

      const names = await contactNames(rows.map(r => r.ghl_contact_id))
      return rows
        .map(r => ({
          member: names.get(r.ghl_contact_id) || 'Unnamed contact',
          date: String(r.credited_at).slice(0, 10),
          employee: r.employee_name ? displayName(r.employee_name) : '—',
          source: r.source || '—',
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },

  'tours': {
    label: 'Tours',
    columns: [
      { key: 'member', label: 'Prospect', format: T.text },
      { key: 'date', label: 'Given', format: T.date },
      { key: 'givenBy', label: 'Given By', format: T.text },
      { key: 'outcome', label: 'Outcome', format: T.text },
    ],
    // Completed only: a row still at 'ready' is a check-in nobody closed out,
    // not a tour that happened.
    async load({ start, end, clubNumbers, person }) {
      const q = lazySupabase()
        .from('tour_intakes')
        .select('contact_name, completed_at, given_by_name, outcome, club_number, status')
        .eq('status', 'completed')
        .gte('completed_at', `${start}T00:00:00Z`)
        .lte('completed_at', `${end}T23:59:59.999Z`)
      if (clubNumbers) q.in('club_number', clubNumbers)
      const rows = await fetchAllRows(q)
      return rows
        .filter(r => matchesPerson(r.given_by_name, person))
        .map(r => ({
          member: r.contact_name || 'Unnamed prospect',
          date: String(r.completed_at).slice(0, 10),
          givenBy: r.given_by_name ? displayName(r.given_by_name) : '—',
          outcome: r.outcome || '—',
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
    },
  },
}

/**
 * Sessions folded into one row per member.
 *
 * Keyed on the displayed name, which is already normalised through
 * displayName, so "Katie  Castlio" and "Katie Castlio" are one client rather
 * than two rows that each look like half the truth.
 */
function groupSessionsIntoClients(sessions) {
  const byMember = new Map()
  for (const s of sessions || []) {
    const cur = byMember.get(s.member) || { member: s.member, sessions: 0, minutes: 0, lastSeen: '' }
    cur.sessions += 1
    cur.minutes += Number(s.minutes) || 0
    if (String(s.date) > cur.lastSeen) cur.lastSeen = String(s.date)
    byMember.set(s.member, cur)
  }
  return [...byMember.values()]
    .sort((a, b) => b.sessions - a.sessions || a.member.localeCompare(b.member))
}

const DISPLAY_STATUS = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  no_show: 'No Show',
  cancelled: 'Cancelled',
}

/** Names for a set of GHL contact ids, chunked under the `in` list cap. */
async function contactNames(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))]
  const out = new Map()
  const CHUNK = 200
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data, error } = await lazySupabase()
      .from('ghl_contacts_v2')
      .select('id, first_name, last_name')
      .in('id', unique.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const c of data || []) out.set(c.id, name(c.first_name, c.last_name))
  }
  return out
}

/** Page a PostgREST query out in full: it truncates at 1000 rows silently. */
async function fetchAllRows(query) {
  const { fetchAll } = require('./supabaseFetchAll')
  return fetchAll(query)
}

function setKeys() {
  return Object.keys(SETS)
}

/**
 * Run one record set, WHOLE and unpaged.
 *
 * Paging is the route's job, deliberately: it caches what comes back from here
 * and slices that, so clicking through to page three re-slices rows already in
 * memory instead of running the query again. Slicing here would also have meant
 * the cache held one page and every other page came back empty.
 */
async function loadRecordSet(setKey, params) {
  const set = SETS[setKey]
  if (!set) throw Object.assign(new Error(`Unknown record set: ${setKey}`), { status: 400 })
  const rows = await set.load(params)
  return { label: set.label, columns: set.columns, rows, total: rows.length }
}

module.exports = {
  SETS, setKeys, loadRecordSet, clubNumbersFor, matchesPerson,
  groupSessionsIntoClients, DEFAULT_LIMIT, MAX_LIMIT,
}
