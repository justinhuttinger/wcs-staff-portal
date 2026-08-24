const test = require('node:test')
const assert = require('node:assert')
const { programEmail, clubFromName, safeFilename } = require('./deliver')
const { getBrand } = require('./brands')

// Taken from the brand config rather than written out, so this file does not
// have to be edited every time the club's name is adjusted.
const ESAC_NAME = getBrand('esac').name

const sarah = { firstName: 'Sarah', lastName: 'Mitchell', email: 's@x.com' }

test('the email names the client and the club', () => {
  const e = programEmail(sarah, 'West Coast Strength - Salem')
  assert.match(e.subject, /Sarah/)
  assert.match(e.text, /^Hi Sarah,/)
  assert.match(e.text, /West Coast Strength - Salem/)
  assert.match(e.html, /<strong>West Coast Strength - Salem<\/strong>/)
})

test('the text and html say the same thing', () => {
  const e = programEmail(sarah, ESAC_NAME)
  const stripped = e.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  const flattened = e.text.replace(/\s+/g, ' ').trim()
  assert.equal(stripped, flattened)
})

test('the sign-off is the club, with no closing line above it', () => {
  const e = programEmail(sarah, ESAC_NAME)
  assert.ok(e.text.trim().endsWith(ESAC_NAME))
  // Removed at Justin's request 2026-08-24. Pinned so it cannot creep back.
  assert.ok(!/crush these goals/i.test(e.text + e.html))
})

test('ESAC is not suffixed with a club name the way WCS clubs are', () => {
  assert.equal(clubFromName({ name: 'Milwaukie' }, 'esac'), ESAC_NAME)
  assert.equal(clubFromName({ name: 'Salem' }, 'wcs'), 'West Coast Strength - Salem')
})

test('the attachment filename drops characters ABC silently rejects', () => {
  assert.equal(safeFilename({ firstName: "Mary-Jane", lastName: "O'Neil (Jr)" }),
    'Training_Program_Mary-Jane_ONeilJr.pdf')
})
