const test = require('node:test')
const assert = require('node:assert')
const { countVipsByTeamMember } = require('./vipsByTeamMember')

// Mock supabaseAdmin: rpc returns the VIP rows for a given loc_id ('all' when
// null), and ghl_locations name-lookup maps a slug pattern to an id.
function mockAdmin({ rpcByLoc = {}, slugToId = {} }) {
  return {
    rpc: async (_name, { loc_id }) => {
      const key = loc_id == null ? 'all' : loc_id
      return { data: rpcByLoc[key] || [], error: null }
    },
    from: () => ({
      select: () => ({
        ilike: (_col, pattern) => ({
          limit: () => ({
            maybeSingle: async () => {
              const slug = String(pattern).replace(/%/g, '')
              const id = slugToId[slug]
              return { data: id ? { id } : null }
            },
          }),
        }),
      }),
    }),
  }
}

const admin = mockAdmin({
  slugToId: { salem: 'SAL', eugene: 'EUG' },
  rpcByLoc: {
    all: [{ team_member: 'A', total: 29 }],
    SAL: [{ team_member: 'A', total: 8 }],
    EUG: [{ team_member: 'B', total: 5 }],
  },
})

test('no filter counts across all locations (blended)', async () => {
  assert.equal((await countVipsByTeamMember(admin, { locationFilter: null })).total, 29)
})

test('single club (reports `.values` shape) scopes to that club', async () => {
  const r = await countVipsByTeamMember(admin, { locationFilter: { column: 'location_slug', values: ['salem'] } })
  assert.equal(r.total, 8) // was 29 before the fix — the whole bug
})

test('single club (leaderboard `.value` shape) still works', async () => {
  const r = await countVipsByTeamMember(admin, { locationFilter: { column: 'location_slug', value: 'salem' } })
  assert.equal(r.total, 8)
})

test('multi-club selection sums per club', async () => {
  const r = await countVipsByTeamMember(admin, { locationFilter: { column: 'location_slug', values: ['salem', 'eugene'] } })
  assert.equal(r.total, 13) // 8 + 5
  assert.deepEqual(r.byPerson, { A: 8, B: 5 })
})

test("'all' slug means no scoping (all locations)", async () => {
  const r = await countVipsByTeamMember(admin, { locationFilter: { column: 'location_slug', value: 'all' } })
  assert.equal(r.total, 29)
})

test('NO_ACCESS sentinel counts nothing', async () => {
  const r = await countVipsByTeamMember(admin, { locationFilter: { column: 'location_slug', values: ['__no_access__'] } })
  assert.equal(r.total, 0)
})
