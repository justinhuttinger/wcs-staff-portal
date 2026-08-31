import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PORTAL_TILE_CATALOG } from './portalTiles.js'

const tools = JSON.parse(readFileSync(new URL('./tools.json', import.meta.url)))

// The server's allow-list, scraped rather than imported: auth/ is a separate
// CommonJS package and admin.js pulls in Supabase on import, which a unit test
// must not do. Scraping is brittle if the declaration is reformatted, hence
// the explicit failure message.
function serverTileKeys() {
  const src = readFileSync(new URL('../../../auth/src/routes/admin.js', import.meta.url), 'utf8')
  const m = src.match(/const CUSTOM_TILE_KEYS = new Set\(\[([\s\S]*?)\]\)/)
  assert.ok(m, 'could not find CUSTOM_TILE_KEYS in auth/src/routes/admin.js — was it renamed or reformatted?')
  return new Set([...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]))
}

test('wheniwork is gone from both portal catalogs', () => {
  assert.equal(tools.find(t => t.id === 'wheniwork'), undefined)
  assert.equal(PORTAL_TILE_CATALOG.find(t => t.key === 'wheniwork'), undefined)
})

test('every grantable tile key is one the server accepts', () => {
  const allowed = serverTileKeys()
  const orphans = PORTAL_TILE_CATALOG.map(t => t.key).filter(k => !allowed.has(k))
  assert.deepEqual(orphans, [], `catalog keys the server would reject: ${orphans.join(', ')}`)
})
