const test = require('node:test')
const assert = require('node:assert')
const { getBrand, resolveBrandKey, brandFieldNames, BRANDS } = require('./brands')

test('defaults to WCS when no brand field is present', () => {
  assert.equal(resolveBrandKey({ 'Program Goal': 'hypertrophy' }), 'wcs')
  assert.equal(resolveBrandKey({}), 'wcs')
  assert.equal(resolveBrandKey(), 'wcs')
})

test('picks ESAC from a field whose value names the brand', () => {
  assert.equal(resolveBrandKey({ Brand: 'ESAC' }), 'esac')
  assert.equal(resolveBrandKey({ 'Program Brand': 'East Side Athletic Club' }), 'esac')
  assert.equal(resolveBrandKey({ Brand: ['ESAC'] }), 'esac')
})

test('picks ESAC from a checkbox named for the brand', () => {
  assert.equal(resolveBrandKey({ ESAC: 'Yes' }), 'esac')
  assert.equal(resolveBrandKey({ 'East Side Branding': 'true' }), 'esac')
  assert.equal(resolveBrandKey({ ESAC: 'No' }), 'wcs')
})

// The club is written both ways in the wild. Detection must not care, so a
// field filled in from memory still picks the right brand.
test('either spelling of the club name resolves', () => {
  assert.equal(resolveBrandKey({ Brand: 'East Side' }), 'esac')
  assert.equal(resolveBrandKey({ Brand: 'Eastside' }), 'esac')
  assert.equal(resolveBrandKey({ Brand: 'EAST SIDE ATHLETIC CLUB' }), 'esac')
})

test('ignores brand words in free-text client answers', () => {
  assert.equal(resolveBrandKey({
    'What are your Fitness Goals?': 'I used to train at East Side',
    'Other Limitations': 'esac',
  }), 'wcs')
})

// GHL puts a workflow action's Custom Data in a nested `customData` object,
// while form answers arrive top-level. A run configured as Brand=ESAC came out
// WCS in prod because only the top level was scanned.
test('finds the brand inside nested customData', () => {
  assert.equal(resolveBrandKey({ customData: { Brand: 'ESAC' } }), 'esac')
  assert.equal(resolveBrandKey({ customData: { ESAC: 'Yes' } }), 'esac')
  assert.equal(resolveBrandKey({ customData: { Brand: 'WCS' } }), 'wcs')
  assert.equal(resolveBrandKey({ customData: {} }), 'wcs')
})

test('nesting does not weaken the free-text guard', () => {
  assert.equal(resolveBrandKey({
    customData: { 'What are your Fitness Goals?': 'I used to train at Eastside' },
  }), 'wcs')
})

test('a real payload shape resolves alongside the other fields', () => {
  assert.equal(resolveBrandKey({
    contact_id: 'k16U4YOIRYa3wbenwFNh',
    location: { id: 'uflpfHNpByAnaBLkQzu3', name: 'Salem' },
    'Service Employee': 'Seth  Tripp',
    customData: { Brand: 'ESAC' },
  }), 'esac')
})

test('brandFieldNames reports labels with their path, no values', () => {
  const names = brandFieldNames({ customData: { Brand: 'ESAC' }, location: { id: 'x' } })
  assert.deepEqual(names, ['customData.Brand'])
  assert.ok(!JSON.stringify(names).includes('ESAC'))
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
