// VIP Analysis — how far VIP referrals actually get.
//
// Three numbers per row, and the whole point is the drop between them:
//
//   Collected  a VIP credit was recorded in the window (vip_credits)
//   Came In    that person later completed a tour  (tour_intakes, status=completed)
//   Signed Up  that person later joined            (abc_members)
//
// Each step is measured on the SAME person, matched through their GHL contact
// id, so the funnel narrows honestly instead of comparing three separately
// counted populations that happen to sit next to each other.
//
// EVERY STEP MUST HAPPEN AFTER THE ONE BEFORE IT. A tour that predates the
// referral is not that referral arriving, and a member who joined before being
// referred was not converted by it. Without the ordering rule an existing
// member who gets referred by a friend would score a conversion on the day they
// were referred, which is exactly backwards.
//
// NOT CONFIGURED IS NOT ZERO, and this report has two of them:
//
//   - Milwaukie has never recorded a VIP credit, because its GHL location has
//     no VIP fields set up. "0 VIPs collected" makes a claim about the staff
//     when the truth is a claim about the setup.
//   - Completed tours have only been kept since the tour check-in module
//     started storing them; before that the row was deleted on completion. Any
//     window earlier than a club's first recorded tour would show every VIP
//     failing to come in, which is a claim about our storage, not about them.
//
// Both are judged over the LIFETIME of the table rather than the window, or a
// club with a slow month would be branded unconfigured.

const { buildMemberIndex, matchMember, displayName, CLUB_BY_NUMBER, pct } = require('./salespersonPerformance')
const { UNASSIGNED_LABEL } = require('./analyticsSegments')

const VIEW_BY = ['club', 'collector']

/** YYYY-MM-DD from a timestamp, or null. */
function dayOf(ts) {
  if (!ts) return null
  const s = String(ts)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

/**
 * @param credits          vip_credits rows: { ghl_contact_id, club_number, employee_name, credited_at }
 * @param opts.contactsById   Map of GHL contact id -> contact (email/phone/name)
 * @param opts.tours          completed tour_intakes: { ghl_contact_id, completed_at }
 * @param opts.members        abc_members from the window onward, for the join
 * @param opts.vipClubs       Set of club numbers that have EVER credited a VIP
 * @param opts.tourClubs      Set of club numbers that have EVER completed a tour
 * @param opts.viewBy         'club' | 'collector'
 */
function buildVipAnalysis(credits, opts = {}) {
  const viewBy = VIEW_BY.includes(opts.viewBy) ? opts.viewBy : 'club'
  const contactsById = opts.contactsById || new Map()
  const vipClubs = opts.vipClubs || new Set()
  const tourClubs = opts.tourClubs || new Set()

  // EVERY completed tour per contact, not just the earliest.
  //
  // Taking the earliest and then testing it against the referral date gets
  // somebody who had toured before AND came back after exactly backwards: the
  // earlier visit fails the test and the later one is never looked at, so a
  // returning prospect scores as never having come in. The question is whether
  // there is ANY tour on or after the referral, so keep them all.
  const toursByContact = new Map()
  for (const t of (opts.tours || [])) {
    const d = dayOf(t.completed_at)
    if (!t.ghl_contact_id || !d) continue
    const list = toursByContact.get(t.ghl_contact_id) || []
    list.push(d)
    toursByContact.set(t.ghl_contact_id, list)
  }

  const index = buildMemberIndex(opts.members || [])

  const rows = new Map()
  const rowFor = (key, label, clubNumber) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key, label,
        clubNumbers: new Set(),
        collected: 0, cameIn: 0, signedUp: 0,
      })
    }
    const row = rows.get(key)
    if (clubNumber) row.clubNumbers.add(clubNumber)
    return row
  }

  for (const c of credits || []) {
    const club = CLUB_BY_NUMBER[c.club_number]
    // A credit against a club this report was not asked about, or a club that
    // is not one of ours, is not silently folded into somebody else's row.
    if (!club) continue

    const creditedOn = dayOf(c.credited_at)
    const key = viewBy === 'club'
      ? club.slug
      : (c.employee_name ? displayName(c.employee_name) : UNASSIGNED_LABEL)
    const label = viewBy === 'club' ? club.name : key
    const row = rowFor(key, label, c.club_number)

    row.collected += 1

    // Counted once per referral however many times they toured: this is a
    // count of people who came in, not of visits.
    const cameIn = !!creditedOn
      && (toursByContact.get(c.ghl_contact_id) || []).some(d => d >= creditedOn)
    if (cameIn) row.cameIn += 1

    const contact = contactsById.get(c.ghl_contact_id) || null
    const member = contact ? matchMember(index, contact, {}) : null
    const joinedOn = member ? dayOf(member.since_date || member.sign_date) : null
    if (member && joinedOn && creditedOn && joinedOn >= creditedOn) row.signedUp += 1
  }

  // A row's clubs decide whether its numbers mean anything. A collector row can
  // span clubs, so it is unconfigured only when EVERY club it drew from is.
  const anyIn = (row, set) => [...row.clubNumbers].some(n => set.has(n))

  const out = [...rows.values()]
    .map(r => {
      const vipOk = anyIn(r, vipClubs)
      const tourOk = anyIn(r, tourClubs)
      return {
        key: r.key,
        label: r.label,
        collected: vipOk ? r.collected : null,
        // Withheld rather than zeroed where tours were never kept: see the
        // header. The rate goes with it — a percentage of an unknown is not a
        // smaller number, it is not a number.
        cameIn: vipOk && tourOk ? r.cameIn : null,
        cameInPct: vipOk && tourOk ? pct(r.cameIn, r.collected) : null,
        signedUp: vipOk ? r.signedUp : null,
        signedUpPct: vipOk ? pct(r.signedUp, r.collected) : null,
        // Of the ones who actually walked in, how many joined. The number a
        // manager can act on: a low come-in rate is a marketing problem, a low
        // close-on-arrival rate is a floor problem.
        closedOfVisitsPct: vipOk && tourOk ? pct(r.signedUp, r.cameIn) : null,
      }
    })
    // Rows with nothing in them are dropped entirely rather than listed as
    // zeros — a club that collected no VIPs this month has no funnel to read.
    .filter(r => r.collected === null || r.collected > 0)
    .sort((a, b) => (b.collected || 0) - (a.collected || 0) || a.label.localeCompare(b.label))

  const summable = out.filter(r => r.collected !== null)
  const tourable = out.filter(r => r.cameIn !== null)
  const sum = (list, key) => list.reduce((a, r) => a + (r[key] || 0), 0)

  const collected = sum(summable, 'collected')
  const cameIn = tourable.length > 0 ? sum(tourable, 'cameIn') : null
  const signedUp = sum(summable, 'signedUp')
  // The come-in denominator is only the clubs that KEEP tours, or a club with
  // no tour history would drag the headline rate down for everyone else.
  const tourableCollected = sum(tourable, 'collected')

  return {
    viewBy,
    rows: out,
    summary: {
      collected,
      cameIn,
      cameInPct: cameIn === null ? null : pct(cameIn, tourableCollected),
      signedUp,
      signedUpPct: pct(signedUp, collected),
      closedOfVisitsPct: cameIn === null ? null : pct(sum(tourable, 'signedUp'), cameIn),
    },
    hasActivity: collected > 0,
  }
}

module.exports = { buildVipAnalysis, VIEW_BY }
