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
    nextBillingDate: raw.recurringServiceDates?.nextBillingDate || null,
    amount: round2(parseFloat(raw.invoiceTotal || '0') || 0),
  }
}

// Classify one service's next draft relative to the window/today.
//  upcoming: today <= date <= end
//  pastdue:  start <= date <  today
//  future:   date > end
//  other:    date < start, or no date  (ignored from projection buckets)
function classify(date, windowStart, windowEnd, today) {
  if (!date) return 'other'
  if (date >= today && date <= windowEnd) return 'upcoming'
  if (date >= windowStart && date < today) return 'pastdue'
  if (date > windowEnd) return 'future'
  return 'other'
}

function computeProjections({ services, collected, windowStart, windowEnd, today }) {
  services = services || []
  collected = collected || []

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

  // Recurring agreements -> outstanding / past-due buckets.
  const members = []
  for (const s of services) {
    const cls = classify(s.nextBillingDate, windowStart, windowEnd, today)
    const lrec = ensureLoc(s.location)
    const trec = ensureTrn(s.trainer, s.location)
    if (cls === 'upcoming') {
      outstanding += s.amount; lrec.outstanding += s.amount; trec.count += 1
      byDayMap[s.nextBillingDate] = byDayMap[s.nextBillingDate] || { date: s.nextBillingDate, amount: 0, count: 0 }
      byDayMap[s.nextBillingDate].amount = round2(byDayMap[s.nextBillingDate].amount + s.amount)
      byDayMap[s.nextBillingDate].count += 1
    } else if (cls === 'pastdue') {
      pastDue += s.amount; lrec.pastDue += s.amount
    }
    // member row status: collected payment this window wins, else its classification
    const status = collectedMembers.has(s.memberId) ? 'collected' : cls
    members.push({
      memberId: s.memberId, name: s.name, trainer: s.trainer, location: s.location,
      nextBillingDate: s.nextBillingDate, amount: s.amount, status,
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
      window: { start: windowStart, end: windowEnd }, asOf: today,
    },
    byDay: Object.values(byDayMap).sort((a, b) => a.date.localeCompare(b.date)),
    byLocation: Object.values(loc).sort((a, b) => b.projected - a.projected),
    byTrainer: Object.values(trn).sort((a, b) => b.projected - a.projected),
    members,
  }
}

module.exports = { normalizeService, computeProjections }
