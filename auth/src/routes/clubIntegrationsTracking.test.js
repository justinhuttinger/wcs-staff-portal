const test = require('node:test')
const assert = require('node:assert/strict')
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'
const { trackingPatch } = require('./clubIntegrationsAdmin')

test('trackingPatch: absent leaves untouched, blank clears, snippet parses, junk errors', () => {
  assert.deepEqual(trackingPatch({}), { ok: true, patch: {} })
  assert.deepEqual(trackingPatch({ ghl_tracking_snippet: '' }), { ok: true, patch: { ghl_tracking_src: null, ghl_tracking_id: null } })
  const good = trackingPatch({ ghl_tracking_snippet: '<script src="https://link.msgsndr.com/js/external-tracking.js" data-tracking-id="tk_abc12345"></script>' })
  assert.deepEqual(good, { ok: true, patch: { ghl_tracking_src: 'https://link.msgsndr.com/js/external-tracking.js', ghl_tracking_id: 'tk_abc12345' } })
  assert.equal(trackingPatch({ ghl_tracking_snippet: 'tk_abc12345' }).ok, false)
})
