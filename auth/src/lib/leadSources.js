// Pure shaping for Analytics > Lead Sources. No I/O; the route fetches.
//
// Where leads come from, and what became of them, on FIRST touch.
//
// THE FUNNEL RECONCILES WITH GHL'S OWN BOARD. It counts OPPORTUNITIES in the
// membership pipelines, by the opportunity's date, and a stage is "reached at
// least" rather than "currently sitting in" — stage_id is a current position,
// not a history, so an opportunity that progressed to Trial Started had already
// passed Tour Booked and must still count as one. Salem 1-27 August returns 148
// leads and 56 signed against GHL's 148 and 56.
//
// TWO ATTRIBUTIONS, NEVER BLENDED.
//
//   Real     what GHL observed on the contact's first touch. Evidence.
//   Claimed  what the person said when asked. A different question on a
//            different population — see claimedCoverageNote().
//
// A lead can be observed as Facebook and claim Friend/Family. Both are true,
// and the gap between them is the point of having both.

const { pctChange } = require('./snapshotWindow')

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

// Stated on the report, and MEASURED rather than asserted.
//
// This note used to quote a constant "about 42%", which made a working field
// look broken. Marketing Source became mandatory in MAY 2026:
//
//   Jan 2026  1.5%      May 2026  69.2%
//   Apr 2026  7.5%      Aug 2026  80.5%   (share of trials carrying it)
//
// A window inside that era is well covered; a window spanning it is not, and
// only the window on screen knows which it is. Coverage is computed over the
// same population the funnel draws, so the sentence describes these numbers
// rather than an average of a different period.
//
// It reads contact.marketing_source. NOT "How Did you Hear About Us?", the
// field named after the question, which is filled in on 42 contacts of 88,419.
// I built this on that one first and wrote a note explaining the emptiness; a
// 0.05% reading should have prompted a hunt for the field carrying the answer
// instead of prose justifying the hole.
function claimedCoverageNote(coverage) {
  const total = num(coverage && coverage.total)
  const answered = num(coverage && coverage.answered)
  const pct = rate(answered, total)
  if (!total) {
    return 'Claimed source is what the person said when asked. Observed source ' +
      'is on every lead, so the two views cover different people.'
  }
  return `Claimed source is recorded on ${pct}% of this window ` +
    `(${answered.toLocaleString()} of ${total.toLocaleString()}); the rest show as ` +
    'Not Asked. The question became mandatory in May 2026, so windows reaching ' +
    'back before then read low for that reason rather than because staff skipped ' +
    'it. Observed source is on every lead, so the two views cover different ' +
    'numbers of people and their totals will not match.'
}

// Also stated. What is left in this bucket after the walk-in rule is applied.
//
// A contact with no attribution who went straight into a trial is a WALK-IN and
// is counted as one. What remains here has no attribution, no source AND no
// trial: a record that arrived from nowhere and did nothing. It is shown so a
// reader can see it exists, and kept out of the totals because a conversion rate
// computed over rows that were never leads is not a conversion rate.
const NO_SOURCE_NOTE =
  'No Source Recorded has no observed attribution, no contact source and no ' +
  'trial — records that arrived from nowhere and went nowhere. Contacts with no ' +
  'attribution who did start a trial are counted as Walk-in, not here.'

// Stated wherever the outcome is shown.
//
// Not Interested and Day Pass are ONE measure, combined with OR over distinct
// contacts rather than by adding the two counts. The overlap is not marginal:
// for Website in August the two counts are 347 and 335 while the truth is 391,
// because 291 people are both. Summing would have reported nearly double.
//
// Both outcomes DELETE the opportunity in GHL, so somebody who was a lead and
// then went not-interested has already left the funnel's lead count. This is
// ADDITIONAL to the funnel, not a slice of it, and the arithmetic will not add
// up if it is read as one.
const OUTCOMES_NOTE =
  'Not Interested / Day Pass counts people per contact, not from the pipeline: ' +
  'both outcomes delete the opportunity in GHL, so these people have already ' +
  'left the lead count beside them. Read it as additional to the funnel, not as ' +
  'a slice of it. Anyone who is both is counted once. Medford and Milwaukie do ' +
  'not use the guest tag at all, and Medford has no Not Interested workflow, so ' +
  'a zero there is an absent process rather than an absent person.'

/** A source that is a bookkeeping artefact rather than a channel. */
const NOT_A_CHANNEL = new Set(['No Source Recorded'])

function shapeRow(r) {
  const leads = num(r.leads)
  const tours = num(r.tours)
  const trials = num(r.trials)
  const won = num(r.won)
  return {
    source: r.source,
    leads,
    tours,
    trials,
    won,
    lost: num(r.lost),
    tourRate: rate(tours, leads),
    // Of the leads this source produced, how many reached each step.
    trialRate: rate(trials, leads),
    winRate: rate(won, leads),
    // And of those who started a trial, how many bought. This is the one that
    // separates "we cannot get them in the door" from "we cannot close them".
    trialToWinRate: rate(won, trials),
    notAChannel: NOT_A_CHANNEL.has(r.source),
  }
}

/**
 * @param rows       from analytics_lead_sources
 * @param priorRows  the same window a period earlier, or null
 * @param opts       { attribution: 'real' | 'claimed' }
 */
function buildLeadSources(rows, priorRows, opts = {}) {
  const attribution = opts.attribution === 'claimed' ? 'claimed' : 'real'
  const sources = (rows || []).map(shapeRow)

  // Not Interested and Day Pass arrive separately because BOTH OUTCOMES DELETE
  // THE OPPORTUNITY in GHL. Of 3,797 contacts who finished the Not Interested
  // workflow only 474 still have one; of 377 day passes, one did. Counting
  // either from the funnel missed almost all of them.
  //
  // They are folded onto the source rows for reading, never into the funnel's
  // arithmetic — see OUTCOMES_NOTE for why they are not a slice of it.
  const outcomeBySource = new Map(
    (opts.outcomes || []).map(o => [o.source, {
      // Combined in SQL with OR over distinct contacts. Never recomputed here
      // as notInterested + dayPasses — that double-counts anyone who is both.
      outcomes: num(o.outcomes),
      notInterested: num(o.not_interested),
      dayPasses: num(o.day_passes),
    }])
  )

  const priorBySource = new Map(
    (priorRows || []).map(r => [r.source, shapeRow(r)])
  )

  const withChange = sources.map(s => {
    const was = priorBySource.get(s.source)
    return {
      ...s,
      outcomes: (outcomeBySource.get(s.source) || {}).outcomes ?? 0,
      notInterested: (outcomeBySource.get(s.source) || {}).notInterested ?? 0,
      dayPasses: (outcomeBySource.get(s.source) || {}).dayPasses ?? 0,
      priorLeads: was ? was.leads : null,
      leadsChange: pctChange(s.leads, was ? was.leads : null),
      priorWon: was ? was.won : null,
      wonChange: pctChange(s.won, was ? was.won : null),
    }
  })

  // Totals EXCLUDE the artefact bucket. Including it would inflate the
  // business-wide conversion rate with records that never were leads.
  const real = withChange.filter(s => !s.notAChannel)
  const sum = (k) => real.reduce((a, s) => a + s[k], 0)
  const totalLeads = sum('leads')
  const totalWon = sum('won')
  const totalTrials = sum('trials')

  return {
    attribution,
    outcomesNote: OUTCOMES_NOTE,
    sources: withChange.sort((a, b) => b.leads - a.leads
      || String(a.source).localeCompare(String(b.source))),
    totals: {
      leads: totalLeads,
      tours: sum('tours'),
      // Summing the per-source combined figures is safe: a contact has one
      // source, so the OR already happened inside each bucket.
      outcomes: [...outcomeBySource.values()].reduce((a, v) => a + v.outcomes, 0),
      notInterested: [...outcomeBySource.values()].reduce((a, v) => a + v.notInterested, 0),
      dayPasses: [...outcomeBySource.values()].reduce((a, v) => a + v.dayPasses, 0),
      trials: totalTrials,
      won: totalWon,
      lost: sum('lost'),
      trialRate: rate(totalTrials, totalLeads),
      winRate: rate(totalWon, totalLeads),
      trialToWinRate: rate(totalWon, totalTrials),
    },
    // Each source's share of leads, so a big-but-poor channel is visible as
    // both at once.
    mix: real.map(s => ({
      source: s.source,
      leads: s.leads,
      share: rate(s.leads, totalLeads),
      winRate: s.winRate,
    })),
    notes: {
      claimed: attribution === 'claimed' ? claimedCoverageNote(opts.coverage) : null,
      noSource: withChange.some(s => s.notAChannel) ? NO_SOURCE_NOTE : null,
    },
  }
}

module.exports = {
  buildLeadSources, shapeRow, claimedCoverageNote,
  NO_SOURCE_NOTE, OUTCOMES_NOTE, NOT_A_CHANNEL,
}
