// VIP Analysis — how far VIP referrals actually get.
//
// Three numbers per row, and the whole point is the drop between them:
//
//   Collected  a VIP credit was recorded in the window  (vip_credits)
//   Came In    that person reached the Trial Started stage in GHL
//   Signed Up  that person later joined                 (abc_members)
//
// CAME IN IS A PIPELINE STAGE, NOT A TOUR. This first shipped measuring it from
// completed tour_intakes rows, and the answer was wrong: across September, ONE
// of 176 VIP referrals had a completed tour against their name. VIPs are not
// walked through the tour check-in — they are worked in GHL, so the record that
// they came in is their opportunity moving down a pipeline.
//
// Matched on the STAGE NAME alone, deliberately, not on stage plus pipeline.
// 'Trial Started' exists in two pipelines — Membership Pipeline at five clubs
// and Standard Member Pipeline at one — and it exists in no others, so the name
// is already unambiguous. Pinning the pipeline name would silently report zero
// at the club using the other one.
//
// Pass Redeemed rides alongside as its own column, for the same reason it is
// not the headline: it is the VIP Pipeline's own "they used the pass" stage,
// and the two disagree by club. Over the last 90 days Medford recorded 20 trial
// starts and zero redemptions while Eugene recorded zero trial starts and one
// redemption. Neither stage alone describes every club, so the report shows
// both rather than picking one and calling the other clubs' VIPs a failure.
//
// ORDERING. A stage reached before the referral is not that referral arriving,
// so last_stage_change_at must fall on or after the credit. Two limits worth
// knowing: an opportunity carries only its CURRENT stage, so one that moved
// past Trial Started is no longer visible as having reached it; and
// last_stage_change_at is when it last moved, which for a row sitting in Trial
// Started is when it arrived there.
//
// NOT CONFIGURED IS NOT ZERO, and this report has three of them:
//
//   - Milwaukie has never recorded a VIP credit, because its GHL location has
//     no VIP fields set up.
//   - A club whose GHL location has no pipeline containing Trial Started cannot
//     produce that number at all.
//   - Likewise Pass Redeemed, which only exists inside the VIP Pipeline.
//
// Each is judged on what the club's GHL account actually has, not on whether
// the window happened to be quiet.

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
 * @param opts.reached        Map of contact id -> { trial, pass } as YYYY-MM-DD
 *                            dates the stage was reached, or null
 * @param opts.members        abc_members from the window onward, for the join
 * @param opts.vipClubs       Set of club numbers that have EVER credited a VIP
 * @param opts.trialClubs     Set of club numbers whose GHL has a Trial Started stage
 * @param opts.passClubs      Set of club numbers whose GHL has a Pass Redeemed stage
 * @param opts.viewBy         'club' | 'collector'
 */
function buildVipAnalysis(credits, opts = {}) {
  const viewBy = VIEW_BY.includes(opts.viewBy) ? opts.viewBy : 'club'
  const contactsById = opts.contactsById || new Map()
  const vipClubs = opts.vipClubs || new Set()
  const trialClubs = opts.trialClubs || new Set()
  const passClubs = opts.passClubs || new Set()

  const reached = opts.reached || new Map()

  const index = buildMemberIndex(opts.members || [])

  const rows = new Map()
  const rowFor = (key, label, clubNumber) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key, label,
        clubNumbers: new Set(),
        collected: 0, cameIn: 0, passRedeemed: 0, signedUp: 0,
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

    // Counted once per referral: this is a count of people, not of stage moves.
    const hit = reached.get(c.ghl_contact_id) || null
    if (creditedOn && hit?.trial && hit.trial >= creditedOn) row.cameIn += 1
    if (creditedOn && hit?.pass && hit.pass >= creditedOn) row.passRedeemed += 1

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
      const trialOk = anyIn(r, trialClubs)
      const passOk = anyIn(r, passClubs)
      return {
        key: r.key,
        label: r.label,
        collected: vipOk ? r.collected : null,
        // Withheld rather than zeroed where the club's GHL has no such stage:
        // the rate goes with it, because a percentage of an unknown is not a
        // smaller number, it is not a number.
        cameIn: vipOk && trialOk ? r.cameIn : null,
        cameInPct: vipOk && trialOk ? pct(r.cameIn, r.collected) : null,
        passRedeemed: vipOk && passOk ? r.passRedeemed : null,
        passRedeemedPct: vipOk && passOk ? pct(r.passRedeemed, r.collected) : null,
        signedUp: vipOk ? r.signedUp : null,
        signedUpPct: vipOk ? pct(r.signedUp, r.collected) : null,
        // Of the ones who actually got going, how many joined. The number a
        // manager can act on: a low came-in rate is a referral-quality problem,
        // a low close-on-arrival rate is a floor problem.
        closedOfVisitsPct: vipOk && trialOk ? pct(r.signedUp, r.cameIn) : null,
      }
    })
    // Rows with nothing in them are dropped entirely rather than listed as
    // zeros — a club that collected no VIPs this month has no funnel to read.
    .filter(r => r.collected === null || r.collected > 0)
    .sort((a, b) => (b.collected || 0) - (a.collected || 0) || a.label.localeCompare(b.label))

  const summable = out.filter(r => r.collected !== null)
  const trialable = out.filter(r => r.cameIn !== null)
  const passable = out.filter(r => r.passRedeemed !== null)
  const sum = (list, key) => list.reduce((a, r) => a + (r[key] || 0), 0)

  const collected = sum(summable, 'collected')
  const cameIn = trialable.length > 0 ? sum(trialable, 'cameIn') : null
  const passRedeemed = passable.length > 0 ? sum(passable, 'passRedeemed') : null
  const signedUp = sum(summable, 'signedUp')
  // Each rate divides only by the clubs that can produce its numerator, or one
  // club whose GHL lacks the stage would drag the headline down for everyone.
  const trialableCollected = sum(trialable, 'collected')
  const passableCollected = sum(passable, 'collected')

  return {
    viewBy,
    rows: out,
    summary: {
      collected,
      cameIn,
      cameInPct: cameIn === null ? null : pct(cameIn, trialableCollected),
      passRedeemed,
      passRedeemedPct: passRedeemed === null ? null : pct(passRedeemed, passableCollected),
      signedUp,
      signedUpPct: pct(signedUp, collected),
      closedOfVisitsPct: cameIn === null ? null : pct(sum(trialable, 'signedUp'), cameIn),
    },
    hasActivity: collected > 0,
  }
}

module.exports = { buildVipAnalysis, VIEW_BY }
