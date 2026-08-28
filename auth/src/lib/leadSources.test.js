const test = require('node:test')
const assert = require('node:assert')
const { buildLeadSources } = require('./leadSources')

// The funnel row: opportunities only. Not Interested and Day Pass are NOT here
// — both outcomes delete the opportunity, so they arrive per contact.
const row = (source, over = {}) => ({
  source, leads: 100, tours: 60, trials: 40, won: 20, lost: 2, ...over,
})

test('rates are per lead, and trial-to-join is per trial', () => {
  const out = buildLeadSources([row('Website')], null, {})
  const s = out.sources[0]
  assert.equal(s.trialRate, 40)
  assert.equal(s.winRate, 20)
  // The one that separates "cannot get them in the door" from "cannot close".
  assert.equal(s.trialToWinRate, 50)
})

test('the artefact bucket is flagged and excluded from totals', () => {
  const out = buildLeadSources([
    row('Website', { leads: 100, trials: 40, won: 20 }),
    row('No Source Recorded', { leads: 1000, trials: 500, won: 500 }),
  ], null, {})

  const artefact = out.sources.find(s => s.source === 'No Source Recorded')
  assert.equal(artefact.notAChannel, true)

  // Including it would report a business-wide join rate of 47% built from
  // records that were never leads. Totals must be of real channels only.
  assert.equal(out.totals.leads, 100)
  assert.equal(out.totals.won, 20)
  assert.equal(out.totals.winRate, 20)
  assert.ok(out.notes.noSource)
})

test('the artefact bucket is still shown, not dropped', () => {
  const out = buildLeadSources([row('No Source Recorded', { leads: 50 })], null, {})
  // Hiding it would leave a reader wondering where a fifth of the contacts went.
  assert.equal(out.sources.length, 1)
})

test('mix shares are of real channels only and sum to about 100', () => {
  const out = buildLeadSources([
    row('Website', { leads: 60 }),
    row('Facebook', { leads: 40 }),
    row('No Source Recorded', { leads: 900 }),
  ], null, {})
  assert.deepEqual(out.mix.map(m => m.share), [60, 40])
})

test('claimed attribution carries its coverage warning, observed does not', () => {
  assert.ok(buildLeadSources([row('Google')], null, { attribution: 'claimed' }).notes.claimed)
  assert.equal(buildLeadSources([row('Website')], null, { attribution: 'real' }).notes.claimed, null)
})

test('an unknown attribution value falls back to observed', () => {
  const out = buildLeadSources([row('Website')], null, { attribution: 'nonsense' })
  assert.equal(out.attribution, 'real')
})

test('a prior window produces a change, and no prior produces null', () => {
  const out = buildLeadSources(
    [row('Facebook', { leads: 200, won: 10 })],
    [row('Facebook', { leads: 100, won: 20 })],
    {}
  )
  const s = out.sources[0]
  assert.equal(s.leadsChange, 100)
  assert.equal(s.wonChange, -50)

  // Number(null) is 0 and finite, so a careless pctChange reports -100% here.
  const noPrior = buildLeadSources([row('Facebook')], null, {}).sources[0]
  assert.equal(noPrior.leadsChange, null)
  assert.equal(noPrior.priorLeads, null)
})

test('a source absent from the prior window is not treated as a collapse', () => {
  const out = buildLeadSources([row('Brand New Channel')], [row('Website')], {})
  assert.equal(out.sources[0].leadsChange, null)
})

test('sources sort by lead volume', () => {
  const out = buildLeadSources([
    row('Small', { leads: 5 }), row('Big', { leads: 500 }), row('Middle', { leads: 50 }),
  ], null, {})
  assert.deepEqual(out.sources.map(s => s.source), ['Big', 'Middle', 'Small'])
})

test('a source with no leads has no rates rather than zeroes', () => {
  const out = buildLeadSources([row('Dormant', { leads: 0, trials: 0, won: 0 })], null, {})
  // 0% would read as "we tried and failed"; null reads as "nothing to judge".
  assert.equal(out.sources[0].winRate, null)
  assert.equal(out.sources[0].trialToWinRate, null)
})

test('an empty window builds rather than throwing', () => {
  assert.doesNotThrow(() => buildLeadSources(null, null, {}))
  const out = buildLeadSources([], null, {})
  assert.deepEqual(out.sources, [])
  assert.equal(out.totals.leads, 0)
  assert.equal(out.totals.winRate, null)
})

test('what remains in No Source Recorded is inert, and stays out of totals', () => {
  // After the walk-in rule, this bucket holds records with no attribution, no
  // source and no trial. They did nothing, and including them would dilute the
  // business-wide rate with rows that were never leads.
  const out = buildLeadSources([
    row('Walk-in / Manual', { leads: 763, trials: 260, won: 163 }),
    row('No Source Recorded', { leads: 81, trials: 0, won: 0 }),
  ], null, {})
  assert.equal(out.totals.leads, 763)
  assert.equal(out.totals.won, 163)
  assert.equal(out.sources.find(s => s.source === 'No Source Recorded').notAChannel, true)
  assert.match(out.notes.noSource, /counted as Walk-in/)
})

test('outcomes are folded on for display but never into the funnel maths', () => {
  const out = buildLeadSources(
    [row('Website', { leads: 100, won: 20 })],
    null,
    { outcomes: [{ source: 'Website', not_interested: 44, day_passes: 43 }] }
  )
  const s = out.sources[0]
  assert.equal(s.dayPasses, 43)
  assert.equal(s.notInterested, 44)
  // 43 guests who never became opportunities must not move a conversion rate
  // computed over 100 opportunities.
  assert.equal(s.winRate, 20)
  assert.equal(out.totals.leads, 100)
  assert.equal(out.totals.dayPasses, 43)
  assert.equal(out.totals.notInterested, 44)
  // They are additional to the funnel, not a slice of it: the opportunity is
  // gone, so these people already left the 100.
  assert.ok(out.outcomesNote.includes('additional to the funnel'))
})

test('a source with outcomes but no leads still totals them', () => {
  const out = buildLeadSources([row('Website', { leads: 10 })], null,
    { outcomes: [{ source: 'Walk-in / Manual', not_interested: 0, day_passes: 12 }] })
  // The day pass total counts every source's, even one absent from the funnel.
  assert.equal(out.totals.dayPasses, 12)
  assert.equal(out.sources.find(s => s.source === 'Website').dayPasses, 0)
})

test('tour rate is reported per lead', () => {
  const out = buildLeadSources([row('Website', { leads: 148, tours: 92 })], null, {})
  assert.equal(out.sources[0].tourRate, 62.2)
})
