const test = require('node:test')
const assert = require('node:assert')
const { runLaunch, STOP_PRESSURE } = require('./adsClubRun')

const club = (id, name, extra = {}) => ({
  location_id: id,
  name,
  page_id: 'page-' + id,
  instagram_id: 'ig-' + id,
  link: `https://westcoaststrength.com/${name.toLowerCase()}`,
  campaign_id: 'camp-' + id,
  targeting: { geo_locations: { cities: [{ key: 'city-' + id, radius: 10 }] } },
  tokens: {},
  ...extra,
})

const template = {
  adset: { name: '{{club}} — Spring', daily_budget: 25, optimization_goal: 'LEAD_GENERATION' },
  variants: [
    { name: '{{club}} v1', primary_text: 'Train at {{club}}' },
    { name: '{{club}} v2', primary_text: 'Join {{club}} today' },
  ],
}

// Records everything the launch would send to Meta.
function fakeDeps({ failAdsetFor = null, failAdFor = null, pressure = () => 0 } = {}) {
  const adsets = []
  const ads = []
  return {
    calls: { adsets, ads },
    pressure,
    createAdset: async (body) => {
      if (failAdsetFor && body.name.startsWith(failAdsetFor)) throw new Error('Meta rejected the ad set')
      adsets.push(body)
      return { id: 'adset-' + adsets.length }
    },
    createAd: async (variant, shared) => {
      if (failAdFor && variant.name.startsWith(failAdFor)) throw new Error('Meta rejected the creative')
      ads.push({ variant, shared })
      return { ad_id: 'ad-' + ads.length, creative_id: 'cr-' + ads.length }
    },
  }
}

test('creates one ad set and every variant per club, with that club rendered in', async () => {
  const deps = fakeDeps()
  const out = await runLaunch([club('1', 'Salem'), club('2', 'Eugene')], template, {}, deps)

  assert.equal(out.created_clubs.length, 2)
  assert.equal(deps.calls.adsets.length, 2)
  assert.equal(deps.calls.ads.length, 4)
  assert.deepEqual(deps.calls.adsets.map(a => a.name), ['Salem — Spring', 'Eugene — Spring'])
  assert.deepEqual(deps.calls.ads.map(a => a.variant.name), ['Salem v1', 'Salem v2', 'Eugene v1', 'Eugene v2'])
  assert.equal(deps.calls.ads[2].variant.primary_text, 'Train at Eugene')
})

test('each ad carries its own club Page, Instagram and destination', async () => {
  const deps = fakeDeps()
  await runLaunch([club('1', 'Salem'), club('2', 'Eugene')], template, {}, deps)

  const eugene = deps.calls.ads[2].shared
  assert.equal(eugene.page_id, 'page-2')
  assert.equal(eugene.instagram_user_id, 'ig-2')
  assert.equal(eugene.link, 'https://westcoaststrength.com/eugene')
  assert.equal(eugene.adset_id, 'adset-2', 'ads land in their own club ad set')
})

test('the ad set targets that club and sits in that club campaign', async () => {
  const deps = fakeDeps()
  await runLaunch([club('1', 'Salem')], template, {}, deps)

  const body = deps.calls.adsets[0]
  assert.deepEqual(body.targeting.geo_locations.cities[0].key, 'city-1')
  assert.equal(body.campaign_id, 'camp-1')
})

test('everything is created paused, even when the template says ACTIVE', async () => {
  // Seven clubs going live at once by accident is the expensive mistake here.
  const deps = fakeDeps()
  await runLaunch([club('1', 'Salem')], { ...template, adset: { ...template.adset, status: 'ACTIVE' } }, { status: 'ACTIVE' }, deps)

  assert.equal(deps.calls.adsets[0].status, 'PAUSED')
  assert.equal(deps.calls.ads[0].shared.status, 'PAUSED')
})

test('a per-launch campaign override beats the club default', async () => {
  const deps = fakeDeps()
  await runLaunch([club('1', 'Salem')], template, { campaign_overrides: { 1: 'camp-override' } }, deps)
  assert.equal(deps.calls.adsets[0].campaign_id, 'camp-override')
})

test('a club with no campaign fails on its own without touching Meta', async () => {
  const deps = fakeDeps()
  const out = await runLaunch([club('1', 'Salem', { campaign_id: null })], template, {}, deps)

  assert.equal(deps.calls.adsets.length, 0)
  assert.equal(out.failed_clubs.length, 1)
  assert.match(out.results[0].error, /campaign/i)
})

test('one club failing does not stop the others', async () => {
  const deps = fakeDeps({ failAdsetFor: 'Eugene' })
  const out = await runLaunch(
    [club('1', 'Salem'), club('2', 'Eugene'), club('3', 'Medford')],
    template, {}, deps,
  )

  assert.deepEqual(out.created_clubs, ['1', '3'])
  assert.deepEqual(out.failed_clubs, ['2'])
  assert.equal(deps.calls.adsets.length, 2, 'the failed club wrote no ad set')
  assert.equal(deps.calls.ads.length, 4, 'and none of its ads were attempted')
})

test('a failed variant is reported but its siblings still get created', async () => {
  const deps = fakeDeps({ failAdFor: 'Salem v1' })
  const out = await runLaunch([club('1', 'Salem')], template, {}, deps)

  const salem = out.results[0]
  assert.equal(salem.ok, true, 'the club still counts as created')
  assert.equal(salem.ads.filter(a => a.ok).length, 1)
  assert.equal(salem.ads.find(a => !a.ok).error, 'Meta rejected the creative')
})

test('stops early when the rate-limit budget is nearly spent', async () => {
  let calls = 0
  const deps = fakeDeps({ pressure: () => (++calls >= 2 ? STOP_PRESSURE + 1 : 0) })
  const out = await runLaunch(
    [club('1', 'Salem'), club('2', 'Eugene'), club('3', 'Medford')],
    template, {}, deps,
  )

  assert.equal(out.stopped_early, true)
  assert.deepEqual(out.created_clubs, ['1', '2'])
  assert.deepEqual(out.skipped_clubs, ['3'], 'the rest are skipped, not failed')
  assert.equal(deps.calls.adsets.length, 2)
})

test('a retry can re-run only the clubs that did not get created', async () => {
  const deps = fakeDeps({ failAdsetFor: 'Eugene' })
  const first = await runLaunch([club('1', 'Salem'), club('2', 'Eugene')], template, {}, deps)

  // The UI re-runs with exactly what failed; Salem must not be built twice.
  const retry = fakeDeps()
  const out = await runLaunch(
    [club('1', 'Salem'), club('2', 'Eugene')].filter(c => first.failed_clubs.includes(c.location_id)),
    template, {}, retry,
  )

  assert.deepEqual(retry.calls.adsets.map(a => a.name), ['Eugene — Spring'])
  assert.deepEqual(out.created_clubs, ['2'])
})
