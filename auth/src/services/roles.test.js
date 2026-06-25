const test = require('node:test')
const assert = require('node:assert')

// The resolver caches a name->tier map. We test the pure fallback path by
// stubbing the loader through the exported _resolveFromMap helper.
const { _resolveFromMap } = require('./roles')

test('_resolveFromMap returns base_tier when the role is in the map', () => {
  const map = { lead: 'lead', 'assistant-manager': 'manager' }
  assert.strictEqual(_resolveFromMap(map, 'assistant-manager'), 'manager')
})

test('_resolveFromMap falls back to alias resolution for unknown roles', () => {
  const map = { lead: 'lead' }
  // front_desk is not in the map; alias resolution maps it to team_member.
  assert.strictEqual(_resolveFromMap(map, 'front_desk'), 'team_member')
})

test('_resolveFromMap falls back to the raw role when nothing matches', () => {
  assert.strictEqual(_resolveFromMap({}, 'manager'), 'manager')
})
