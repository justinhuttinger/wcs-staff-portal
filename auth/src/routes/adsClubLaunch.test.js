const test = require('node:test')
const assert = require('node:assert')
const { clubTokenValues, previewForClub, previewLaunch } = require('./adsClubLaunch')

const salem = {
  location_id: 'loc-1',
  name: 'Salem',
  page_id: '111',
  link: 'https://westcoaststrength.com/salem',
  targeting: { geo_locations: { cities: [{ key: '2418779', radius: 10 }] } },
  tokens: { offer: 'first week free' },
}

const template = {
  adset: { name: '{{club}} — Spring' },
  variants: [{ name: '{{club}} v1', primary_text: 'Train at WCS {{club}}. {{offer}}.' }],
}

test('club name is always available as {{club}} without anyone typing it', () => {
  const values = clubTokenValues(salem)
  assert.equal(values.club, 'Salem')
  assert.equal(values.offer, 'first week free')
})

test('an explicit club token overrides the location name', () => {
  // Keizer's Page and marketing may say something other than the club record.
  const values = clubTokenValues({ ...salem, tokens: { club: 'Keizer (Salem North)' } })
  assert.equal(values.club, 'Keizer (Salem North)')
})

test('preview renders every string for the club and reports it ready', () => {
  const out = previewForClub(salem, template)
  assert.equal(out.ready, true)
  assert.deepEqual(out.missing_tokens, [])
  assert.deepEqual(out.blockers, [])
  assert.equal(out.rendered.adset.name, 'Salem — Spring')
  assert.equal(out.rendered.variants[0].primary_text, 'Train at WCS Salem. first week free.')
})

test('a token no club can fill blocks that club instead of rendering braces', () => {
  const out = previewForClub(salem, {
    adset: { name: '{{club}} — {{season}}' },
    variants: [],
  })
  assert.deepEqual(out.missing_tokens, ['season'])
  assert.equal(out.ready, false)
  // The preview still shows the raw token so it is obvious what is unfilled.
  assert.equal(out.rendered.adset.name, 'Salem — {{season}}')
})

test('missing club setup is reported as a named blocker, not a crash', () => {
  const bare = { location_id: 'loc-2', name: 'Medford', tokens: {} }
  const out = previewForClub(bare, template)
  assert.equal(out.ready, false)
  assert.ok(out.blockers.includes('No Facebook Page set for this club'))
  assert.ok(out.blockers.includes('No geo targeting set for this club'))
  assert.ok(out.blockers.includes('No destination link or lead form set for this club'))
})

test('a lead form satisfies the destination requirement on its own', () => {
  const formClub = { ...salem, link: null, lead_form_id: '999' }
  assert.deepEqual(previewForClub(formClub, template).blockers, [])
})

test('previewLaunch summarises every club and refuses to launch if any is blocked', () => {
  const clubs = [salem, { location_id: 'loc-2', name: 'Medford', tokens: {} }]
  const out = previewLaunch(clubs, template)

  assert.equal(out.clubs.length, 2)
  assert.equal(out.ready, false, 'one blocked club blocks the launch')
  assert.deepEqual(out.ready_clubs, ['loc-1'])
  assert.deepEqual(out.blocked_clubs, ['loc-2'])
})

test('previewLaunch is ready when every selected club is', () => {
  const out = previewLaunch([salem, { ...salem, location_id: 'loc-3', name: 'Eugene' }], template)
  assert.equal(out.ready, true)
  assert.equal(out.clubs[1].rendered.adset.name, 'Eugene — Spring')
})
