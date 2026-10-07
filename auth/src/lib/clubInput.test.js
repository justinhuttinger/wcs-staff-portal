const test = require('node:test')
const assert = require('node:assert/strict')

const { validateClubInput, defaultActionLinks } = require('./clubInput')
const existing = require('../config/clubs.json').clubs

const good = {
  name: 'Bend', clubNumber: '040123', ghlLocationId: 'AbCdEfGhIjKlMnOpQrSt',
  abcUrl: 'https://prod02.abcfitness.com/SystemLoginCommand.pml?workstationId=x',
  timezone: 'America/Los_Angeles', ghlApiKey: 'pit-1234abcd-5678', paychexCompanyId: '70A1B2C3',
}

test('a valid new club becomes a row + secrets', () => {
  const r = validateClubInput(good, existing)
  assert.deepEqual(r.errors, [])
  assert.equal(r.row.slug, 'bend')
  assert.equal(r.row.env_key, 'BEND')
  assert.equal(r.row.club_number, '40123', 'leading zero dropped')
  assert.equal(r.row.state, 'Oregon')
  assert.equal(r.row.active, true)
  assert.deepEqual(r.secrets, { ghlApiKey: 'pit-1234abcd-5678', paychexCompanyId: '70A1B2C3' })
})

test('name must be one word (slug = lowercased name)', () => {
  const r = validateClubInput({ ...good, name: 'West Salem' }, existing)
  assert.match(r.errors.join(' '), /single word/)
})

test('duplicates are rejected', () => {
  assert.match(validateClubInput({ ...good, name: 'medford' }, existing).errors.join(' '), /already exists/)
  assert.match(validateClubInput({ ...good, clubNumber: '07655' }, existing).errors.join(' '), /already used/)
})

test('field formats', () => {
  const e = validateClubInput({
    ...good, clubNumber: 'abc', ghlLocationId: 'short', abcUrl: 'http://x', timezone: 'Mars/Base',
    ghlApiKey: 'not-a-token', background: 'javascript:alert(1)',
  }, existing).errors.join(' ')
  for (const re of [/club number/, /GHL location ID/, /https/, /timezone/, /pit-/, /Background/]) assert.match(e, re)
})

test('blank optional fields are fine; blank secrets are not sent', () => {
  const r = validateClubInput({ name: 'Bend', clubNumber: '40123' }, existing)
  assert.deepEqual(r.errors, [])
  assert.deepEqual(r.secrets, {})
  assert.equal(r.row.ghl_location_id, null)
  assert.equal(r.row.abc_url, null)
})

test('editing: name, slug and number are fixed; other fields update; unsent fields keep', () => {
  const current = existing.find(c => c.slug === 'medford')
  assert.match(validateClubInput({ name: 'Ashland' }, existing, { current }).errors.join(' '), /Name can't be changed/)
  assert.match(validateClubInput({ clubNumber: '1' }, existing, { current }).errors.join(' '), /Club number can't/)
  assert.deepEqual(validateClubInput({ clubNumber: '032073', name: 'Medford' }, existing, { current }).errors, [], 'same values are fine')

  const r = validateClubInput({ active: false, tradingName: 'Rogue Valley' }, existing, { current })
  assert.deepEqual(r.errors, [])
  assert.equal(r.row.active, false)
  assert.equal(r.row.trading_name, 'Rogue Valley')
  assert.equal(r.row.ghl_location_id, current.ghlLocationId, 'kept')
  assert.equal(r.row.abc_url, current.abcUrl, 'kept')
  assert.equal(r.row.club_number, '32073')
})

test('default Action Links follow the house pattern', () => {
  assert.deepEqual(defaultActionLinks('bend'), {
    dayone_url_bend: 'https://book.westcoaststrength.com/dayone/bend/staff',
    vip_url_bend: 'https://vip.westcoaststrength.com/bend/staff',
  })
})

test('ABC station id: 32 hex characters, stored upper-case, kept on edit', () => {
  const r = validateClubInput({ ...good, abcStationId: '401ff85a16bb61e3e0633ce114ac0cd6' }, existing)
  assert.deepEqual(r.errors, [])
  assert.equal(r.row.abc_station_id, '401FF85A16BB61E3E0633CE114AC0CD6')
  assert.match(validateClubInput({ ...good, abcStationId: 'nope' }, existing).errors.join(' '), /station ID/)
  const current = { ...existing.find(c => c.slug === 'salem'), abcStationId: 'E42B9D7C33C908BEE0532AE014ACBF25' }
  assert.equal(validateClubInput({ active: true }, existing, { current }).row.abc_station_id, 'E42B9D7C33C908BEE0532AE014ACBF25')
})
