const test = require('node:test')
const assert = require('node:assert')
const { titleFontSize, formatProgramHTML } = require('./pdf')
const { getBrand } = require('./brands')

const ESAC = getBrand('esac')
const WCS = getBrand('wcs')

test('short titles keep the full base size', () => {
  assert.equal(titleFontSize('DAY 1 - UPPER A', WCS), 42)
  assert.equal(titleFontSize('DAY 2 - UPPER BODY A', ESAC), 42)
})

test('long titles shrink instead of wrapping', () => {
  // Measured: these wrapped at 42px before the fix.
  assert.ok(titleFontSize('DAY 7 - FULL BODY STRENGTH AND POWER', WCS) < 42)
  assert.ok(titleFontSize('DAY 5 - UPPER BODY PUSH AND PULL', ESAC) < 42)
})

test('ESAC shrinks sooner than WCS, its wordmark leaves less room', () => {
  const t = 'DAY 6 - UPPER BODY PUSH PULL LEGS'
  assert.ok(titleFontSize(t, ESAC) < titleFontSize(t, WCS))
})

test('size never drops below the legibility floor', () => {
  assert.equal(titleFontSize('DAY 1 - ' + 'X'.repeat(400), ESAC), 18)
})

test('an absent title does not produce NaN', () => {
  assert.equal(titleFontSize('', WCS), 42)
  assert.equal(titleFontSize(undefined, WCS), 42)
})

test('the day heading carries an explicit one-line size', () => {
  const html = formatProgramHTML(
    { firstName: 'Sarah', lastName: 'Mitchell' },
    { weekTemplate: { workouts: [{ day: 7, title: 'Full Body Strength and Power', exercises: [] }] } },
    'esac',
  )
  assert.match(html, /<h2 style="font-size: \d+px;">DAY 7 - FULL BODY STRENGTH AND POWER<\/h2>/)
})
