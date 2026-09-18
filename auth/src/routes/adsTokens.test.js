const test = require('node:test')
const assert = require('node:assert')
const { renderTokens, findTokens, missingTokens, renderFields } = require('./adsTokens')

test('substitutes a token everywhere it appears', () => {
  const out = renderTokens('Join West Coast Strength {{club}} — {{club}} members train free', { club: 'Keizer' })
  assert.equal(out, 'Join West Coast Strength Keizer — Keizer members train free')
})

test('tolerates spacing and case inside the braces', () => {
  const values = { club: 'Eugene' }
  assert.equal(renderTokens('{{ club }}', values), 'Eugene')
  assert.equal(renderTokens('{{CLUB}}', values), 'Eugene')
})

test('leaves text without tokens untouched, including stray braces', () => {
  assert.equal(renderTokens('No tokens here', { club: 'Salem' }), 'No tokens here')
  assert.equal(renderTokens('Save {50} today', { club: 'Salem' }), 'Save {50} today')
  assert.equal(renderTokens('', { club: 'Salem' }), '')
  assert.equal(renderTokens(null, { club: 'Salem' }), '')
})

test('a value that itself looks like a token is not re-expanded', () => {
  // Otherwise a club named "{{club}}" would recurse or leak another value.
  const out = renderTokens('{{club}} and {{offer}}', { club: '{{offer}}', offer: 'free week' })
  assert.equal(out, '{{offer}} and free week')
})

test('findTokens lists every distinct token in the text', () => {
  assert.deepEqual(findTokens('{{club}} {{city}} {{club}}').sort(), ['city', 'club'])
  assert.deepEqual(findTokens('nothing'), [])
})

test('missingTokens names what a club cannot fill', () => {
  const missing = missingTokens(
    ['Welcome to {{club}}', 'Book at {{link_name}}'],
    { club: 'Medford' },
  )
  assert.deepEqual(missing, ['link_name'])
})

test('an empty string counts as filled, undefined does not', () => {
  // A deliberately blank token is a choice; a missing one is a mistake.
  assert.deepEqual(missingTokens(['{{promo}}'], { promo: '' }), [])
  assert.deepEqual(missingTokens(['{{promo}}'], {}), ['promo'])
})

test('renderFields walks a shape and renders only its strings', () => {
  const out = renderFields(
    {
      name: '{{club}} — Spring',
      budget: 5000,
      creative: { primary_text: 'Train in {{club}}', headline: null, tags: ['{{club}} gym'] },
    },
    { club: 'Springfield' },
  )
  assert.deepEqual(out, {
    name: 'Springfield — Spring',
    budget: 5000,
    creative: { primary_text: 'Train in Springfield', headline: null, tags: ['Springfield gym'] },
  })
})
