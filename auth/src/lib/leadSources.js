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
//   Claimed  what the person said when asked. A different question, and a much
//            emptier field — see CLAIMED_COVERAGE_NOTE.
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

// Stated on the report.
//
// Claimed source reads contact.marketing_source, which covers 5,054 of the
// 11,909 contacts created in the last 120 days — 42%.
//
// It is NOT "How Did you Hear About Us?", which is the field named after the
// question and is filled in on 42 contacts of 88,419. I built the report on
// that one first and wrote a note explaining why it was empty; the 0.05% should
// have prompted a search for the field carrying the answer instead. Contacts
// with no answer are reported as "Not Asked" rather than folded into a real
// source.
const CLAIMED_COVERAGE_NOTE =
  'Claimed source is recorded on about 42% of contacts; the rest show as Not ' +
  'Asked. Observed source is on every lead, so the two views cover different ' +
  'numbers of people and their totals will not match.'

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

// Stated wherever these two are shown.
//
// Both outcomes DELETE the opportunity in GHL, so somebody who was a lead and
// then went not-interested has already left the funnel's lead count. They are
// ADDITIONAL to the funnel, not a slice of it, and the arithmetic will not add
// up if they are read as one.
const OUTCOMES_NOTE =
  'Not Interested and Day Pass are counted per contact, not from the pipeline: ' +
  'both outcomes delete the opportunity in GHL, so these people have already ' +
  'left the lead count beside them. Read them as additional to the funnel, not ' +
  'as a slice of it. Medford and Milwaukie do not use the guest tag at all, and ' +
  'Medford has no Not Interested workflow, so a zero there is an absent process ' +
  'rather than an absent person.'

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
      claimed: attribution === 'claimed' ? CLAIMED_COVERAGE_NOTE : null,
      noSource: withChange.some(s => s.notAChannel) ? NO_SOURCE_NOTE : null,
    },
  }
}

module.exports = {
  buildLeadSources, shapeRow,
  CLAIMED_COVERAGE_NOTE, NO_SOURCE_NOTE, OUTCOMES_NOTE, NOT_A_CHANNEL,
}
