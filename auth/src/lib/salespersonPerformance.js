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

/**
 * Club display name from a club number, tolerating a leading zero.
 *
 * abc_members stores '7655' while abc_revenue_transactions stores '07655', so a
 * revenue-sourced report looked Eugene up by the padded form, missed, and
 * printed a raw "07655" in its legend beside six real club names.
 */
function clubName(n) {
  const raw = String(n ?? '')
  const hit = CLUB_BY_NUMBER[raw] || CLUB_BY_NUMBER[raw.replace(/^0+/, '')]
  return hit ? hit.name : raw
}

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

// Display as "First Last". ABC stores the name that way already but with
// inconsistent inner whitespace ("Katie  Castlio"), so this only normalizes.
function displayName(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'Unknown'
  return parts.join(' ')
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

// ABC's agreementPaymentMethod values. "EFT" is a bank draft — that is ACH.
// Cash and Statement agreements do not draft at all but still count toward the
// denominator: the question is what share of new members are on ACH, not what
// share of drafting members are.
const ACH_PAYMENT_METHOD = 'EFT'

// A NEW MEMBER IS ONE WHOSE MEMBERSHIP STARTED IN THE WINDOW — since_date.
//
// This used to select on sign_date and then drop anything where
// since_date < sign_date, on the reasoning that such an agreement is a renewal.
// That is true of the AGREEMENT and false of the MEMBER, and it lost real
// sales: sign_date MOVES onto the latest agreement, so a member who joined in
// March and re-signed in June has a June sign_date and a March since_date, and
// the test threw them out of both months. 514 genuinely new members disappeared
// from Jan-Jul 2026 that way — the salesperson who signed them got no credit at
// all, and the report read 5,123 against Membership Trends' 5,650.
//
// since_date does not move on a re-sign, so selecting on it counts each member
// exactly once, in the month they actually joined, and the two reports agree by
// construction rather than by coincidence.
//
// The filter is kept only as a guard against rows with no since_date at all.
function isNewSale(m) {
  return !!m.since_date
}

// How rows are grouped. 'club_salesperson' is the default and matches the
// source tool.
const VIEW_BY = ['club_salesperson', 'club', 'salesperson']

/**
 * Does this row touch any club that records the thing at all?
 *
 * A row with no club attached (salesperson-only grouping, or a person whose
 * only activity is a tour) falls back to the whole selection, because refusing
 * to answer would blank the column for the very rows the reader came for.
 */
function anyIn(row, configuredClubs) {
  if (configuredClubs.size === 0) return false
  if (row.clubNumbers.size === 0) return true
  for (const n of row.clubNumbers) if (configuredClubs.has(n)) return true
  return false
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

function buildReport(members, dayOnes, contactsById, filters, skipList = new Set(), extras = {}) {
  // VIP credits and completed tours, each carrying the set of clubs that record
  // them at all. A club outside that set gets null rather than 0 — see
  // loadVipCredits for why that distinction is not pedantry.
  const vipCredits = extras.vips?.credits || []
  const vipClubs = extras.vips?.configuredClubs || new Set()
  const tourRows = extras.tours?.tours || []
  const tourClubs = extras.tours?.configuredClubs || new Set()
  const saleOutcomes = extras.tours?.saleOutcomes || new Set()
  // --- filter members -----------------------------------------------------
  const kept = members.filter(m => {
    if (filters.exclusion !== 'include' && isExcludedType(m.membership_type, skipList)) return false
    if (!isNewSale(m)) return false
    if (filters.joinSource && (m.agreement_entry_source || 'Unknown') !== filters.joinSource) return false
    if (filters.membershipType && (m.membership_type || 'Unknown') !== filters.membershipType) return false
    if (filters.gender && (m.gender || 'Unknown') !== filters.gender) return false
    // agreement_term (Open/Cash/Installment/Cash Open), not payment_frequency,
    // which is only ever "Monthly" or null.
    if (filters.paymentTerm && (m.agreement_term || 'Unknown') !== filters.paymentTerm) return false
    if (filters.paymentMethod && (m.agreement_payment_method || 'Unknown') !== filters.paymentMethod) return false
    if (filters.memberRelationship) {
      // is_primary_member is null on rows the backfill has not reached yet, and
      // an unknown relationship is not evidence of either one.
      if (m.is_primary_member === null || m.is_primary_member === undefined) return false
      const wantPrimary = filters.memberRelationship === 'primary'
      if (m.is_primary_member !== wantPrimary) return false
    }
    if (filters.ageGroup && ageGroupKey(ageOn(m.birth_date, m.since_date || m.sign_date)) !== filters.ageGroup) return false
    return true
  })

  const index = buildMemberIndex(kept)

  // --- rows ---------------------------------------------------------------
  // The grouping key decides what a row means. In every mode the key is built
  // the same way from both halves (memberships and Day One bookings), so a
  // person's sales and their bookings always land on the same row.
  const viewBy = VIEW_BY.includes(filters.viewBy) ? filters.viewBy : 'club_salesperson'
  const rows = new Map()
  function rowFor(clubSlug, rawName) {
    const person = personKey(rawName) || 'unknown'
    const key = viewBy === 'club' ? clubSlug
      : viewBy === 'salesperson' ? person
      : `${clubSlug}|${person}`
    if (!rows.has(key)) {
      const club = CLUB_BY_SLUG[clubSlug]
      rows.set(key, {
        key,
        // In salesperson-only mode a person can span clubs, so the row is not
        // tied to one — leave the club fields off rather than pick a winner.
        clubSlug: viewBy === 'salesperson' ? null : clubSlug,
        club: viewBy === 'salesperson' ? null : (club?.name || clubSlug),
        salesperson: viewBy === 'club' ? null : (rawName ? displayName(rawName) : 'Unknown'),
        newMemberUnits: 0,
        totalNewDues: 0,
        totalDownPayment: 0,
        achUnits: 0,
        achKnownUnits: 0,
        paymentMix: {},
        dayOneBookCount: 0,
        bookOnJoinDateCount: 0,
        vipCount: 0,
        toursGiven: 0,
        toursConverted: 0,
        clubNumbers: new Set(),
        memberIds: [],
      })
    }
    return rows.get(key)
  }

  for (const m of kept) {
    const club = CLUB_BY_NUMBER[m.club_number]
    if (!club) continue
    const row = rowFor(club.slug, m.sales_person_name)
    // Which clubs this row draws on, so a salesperson-only row can tell whether
    // VIPs are configured everywhere they worked.
    row.clubNumbers.add(m.club_number)
    row.newMemberUnits += 1
    row.totalNewDues += Number(m.next_due_amount) || 0
    row.totalDownPayment += Number(m.down_payment) || 0
    row.memberIds.push(m.id)
    const method = m.agreement_payment_method || null
    if (method) {
      row.achKnownUnits += 1
      row.paymentMix[method] = (row.paymentMix[method] || 0) + 1
      if (method === ACH_PAYMENT_METHOD) row.achUnits += 1
    }
  }

  for (const d of dayOnes) {
    const club = CLUB_BY_SLUG[d.location_slug]
    if (!club) continue
    const row = rowFor(d.location_slug, d.booked_by_name)
    row.dayOneBookCount += 1
    const member = matchMember(index, contactsById.get(d.ghl_contact_id), d)
    if (member && d.booked_at) {
      const bookedOn = new Date(d.booked_at).toISOString().slice(0, 10)
      // Compared against the day they JOINED, not the day their current
      // agreement was signed — for a member who re-signed those are different
      // days, and the Day One was booked against the first one.
      if (bookedOn === (member.since_date || member.sign_date)) row.bookOnJoinDateCount += 1
    }
  }

  // VIPs are credited to the employee named ON THE CREDIT, not to whoever sold
  // the membership. All 35 names in the last three months resolve to a
  // salesperson exactly once whitespace and case are normalised.
  for (const v of vipCredits) {
    const club = CLUB_BY_NUMBER[v.club_number]
    if (!club) continue
    const row = rowFor(club.slug, v.employee_name)
    row.clubNumbers.add(v.club_number)
    row.vipCount += 1
  }

  // Tours are credited to whoever GAVE the tour, which is not necessarily
  // whoever closed the sale or whoever closed the card out at the desk.
  for (const t of tourRows) {
    const club = CLUB_BY_NUMBER[t.club_number]
    if (!club) continue
    const row = rowFor(club.slug, t.given_by_name)
    row.clubNumbers.add(t.club_number)
    row.toursGiven += 1
    if (saleOutcomes.has(t.outcome)) row.toursConverted += 1
  }

  // --- denominator for the "% of Total" column ----------------------------
  // Grouped by club AND salesperson, the useful comparison is against the
  // person's own club. Grouped by club or by salesperson alone, every row
  // would be 100% of itself, so compare against the whole selection instead.
  const clubUnits = new Map()
  let grandUnits = 0
  for (const row of rows.values()) {
    clubUnits.set(row.clubSlug, (clubUnits.get(row.clubSlug) || 0) + row.newMemberUnits)
    grandUnits += row.newMemberUnits
  }
  const denominatorFor = (row) =>
    viewBy === 'club_salesperson' ? clubUnits.get(row.clubSlug) : grandUnits

  const out = [...rows.values()].map(row => ({
    key: row.key,
    clubSlug: row.clubSlug,
    club: row.club,
    salesperson: row.salesperson,
    newMemberUnits: row.newMemberUnits,
    pctOfClubTotal: pct(row.newMemberUnits, denominatorFor(row)),
    // Denominator is units with a KNOWN payment method, not all units. Under a
    // partial backfill that keeps the number honest instead of diluting it
    // toward 0%; once every row is populated the two are the same thing.
    pctOnAch: row.achKnownUnits ? pct(row.achUnits, row.achKnownUnits) : null,
    achUnits: row.achUnits,
    achKnownUnits: row.achKnownUnits,
    paymentMix: row.paymentMix,
    totalNewDuesDraft: Math.round(row.totalNewDues * 100) / 100,
    avgNewDuesDraft: row.newMemberUnits
      ? Math.round((row.totalNewDues / row.newMemberUnits) * 100) / 100
      : null,
    totalDownPayment: Math.round(row.totalDownPayment * 100) / 100,
    // Real now that the check-in keeps completed rows. Still null for a club
    // that has never recorded one, because every window before 2026-08-28 is
    // empty by construction rather than because nobody gave a tour.
    toursGiven: anyIn(row, tourClubs) ? row.toursGiven : null,
    tourConversionRate: anyIn(row, tourClubs) ? pct(row.toursConverted, row.toursGiven) : null,
    avgDaysToConversion: null,
    dayOneBookCount: row.dayOneBookCount,
    dayOneBookPct: pct(row.dayOneBookCount, row.newMemberUnits),
    bookOnJoinDateCount: row.bookOnJoinDateCount,
    bookOnJoinDatePct: pct(row.bookOnJoinDateCount, row.newMemberUnits),
    // VIPs against memberships sold. Null, not zero, where the club does not
    // collect VIPs at all — Milwaukie has no VIP fields in GHL, and printing 0%
    // there blames the staff for a configuration gap.
    vipCount: anyIn(row, vipClubs) ? row.vipCount : null,
    vipPct: anyIn(row, vipClubs) ? pct(row.vipCount, row.newMemberUnits) : null,
  }))
  // Drop rows that carry no activity at all — a stale salesperson with zero
  // units and zero bookings is noise, not a zero worth showing. VIPs and tours
  // count as activity: somebody who collected VIPs all month and sold nothing
  // has still done something the report should show.
  .filter(r => r.newMemberUnits > 0 || r.dayOneBookCount > 0 || r.vipCount > 0 || r.toursGiven > 0)

  const totals = out.reduce((acc, r) => {
    acc.newMemberUnits += r.newMemberUnits
    acc.totalNewDuesDraft += r.totalNewDuesDraft
    acc.dayOneBookCount += r.dayOneBookCount
    acc.bookOnJoinDateCount += r.bookOnJoinDateCount
    acc.achUnits += r.achUnits
    acc.achKnownUnits += r.achKnownUnits
    // Summed off the ROWS, so a club that reports null contributes nothing
    // rather than dragging the club total toward zero.
    acc.vipCount += r.vipCount || 0
    acc.toursGiven += r.toursGiven || 0
    acc.toursConverted += r.tourConversionRate === null
      ? 0
      : Math.round((r.tourConversionRate / 100) * (r.toursGiven || 0))
    return acc
  }, { newMemberUnits: 0, totalNewDuesDraft: 0, dayOneBookCount: 0, bookOnJoinDateCount: 0,
       achUnits: 0, achKnownUnits: 0, vipCount: 0, toursGiven: 0, toursConverted: 0 })

  const anyVip = out.some(r => r.vipCount !== null)
  const anyTour = out.some(r => r.toursGiven !== null)

  const summary = {
    newMemberUnits: totals.newMemberUnits,
    pctOnAch: totals.achKnownUnits ? pct(totals.achUnits, totals.achKnownUnits) : null,
    totalNewDuesDraft: Math.round(totals.totalNewDuesDraft * 100) / 100,
    avgNewDuesDraft: totals.newMemberUnits
      ? Math.round((totals.totalNewDuesDraft / totals.newMemberUnits) * 100) / 100
      : null,
    toursGiven: anyTour ? totals.toursGiven : null,
    tourConversionRate: anyTour ? pct(totals.toursConverted, totals.toursGiven) : null,
    avgDaysToConversion: null,
    vipCount: anyVip ? totals.vipCount : null,
    vipPct: anyVip ? pct(totals.vipCount, totals.newMemberUnits) : null,
    dayOneBookCount: totals.dayOneBookCount,
    dayOneBookPct: pct(totals.dayOneBookCount, totals.newMemberUnits),
    bookOnJoinDateCount: totals.bookOnJoinDateCount,
    bookOnJoinDatePct: pct(totals.bookOnJoinDateCount, totals.newMemberUnits),
  }

  // Averages drive the dashed reference lines on each bar column.
  const n = out.length || 1
  const averages = {
    newMemberUnits: Math.round((totals.newMemberUnits / n) * 10) / 10,
    pctOnAch: totals.achKnownUnits ? pct(totals.achUnits, totals.achKnownUnits) : null,
    dayOneBookPct: pct(totals.dayOneBookCount, totals.newMemberUnits),
    bookOnJoinDatePct: pct(totals.bookOnJoinDateCount, totals.newMemberUnits),
    avgNewDuesDraft: summary.avgNewDuesDraft,
  }

  return { rows: out, summary, averages, viewBy }
}

// Filter option lists come from the rows actually in range, so the dropdowns
// never offer a value that would return nothing.
function buildFilterOptions(members) {
  const uniq = (vals) => [...new Set(vals.filter(v => v !== null && v !== undefined && v !== ''))].sort()
  return {
    joinSource: uniq(members.map(m => m.agreement_entry_source)),
    membershipType: uniq(members.map(m => m.membership_type)),
    gender: uniq(members.map(m => m.gender)),
    paymentTerm: uniq(members.map(m => m.agreement_term)),
    paymentMethod: uniq(members.map(m => m.agreement_payment_method)),
    ageGroup: AGE_GROUPS.map(g => ({ key: g.key, label: g.label })),
    memberRelationship: [
      { key: 'primary', label: 'Primary' },
      { key: 'secondary', label: 'Secondary / Add-on' },
    ],
  }
}

module.exports = {
  CLUBS, CLUB_BY_NUMBER, CLUB_BY_SLUG, AGE_GROUPS,
  buildReport, buildFilterOptions, buildMemberIndex, matchMember,
  isExcludedType, personKey, displayName, digits10, ageOn, ageGroupKey, pct,
  ACH_PAYMENT_METHOD, VIEW_BY, isNewSale, clubName,
}
