const test = require('node:test')
const assert = require('node:assert')
const path = require('node:path')

// The route pulls in the Supabase client at require time. /board never queries
// it, so stub it (and the feature flags) before loading the router.
function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel))
  require.cache[file] = { id: file, filename: file, loaded: true, exports }
}
stub('../services/supabase', { supabaseAdmin: {} })
stub('../lib/clubFeatures', { isEnabled: async () => true })

const router = require('./publicFacility')
const { ESAC_MARK_DATA_URI } = require('../templates/esacMark')
const { WCS_MARK_DATA_URI } = require('../templates/wcsMark')

function board(query) {
  const layer = router.stack.find(l => l.route && l.route.path === '/board')
  return new Promise((resolve, reject) => {
    const res = {
      set() { return res },
      status() { return res },
      type() { return res },
      send: resolve,
    }
    Promise.resolve(layer.route.stack[0].handle({ query }, res)).catch(reject)
  })
}

test('Milwaukie courts and pool boards carry ESAC branding', async () => {
  const html = await board({ club: 'milwaukie', facility: 'pool' })
  assert.ok(html.includes(ESAC_MARK_DATA_URI))
  assert.ok(!html.includes(WCS_MARK_DATA_URI))
  assert.ok(html.includes('--color-accent: #000000;'))
})

test('other clubs keep the WCS board', async () => {
  const html = await board({ club: 'salem', facility: 'pool' })
  assert.ok(html.includes(WCS_MARK_DATA_URI))
  assert.ok(html.includes('--color-accent: #ff0000;'))
})
