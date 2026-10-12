const test = require('node:test')
const assert = require('node:assert')
const { buildCensusCsv, parseCensusResponse, runMemberGeocode } = require('./memberGeocode')

test('buildCensusCsv quotes commas and uses row index ids', () => {
  const csv = buildCensusCsv([
    { address_line1: '290 Moyer Ln NW', city: 'Salem', state: 'OR', postal_code: '97304' },
    { address_line1: '12 "A" St, Unit 3', city: 'Keizer', state: 'OR', postal_code: null },
  ])
  assert.strictEqual(csv, '0,290 Moyer Ln NW,Salem,OR,97304\n1,"12 ""A"" St, Unit 3",Keizer,OR,\n')
})

test('parseCensusResponse reads matches, no-matches and ties', () => {
  const r = parseCensusResponse([
    '"0","290 Moyer Ln NW, Salem, OR, 97304","Match","Exact","290 MOYER LN NW, SALEM, OR, 97304","-123.048534,44.948314","155779410","L"',
    '"1","5045 River Rd N, Keizer, OR, 97303","No_Match"',
    '"2","1 Main St, Salem, OR, 97301","Tie"',
  ].join('\n'))
  assert.deepStrictEqual(r.get(0), { status: 'match', match_type: 'Exact', matched_address: '290 MOYER LN NW, SALEM, OR, 97304', lat: 44.948314, lng: -123.048534 })
  assert.strictEqual(r.get(1).status, 'no_match')
  assert.strictEqual(r.get(2).status, 'no_match')
})

function fakeDb(pendingPages) {
  const upserts = []
  return {
    upserts,
    rpc: async () => ({ data: pendingPages.shift() || [], error: null }),
    from: () => ({ upsert: async rows => { upserts.push(...rows); return { error: null } } }),
  }
}

test('runMemberGeocode writes results keyed by address_key', async () => {
  const db = fakeDb([[
    { address_key: 'A|SALEM|OR|97304', address_line1: 'a', city: 'Salem', state: 'OR', postal_code: '97304' },
    { address_key: 'B|SALEM|OR|97304', address_line1: 'b', city: 'Salem', state: 'OR', postal_code: '97304' },
  ]])
  const fetchImpl = async () => ({ ok: true, text: async () => '"1","b","No_Match"\n"0","a","Match","Exact","A","-123,44","1","L"\n' })
  const s = await runMemberGeocode({ db, fetchImpl, batchSize: 10 })
  assert.deepStrictEqual(s, { looked_up: 2, matched: 1, no_match: 1, batches: 1 })
  assert.strictEqual(db.upserts.find(u => u.address_key === 'A|SALEM|OR|97304').lat, 44)
  assert.strictEqual(db.upserts.find(u => u.address_key === 'B|SALEM|OR|97304').status, 'no_match')
})

test('runMemberGeocode writes nothing when Census fails', async () => {
  const db = fakeDb([[{ address_key: 'A', address_line1: 'a', city: 'x', state: 'OR', postal_code: '1' }]])
  const fetchImpl = async () => ({ ok: false, status: 503 })
  await assert.rejects(runMemberGeocode({ db, fetchImpl }), /HTTP 503/)
  assert.strictEqual(db.upserts.length, 0)
})
