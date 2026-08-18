import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectLocation, classifyCampaign, isActive, matchesLocationFilter, matchesStatusFilter,
  passthroughTargeting, readGender, readGeoList, NO_LOCATION,
} from './filters.js'

test('detectLocation reads the club out of a campaign name', () => {
  assert.equal(detectLocation('Keizer Retargeting Campaign'), 'keizer')
  assert.equal(detectLocation('Salem 1 Year Free Campaign 2026'), 'salem')
  assert.equal(detectLocation('Springfield Traffic Campaign'), 'springfield')
  // Meta's own data carries this misspelling on several campaigns and audiences.
  assert.equal(detectLocation('CBW East Side Milwuakie'), 'milwaukie')
  assert.equal(detectLocation('Event: ESAC TDAT'), 'esac')
  assert.equal(detectLocation('Reach men (35-45)'), null)
})

test('classifyCampaign trusts the name over the objective', () => {
  // The retargeting campaigns all run on OUTCOME_LEADS. Classifying by
  // objective would file them under Lead and make the filter useless.
  assert.equal(classifyCampaign({ name: 'Keizer Retargeting Campaign', objective: 'OUTCOME_LEADS' }), 'retargeting')
  assert.equal(classifyCampaign({ name: 'Remarketing | Free Trial', objective: 'OUTCOME_SALES' }), 'retargeting')
  assert.equal(classifyCampaign({ name: 'Salem Traffic Campaign', objective: 'OUTCOME_TRAFFIC' }), 'traffic')
  assert.equal(classifyCampaign({ name: 'Salem 1 Year Free Campaign 2026', objective: 'OUTCOME_LEADS' }), 'lead')
  assert.equal(classifyCampaign({ name: 'Event: Salem Studio X', objective: 'OUTCOME_ENGAGEMENT' }), 'event')
})

test('classifyCampaign falls back to the objective when the name says nothing', () => {
  assert.equal(classifyCampaign({ name: 'Likes', objective: 'OUTCOME_TRAFFIC' }), 'traffic')
  assert.equal(classifyCampaign({ name: 'Reach', objective: 'OUTCOME_AWARENESS' }), 'other')
})

test('a paused ad is not active, whatever its parent is doing', () => {
  assert.equal(isActive({ effective_status: 'ACTIVE' }), true)
  assert.equal(isActive({ effective_status: 'PAUSED' }), false)
  assert.equal(isActive({ effective_status: 'CAMPAIGN_PAUSED' }), false)
  assert.equal(isActive({ status: 'ACTIVE' }), true)
  // effective_status wins: an ad set to ACTIVE under a paused campaign is not
  // actually delivering.
  assert.equal(isActive({ status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED' }), false)
})

test('IN_PROCESS counts as active', () => {
  // A scheduled or still-publishing object will deliver on its own, so it
  // belongs with the live ones rather than the switched-off ones.
  assert.equal(isActive({ effective_status: 'IN_PROCESS' }), true)
  assert.equal(matchesStatusFilter({ effective_status: 'IN_PROCESS' }, 'active'), true)
  assert.equal(matchesStatusFilter({ effective_status: 'IN_PROCESS' }, 'inactive'), false)
  // WITH_ISSUES is not delivering, so it stays on the inactive side.
  assert.equal(isActive({ effective_status: 'WITH_ISSUES' }), false)
})

test('an ad left ACTIVE under a paused parent still reads as inactive', () => {
  // This is the stranded case the audit sweeps up: own status ACTIVE, but
  // Meta reports the parent's pause through effective_status.
  assert.equal(isActive({ status: 'ACTIVE', effective_status: 'ADSET_PAUSED' }), false)
  assert.equal(isActive({ status: 'ACTIVE', effective_status: 'CAMPAIGN_PAUSED' }), false)
})

test('status filter splits active / inactive / all', () => {
  const active = { effective_status: 'ACTIVE' }
  const paused = { effective_status: 'PAUSED' }
  assert.equal(matchesStatusFilter(active, 'active'), true)
  assert.equal(matchesStatusFilter(paused, 'active'), false)
  assert.equal(matchesStatusFilter(paused, 'inactive'), true)
  assert.equal(matchesStatusFilter(active, 'inactive'), false)
  assert.equal(matchesStatusFilter(paused, 'all'), true)
})

test('location filter can isolate campaigns with no club in the name', () => {
  const salem = { name: 'Salem Traffic Campaign' }
  const generic = { name: 'Brand awareness' }
  assert.equal(matchesLocationFilter(salem, 'salem'), true)
  assert.equal(matchesLocationFilter(generic, 'salem'), false)
  assert.equal(matchesLocationFilter(generic, NO_LOCATION), true)
  assert.equal(matchesLocationFilter(salem, NO_LOCATION), false)
  assert.equal(matchesLocationFilter(generic, 'all'), true)
})

test('readGender treats Meta\'s [0] as all genders', () => {
  assert.equal(readGender({ genders: [0] }), 'all')
  assert.equal(readGender({}), 'all')
  assert.equal(readGender({ genders: [1, 2] }), 'all')
  assert.equal(readGender({ genders: [1] }), '1')
  assert.equal(readGender({ genders: [2] }), '2')
})

test('passthroughTargeting preserves what the ad set form cannot render', () => {
  // Shape taken from a real saved audience on the account.
  const targeting = {
    age_min: 18,
    age_max: 65,
    genders: [0],
    publisher_platforms: ['facebook'],
    flexible_spec: [{ family_statuses: [{ id: '1', name: 'Parents with teenagers' }] }],
    targeting_automation: { advantage_audience: 0 },
    geo_locations: {
      cities: [{ key: '2505727', name: 'Salem', radius: 10, distance_unit: 'mile' }],
      custom_locations: [{ latitude: 44.9, longitude: -123.0, radius: 8, distance_unit: 'mile' }],
      location_types: ['home', 'recent'],
    },
  }
  const extra = passthroughTargeting(targeting)

  // Modelled keys are handled by form controls and must NOT be duplicated here.
  assert.equal(extra.age_min, undefined)
  assert.equal(extra.genders, undefined)
  assert.equal(extra.publisher_platforms, undefined)
  assert.equal(extra.geo_locations.cities, undefined)

  // Everything the form cannot express must survive verbatim — dropping these
  // would silently broaden the audience.
  assert.deepEqual(extra.flexible_spec, targeting.flexible_spec)
  assert.deepEqual(extra.targeting_automation, targeting.targeting_automation)
  assert.deepEqual(extra.geo_locations.custom_locations, targeting.geo_locations.custom_locations)
  assert.deepEqual(extra.geo_locations.location_types, ['home', 'recent'])
})

test('readGeoList flattens every geo type Meta returns', () => {
  const list = readGeoList({
    cities: [{ key: '1', name: 'Salem', region: 'Oregon', radius: 12, distance_unit: 'mile' }],
    regions: [{ key: '3880', name: 'Oregon' }],
    zips: [{ key: 'US:97301', name: '97301' }],
    countries: ['US'],
  })
  assert.equal(list.length, 4)
  assert.deepEqual(list.map(g => g.type), ['city', 'region', 'zip', 'country'])
  assert.equal(list[0].radius, 12)
  // A city with no stored radius still needs one or Meta rejects the ad set.
  assert.equal(readGeoList({ cities: [{ key: '1', name: 'Salem' }] })[0].radius, 10)
})
