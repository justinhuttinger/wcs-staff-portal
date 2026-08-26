// Pure aggregation for the Analytics > Salesperson Performance report.
//
// Deliberately free of any I/O or Supabase import: the route does the fetching
// and hands plain arrays in here, which keeps the arithmetic (unit counts,
// percentages, Day One matching) testable without a database or a network.
// See routes/analyticsSalesperson.js for what each column means and why the
// columns with no data source return null.

const CLUBS = [
  { slug: 'salem', clubNumber: '30935', name: 'Salem' },
  { slug: 'keizer', clubNumber: '31599', name: 'Keizer' },
  { slug: 'eugene', clubNumber: '7655', name: 'Eugene' },
  { slug: 'springfield', clubNumber: '31598', name: 'Springfield' },
  { slug: 'clackamas', clubNumber: '31600', name: 'Clackamas' },
  // Milwaukie trades as East Side Athletic Club; the source tool lists it under
  // that name, so the report does too.
  { slug: 'milwaukie', clubNumber: '31601', name: 'East Side Athletic Club' },
  { slug: 'medford', clubNumber: '32073', name: 'Medford' },
]
const CLUB_BY_NUMBER = Object.fromEntries(CLUBS.map(c => [c.clubNumber, c]))
const CLUB_BY_SLUG = Object.fromEntries(CLUBS.map(c => [c.slug, c]))

// Membership types dropped when `exclusion=exclude` come from
// abc_membership_skip_list — the same list every other membership report uses,
// so a unit count here always agrees with a unit count there. Exclusion is the
// default; pass exclusion=include to count the skipped types anyway.
function isExcludedType(membershipType, skipList) {
  return skipList.has((membershipType || '').toLowerCase())
}

// ABC stores salesperson as "First  Last" (often with a doubled space); the Day
// One table stores the booker as "First Last". Collapse both to a single key so
// the two halves of the report line up.
function personKey(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// Display as "Last, First" to match the source tool's row labels.
function displayName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Unknown'
  if (parts.length === 1) return parts[0]
  const first = parts[0]
  const last = parts.slice(1).join(' ')
  return `${last}, ${first}`
}

function digits10(value) {
  const d = (value || '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}

function ageOn(birthDate, onDate) {
  if (!birthDate) return null
  const b = new Date(birthDate + 'T00:00:00')
  const d = new Date(onDate + 'T00:00:00')
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null
  let age = d.getFullYear() - b.getFullYear()
  const m = d.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age -= 1
  return age
}

const AGE_GROUPS = [
  { key: 'under_18', label: 'Under 18', test: a => a !== null && a < 18 },
  { key: '18_24', label: '18-24', test: a => a !== null && a >= 18 && a <= 24 },
  { key: '25_34', label: '25-34', test: a => a !== null && a >= 25 && a <= 34 },
  { key: '35_44', label: '35-44', test: a => a !== null && a >= 35 && a <= 44 },
  { key: '45_54', label: '45-54', test: a => a !== null && a >= 45 && a <= 54 },
  { key: '55_64', label: '55-64', test: a => a !== null && a >= 55 && a <= 64 },
  { key: '65_plus', label: '65+', test: a => a !== null && a >= 65 },
  { key: 'unknown', label: 'Unknown', test: a => a === null },
]

function ageGroupKey(age) {
  return (AGE_GROUPS.find(g => g.test(age)) || AGE_GROUPS[AGE_GROUPS.length - 1]).key
}

function pct(numerator, denominator) {
  if (!denominator) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

/**
 * Build lookup maps from the in-range members so a Day One can be resolved back
 * to the member it belongs to. Matching only ever considers members inside the
 * requested window, which is what "Book on Join Date" needs — a Day One booked
 * for someone who joined last year is not a book-on-join-date.
 */
function buildMemberIndex(members) {
  const byEmail = new Map()
  const byPhone = new Map()
  const byName = new Map()
  for (const m of members) {
    const em = (m.email || '').trim().toLowerCase()
    if (em) if (!byEmail.has(em)) byEmail.set(em, m)
    const ph = digits10(m.mobile_phone || m.primary_phone)
    if (ph) if (!byPhone.has(ph)) byPhone.set(ph, m)
    const nm = personKey(`${m.first_name || ''} ${m.last_name || ''}`)
    if (nm) if (!byName.has(nm)) byName.set(nm, m)
  }
  return { byEmail, byPhone, byName }
}

function matchMember(index, contact, dayOne) {
  const em = (contact?.email || dayOne.contact_email || '').trim().toLowerCase()
  if (em && index.byEmail.has(em)) return index.byEmail.get(em)
  const ph = digits10(contact?.phone)
  if (ph && index.byPhone.has(ph)) return index.byPhone.get(ph)
  const nm = personKey(
    contact ? `${contact.first_name || ''} ${contact.last_name || ''}` : dayOne.contact_name
  )
  if (nm && index.byName.has(nm)) return index.byName.get(nm)
  return null
}

// ---------------------------------------------------------------------------

function buildReport(members, dayOnes, contactsById, filters, skipList = new Set()) {
  // --- filter members -----------------------------------------------------
  const kept = members.filter(m => {
    if (filters.exclusion !== 'include' && isExcludedType(m.membership_type, skipList)) return false
    if (filters.joinSource && (m.agreement_entry_source || 'Unknown') !== filters.joinSource) return false
    if (filters.membershipType && (m.membership_type || 'Unknown') !== filters.membershipType) return false
    if (filters.gender && (m.gender || 'Unknown') !== filters.gender) return false
    if (filters.paymentTerm && (m.payment_frequency || 'Unknown') !== filters.paymentTerm) return false
    if (filters.ageGroup && ageGroupKey(ageOn(m.birth_date, m.sign_date)) !== filters.ageGroup) return false
    return true
  })

  const index = buildMemberIndex(kept)

  // --- rows ---------------------------------------------------------------
  // Key is club slug + normalized person, so the two halves merge.
  const rows = new Map()
  function rowFor(clubSlug, rawName) {
    const key = `${clubSlug}|${personKey(rawName) || 'unknown'}`
    if (!rows.has(key)) {
      const club = CLUB_BY_SLUG[clubSlug]
      rows.set(key, {
        key,
        clubSlug,
        club: club?.name || clubSlug,
        salesperson: rawName ? displayName(rawName) : 'Unknown',
        newMemberUnits: 0,
        totalNewDues: 0,
        totalDownPayment: 0,
        achUnits: 0,
        achKnownUnits: 0,
        dayOneBookCount: 0,
        bookOnJoinDateCount: 0,
        memberIds: [],
      })
    }
    return rows.get(key)
  }

  for (const m of kept) {
    const club = CLUB_BY_NUMBER[m.club_number]
    if (!club) continue
    const row = rowFor(club.slug, m.sales_person_name)
    row.newMemberUnits += 1
    row.totalNewDues += Number(m.next_due_amount) || 0
    row.totalDownPayment += Number(m.down_payment) || 0
    row.memberIds.push(m.id)
    // % on ACH is intentionally not computed: abc_members carries no payment
    // method. See the PR notes — the field has to be added to the ABC sync
    // before this can be anything but null.
  }

  for (const d of dayOnes) {
    const club = CLUB_BY_SLUG[d.location_slug]
    if (!club) continue
    const row = rowFor(d.location_slug, d.booked_by_name)
    row.dayOneBookCount += 1
    const member = matchMember(index, contactsById.get(d.ghl_contact_id), d)
    if (member && d.booked_at) {
      const bookedOn = new Date(d.booked_at).toISOString().slice(0, 10)
      if (bookedOn === member.sign_date) row.bookOnJoinDateCount += 1
    }
  }

  // --- club totals, for "% of Club Total" ---------------------------------
  const clubUnits = new Map()
  for (const row of rows.values()) {
    clubUnits.set(row.clubSlug, (clubUnits.get(row.clubSlug) || 0) + row.newMemberUnits)
  }

  const out = [...rows.values()].map(row => ({
    key: row.key,
    clubSlug: row.clubSlug,
    club: row.club,
    salesperson: row.salesperson,
    newMemberUnits: row.newMemberUnits,
    pctOfClubTotal: pct(row.newMemberUnits, clubUnits.get(row.clubSlug)),
    // Pending a payment-method field on the ABC sync.
    pctOnAch: null,
    totalNewDuesDraft: Math.round(row.totalNewDues * 100) / 100,
    avgNewDuesDraft: row.newMemberUnits
      ? Math.round((row.totalNewDues / row.newMemberUnits) * 100) / 100
      : null,
    totalDownPayment: Math.round(row.totalDownPayment * 100) / 100,
    // Pending a persisted tour-events table; tours are live-fetched from GHL
    // today and nothing is stored, so there is nothing to aggregate over.
    toursGiven: null,
    tourConversionRate: null,
    avgDaysToConversion: null,
    dayOneBookCount: row.dayOneBookCount,
    dayOneBookPct: pct(row.dayOneBookCount, row.newMemberUnits),
    bookOnJoinDateCount: row.bookOnJoinDateCount,
    bookOnJoinDatePct: pct(row.bookOnJoinDateCount, row.newMemberUnits),
  }))
  // Drop rows that carry no activity at all — a stale salesperson with zero
  // units and zero bookings is noise, not a zero worth showing.
  .filter(r => r.newMemberUnits > 0 || r.dayOneBookCount > 0)

  const totals = out.reduce((acc, r) => {
    acc.newMemberUnits += r.newMemberUnits
    acc.totalNewDuesDraft += r.totalNewDuesDraft
    acc.dayOneBookCount += r.dayOneBookCount
    acc.bookOnJoinDateCount += r.bookOnJoinDateCount
    return acc
  }, { newMemberUnits: 0, totalNewDuesDraft: 0, dayOneBookCount: 0, bookOnJoinDateCount: 0 })

  const summary = {
    newMemberUnits: totals.newMemberUnits,
    pctOnAch: null,
    totalNewDuesDraft: Math.round(totals.totalNewDuesDraft * 100) / 100,
    avgNewDuesDraft: totals.newMemberUnits
      ? Math.round((totals.totalNewDuesDraft / totals.newMemberUnits) * 100) / 100
      : null,
    toursGiven: null,
    tourConversionRate: null,
    avgDaysToConversion: null,
    dayOneBookCount: totals.dayOneBookCount,
    dayOneBookPct: pct(totals.dayOneBookCount, totals.newMemberUnits),
    bookOnJoinDateCount: totals.bookOnJoinDateCount,
    bookOnJoinDatePct: pct(totals.bookOnJoinDateCount, totals.newMemberUnits),
  }

  // Averages drive the dashed reference lines on each bar column.
  const n = out.length || 1
  const averages = {
    newMemberUnits: Math.round((totals.newMemberUnits / n) * 10) / 10,
    dayOneBookPct: pct(totals.dayOneBookCount, totals.newMemberUnits),
    bookOnJoinDatePct: pct(totals.bookOnJoinDateCount, totals.newMemberUnits),
    avgNewDuesDraft: summary.avgNewDuesDraft,
  }

  return { rows: out, summary, averages }
}

// Filter option lists come from the rows actually in range, so the dropdowns
// never offer a value that would return nothing.
function buildFilterOptions(members) {
  const uniq = (vals) => [...new Set(vals.filter(v => v !== null && v !== undefined && v !== ''))].sort()
  return {
    joinSource: uniq(members.map(m => m.agreement_entry_source)),
    membershipType: uniq(members.map(m => m.membership_type)),
    gender: uniq(members.map(m => m.gender)),
    paymentTerm: uniq(members.map(m => m.payment_frequency)),
    ageGroup: AGE_GROUPS.map(g => ({ key: g.key, label: g.label })),
  }
}

module.exports = {
  CLUBS, CLUB_BY_NUMBER, CLUB_BY_SLUG, AGE_GROUPS,
  buildReport, buildFilterOptions, buildMemberIndex, matchMember,
  isExcludedType, personKey, displayName, digits10, ageOn, ageGroupKey, pct,
}
