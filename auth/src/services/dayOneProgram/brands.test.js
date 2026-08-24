const test = require('node:test')
const assert = require('node:assert')
const { getBrand, resolveBrandKey, BRANDS } = require('./brands')

test('defaults to WCS when no brand field is present', () => {
  assert.equal(resolveBrandKey({ 'Program Goal': 'hypertrophy' }), 'wcs')
  assert.equal(resolveBrandKey({}), 'wcs')
  assert.equal(resolveBrandKey(), 'wcs')
})

test('picks ESAC from a field whose value names the brand', () => {
  assert.equal(resolveBrandKey({ Brand: 'ESAC' }), 'esac')
  assert.equal(resolveBrandKey({ 'Program Brand': 'Eastside Athletic Club' }), 'esac')
  assert.equal(resolveBrandKey({ Brand: ['ESAC'] }), 'esac')
})

test('picks ESAC from a checkbox named for the brand', () => {
  assert.equal(resolveBrandKey({ ESAC: 'Yes' }), 'esac')
  assert.equal(resolveBrandKey({ 'Eastside Branding': 'true' }), 'esac')
  assert.equal(resolveBrandKey({ ESAC: 'No' }), 'wcs')
})

test('ignores brand words in free-text client answers', () => {
  assert.equal(resolveBrandKey({
    'What are your Fitness Goals?': 'I used to train at Eastside',
    'Other Limitations': 'esac',
  }), 'wcs')
})

test('ignores non-scalar values (location object, nested payloads)', () => {
  assert.equal(resolveBrandKey({ club: { name: 'ESAC' } }), 'wcs')
})

test('getBrand falls back to WCS for unknown/missing keys', () => {
  assert.equal(getBrand('esac').key, 'esac')
  assert.equal(getBrand('ESAC').key, 'esac')
  assert.equal(getBrand('nope').key, 'wcs')
  assert.equal(getBrand().key, 'wcs')
})

test('ESAC brand is fully black-and-white', () => {
  const esac = BRANDS.esac
  assert.equal(esac.accent, '#000000')
  assert.equal(esac.success, '#000000')
  // No red anywhere in the ESAC palette.
  for (const v of Object.values(esac)) {
    if (typeof v === 'string') assert.ok(!/E31E24|227,30,36/i.test(v), `red leaked: ${v}`)
  }
})
