import test from 'node:test'
import assert from 'node:assert'
import { sortItems, arrangeMemo, arrangeNotes, splitLabel, descriptionLines, textTier, wrapWords, fitMemo } from './memoLayout.js'

const item = (title, n = 10) => ({ title, description: 'x'.repeat(n) })
// Crude but deterministic: every character is half the font size wide.
const measure = (text, opts) => text.length * (opts?.size ?? 10) * 0.5

test('longest items come first; ties keep their written order', () => {
  const sorted = sortItems([item('a', 5), item('b', 50), item('c', 5)])
  assert.deepStrictEqual(sorted.map(i => i.title), ['b', 'a', 'c'])
})

test('layout depends on how many items there are', () => {
  const shape = n => arrangeMemo(Array.from({ length: n }, (_, i) => item('t' + i, 100 - i)))
    .map(r => `${r.style}:${r.items.length}`)
  assert.deepStrictEqual(shape(0), [])
  assert.deepStrictEqual(shape(1), ['feature:1'])
  assert.deepStrictEqual(shape(2), ['plain:2'])
  assert.deepStrictEqual(shape(3), ['feature:1', 'plain:2'])
  assert.deepStrictEqual(shape(4), ['feature:1', 'plain:3'])
  assert.deepStrictEqual(shape(5), ['feature:1', 'plain:3', 'band:1'])
  assert.deepStrictEqual(shape(6), ['feature:1', 'plain:3', 'plain:2'])
  assert.deepStrictEqual(shape(7), ['feature:1', 'plain:3', 'plain:3'])
  assert.deepStrictEqual(shape(8), ['feature:1', 'plain:3', 'plain:3', 'band:1'])
})

test('every item appears exactly once, whatever the count', () => {
  for (let n = 0; n <= 40; n++) {
    const items = Array.from({ length: n }, (_, i) => item('t' + i, (i * 7) % 30))
    const main = arrangeMemo(items).flatMap(r => r.items).map(i => i.title).sort()
    const notes = arrangeNotes(items).flatMap(r => r.items).map(i => i.title).sort()
    assert.deepStrictEqual(main, items.map(i => i.title).sort())
    assert.deepStrictEqual(notes, items.map(i => i.title).sort())
  }
})

test('the feature is the longest item and the band the next longest', () => {
  const rows = arrangeMemo([item('s', 1), item('l', 90), item('m', 50), item('a', 2), item('b', 3)])
  assert.strictEqual(rows[0].items[0].title, 'l')
  assert.strictEqual(rows.at(-1).style, 'band')
  assert.strictEqual(rows.at(-1).items[0].title, 'm')
})

test('a short label before a colon is split out; a long sentence is not', () => {
  assert.deepStrictEqual(splitLabel('M2M: First month free'), { label: 'M2M:', text: 'First month free' })
  assert.strictEqual(splitLabel('This is a very long sentence that happens: to have a colon').label, '')
  assert.strictEqual(splitLabel('No colon').label, '')
})

test('description lines ignore blanks', () => {
  assert.deepStrictEqual(descriptionLines('a\n\n b \n'), ['a', 'b'])
})

test('more text means a smaller page tier', () => {
  assert.strictEqual(textTier([item('a', 100)]), 'large')
  assert.strictEqual(textTier([item('a', 1500)]), 'medium')
  assert.strictEqual(textTier([item('a', 3000)]), 'small')
})

test('wrapWords never exceeds the width, even for one enormous word', () => {
  const words = [{ text: 'short', bold: false }, { text: 'y'.repeat(50), bold: false }, { text: 'end', bold: false }]
  const m = (t) => t.length
  const lines = wrapWords(words, 10, m)
  for (const line of lines) {
    assert.ok(line.map(w => w.text).join(' ').length <= 10)
  }
  assert.strictEqual(lines.flat().map(w => w.text).join(''), 'short' + 'y'.repeat(50) + 'end')
})

test('fitMemo uses big text for little content and shrinks to fit a lot', () => {
  const box = { width: 1460, height: 1200, measure }
  const few = fitMemo({ mainRows: arrangeMemo([item('One', 40)]), noteRows: [], ...box })
  const many = fitMemo({
    mainRows: arrangeMemo(Array.from({ length: 12 }, (_, i) => item('Item ' + i, 300))),
    noteRows: arrangeNotes([item('Note', 200)]),
    ...box,
  })
  assert.ok(few.fits && many.fits)
  assert.ok(few.font.body > many.font.body)
  assert.ok(many.used <= box.height)
})

test('a very long memo still fits and is flagged as small', () => {
  const r = fitMemo({
    mainRows: arrangeMemo(Array.from({ length: 40 }, (_, i) => item('Item ' + i, 400))),
    noteRows: [],
    width: 1460, height: 1200, measure,
  })
  assert.strictEqual(r.small, true)
})
