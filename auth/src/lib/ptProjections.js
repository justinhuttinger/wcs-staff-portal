// Pure projection + reconciliation math for the PT Projections report.
// No I/O. Dates are 'YYYY-MM-DD' strings; ISO ordering is lexicographic.

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100 }

function normalizeService(raw, clubSlug) {
  const name = `${(raw.memberFirstName || '').trim()} ${(raw.memberLastName || '').trim()}`.trim() || 'Unknown'
  const trainer = `${(raw.serviceEmployeeFirstName || '').trim()} ${(raw.serviceEmployeeLastName || '').trim()}`.trim() || 'Unassigned'
  return {
    memberId: String(raw.memberId || ''),
    name,
    trainer,
    location: clubSlug,
    // ABC returns recurringServiceDates.* as timestamps ("YYYY-MM-DD HH:MM:SS"),
    // so slice to the date so it compares/buckets as a plain YYYY-MM-DD.
    nextBillingDate: String(raw.recurringServiceDates?.nextBillingDate || '').slice(0, 10) || null,
    amount: round2(parseFloat(raw.invoiceTotal || '0') || 0),
  }
}

// Classify a draft for the MONTH reconciliation (summary / by-location /
// by-trainer money buckets):
//  upcoming: today <= date <= windowEnd   (still to draft this period)
//  pastdue:  windowStart <= date < today  (should have drafted, hasn't)
//  future:   date > windowEnd             (a later period)
//  other:    date < windowStart, or no date
function classify(date, windowStart, windowEnd, today) {
  if (!date) return 'other'
  if (date >= today && date <= windowEnd) return 'upcoming'
  if (date >= windowStart && date < today) return 'pastdue'
  if (date > windowEnd) return 'future'
  return 'other'
}

// Status shown on a member row. "upcoming" uses the rolling forward HORIZON
// (not the month) so next month's drafts within the horizon read as upcoming
// rather than disappearing into "future".
function memberStatus(date, windowStart, today, horizonEnd, isCollected) {
  if (isCollected) return 'collected'
  if (!date) return 'other'
  if (date < today) return date >= windowStart ? 'pastdue' : 'other'
  if (date <= horizonEnd) return 'upcoming'
  return 'future'
}

// windowStart/windowEnd/today drive the current-period (month) reconciliation.
// horizonEnd drives the rolling forward calendar (byDay) and member "upcoming"
// status, so the calendar shows every agreement's next draft even when it falls
// in the following month. Defaults to windowEnd when omitted (legacy behavior).
function computeProjections({ services, collected, windowStart, windowEnd, today, horizonEnd }) {
  services = services || []
  collected = collected || []
  horizonEnd = horizonEnd || windowEnd

  // member -> trainer/location, for attributing collected revenue.
  const memberMap = {}
  for (const s of services) memberMap[s.memberId] = { trainer: s.trainer, location: s.location }
  const collectedMembers = new Set(collected.map(c => String(c.memberNumber)))

  let collectedTotal = 0, outstanding = 0, pastDue = 0
  const byDayMap = {}
  const loc = {}   // slug -> {projected, collected, outstanding, pastDue}
  const trn = {}   // trainer -> {trainer, location, projected, collected, count}
  const ensureLoc = s => (loc[s] = loc[s] || { slug: s, projected: 0, collected: 0, outstanding: 0, pastDue: 0 })
  const ensureTrn = (t, l) => (trn[t] = trn[t] || { trainer: t, location: l, projected: 0, collected: 0, count: 0 })

  // Collected revenue (already filtered to window + TRAINING by caller).
  for (const c of collected) {
    const amt = round2(c.amount)
    collectedTotal += amt
    ensureLoc(c.location).collected += amt
    const m = memberMap[String(c.memberNumber)]
    const tName = m ? m.trainer : 'Other'
    const tLoc = m ? m.location : c.location
    ensureTrn(tName, tLoc).collected += amt
  }

  // Recurring agreements -> month reconciliation buckets + forward calendar.
  const members = []
  for (const s of services) {
    const d = s.nextBillingDate
    const cls = classify(d, windowStart, windowEnd, today)   // month buckets
    const lrec = ensureLoc(s.location)
    const trec = ensureTrn(s.trainer, s.location)
    if (cls === 'upcoming') {
      outstanding += s.amount; lrec.outstanding += s.amount
    } else if (cls === 'pastdue') {
      pastDue += s.amount; lrec.pastDue += s.amount
    }
    // Forward calendar + trainer upcoming count: rolling [today, horizonEnd],
    // independent of the month so next month's drafts are visible.
    if (d && d >= today && d <= horizonEnd) {
      trec.count += 1
      byDayMap[d] = byDayMap[d] || { date: d, amount: 0, count: 0 }
      byDayMap[d].amount = round2(byDayMap[d].amount + s.amount)
      byDayMap[d].count += 1
    }
    const status = memberStatus(d, windowStart, today, horizonEnd, collectedMembers.has(s.memberId))
    members.push({
      memberId: s.memberId, name: s.name, trainer: s.trainer, location: s.location,
      nextBillingDate: d, amount: s.amount, status,
    })
  }

  collectedTotal = round2(collectedTotal); outstanding = round2(outstanding); pastDue = round2(pastDue)
  for (const l of Object.values(loc)) {
    l.collected = round2(l.collected); l.outstanding = round2(l.outstanding); l.pastDue = round2(l.pastDue)
    l.projected = round2(l.collected + l.outstanding + l.pastDue)
  }
  for (const t of Object.values(trn)) {
    t.collected = round2(t.collected)
    t.projected = round2(t.collected + 0) // projected for trainer = collected + their outstanding (added below)
  }
  // add trainer outstanding/pastdue into projected
  for (const s of services) {
    const cls = classify(s.nextBillingDate, windowStart, windowEnd, today)
    if (cls === 'upcoming' || cls === 'pastdue') {
      trn[s.trainer].projected = round2(trn[s.trainer].projected + s.amount)
    }
  }

  return {
    summary: {
      projected: round2(collectedTotal + outstanding + pastDue),
      collected: collectedTotal, outstanding, pastDue,
      window: { start: windowStart, end: windowEnd }, asOf: today, horizonEnd,
    },
    byDay: Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date)),
    byLocation: Object.values(loc).sort((a, b) => b.projected - a.projected),
    byTrainer: Object.values(trn).sort((a, b) => b.projected - a.projected),
    members,
  }
}

module.exports = { normalizeService, computeProjections }
