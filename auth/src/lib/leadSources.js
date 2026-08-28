// Pure shaping for Analytics > Lead Sources. No I/O; the route fetches.
//
// Where leads come from, and what became of them, on FIRST touch.
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

// Stated on the report. The "How Did you Hear About Us?" dropdown is filled in
// on 42 of 88,419 contacts — 0.05%. Not a sync gap: 62,000 of those contacts
// carry other custom fields. The column is built and will fill itself in the
// day the question starts being asked, but until then a claimed-source chart is
// a chart of almost nothing, and saying so is the difference between a useful
// report and a misleading one.
const CLAIMED_COVERAGE_NOTE =
  'Claimed source is recorded on well under 1% of contacts, so these counts are ' +
  'a sample rather than a picture. The observed source is on every lead.'

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

/** A source that is a bookkeeping artefact rather than a channel. */
const NOT_A_CHANNEL = new Set(['No Source Recorded'])

function shapeRow(r) {
  const leads = num(r.leads)
  const trials = num(r.trials)
  const won = num(r.won)
  return {
    source: r.source,
    leads,
    tours: num(r.tours),
    trials,
    won,
    notInterested: num(r.not_interested),
    lost: num(r.lost),
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

  const priorBySource = new Map(
    (priorRows || []).map(r => [r.source, shapeRow(r)])
  )

  const withChange = sources.map(s => {
    const was = priorBySource.get(s.source)
    return {
      ...s,
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
    sources: withChange.sort((a, b) => b.leads - a.leads
      || String(a.source).localeCompare(String(b.source))),
    totals: {
      leads: totalLeads,
      tours: sum('tours'),
      trials: totalTrials,
      won: totalWon,
      notInterested: sum('notInterested'),
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
  buildLeadSources, shapeRow, CLAIMED_COVERAGE_NOTE, NO_SOURCE_NOTE, NOT_A_CHANNEL,
}
