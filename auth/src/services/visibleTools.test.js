const test = require('node:test')
const assert = require('node:assert')
const Module = require('module')

// Stub ./permissions so getVisibleTools is tested in isolation.
const origLoad = Module._load
Module._load = function (request) {
  if (request === './permissions') {
    return { getEffectivePermissions: async () => ['tile:x', 'grow'] }
  }
  return origLoad.apply(this, arguments)
}
const { getVisibleTools } = require('./visibleTools')
Module._load = origLoad

test('getVisibleTools returns the effective permission set', async () => {
  const out = await getVisibleTools({ id: '1', role: 'lead' })
  assert.deepStrictEqual(out.sort(), ['grow', 'tile:x'])
})

test('getVisibleTools returns [] for no staff', async () => {
  assert.deepStrictEqual(await getVisibleTools(null), [])
})
