const test = require('node:test')
const assert = require('node:assert')
const { renderReceiptHtml } = require('./receiptTemplate')

const payload = {
  type: 'till_close', location: 'salem', date: '2026-06-29', closedBy: 'Justin H.',
  float: 100, cashSales: 342.5, cashRefunds: 0, dropsTotal: 200,
  expected: 242.5, counted: 240, overShort: -2.5, bagDrop: 140,
  drops: [{ name: 'Cash Drop', amount: 200 }],
}

test('renders a full HTML doc with the key figures', () => {
  const html = renderReceiptHtml(payload, { logoDataUri: 'data:image/png;base64,AAA' })
  assert.match(html, /<!DOCTYPE html>/i)
  assert.match(html, /TILL CLOSE/i)
  assert.match(html, /Justin H\./)
  assert.match(html, /\$240\.00/)         // counted
  assert.match(html, /-\$2\.50/)          // over/short (short)
  assert.match(html, /\$140\.00/)         // bag drop
  assert.match(html, /Cash Drop/)         // itemized drop
  assert.match(html, /data:image\/png/)   // logo inlined
})

test('positive variance shows a + sign', () => {
  const html = renderReceiptHtml({ ...payload, overShort: 1.25 }, { logoDataUri: '' })
  assert.match(html, /\+\$1\.25/)
})

test('escapes HTML in closedBy', () => {
  const html = renderReceiptHtml({ ...payload, closedBy: '<script>x</script>' }, { logoDataUri: '' })
  assert.doesNotMatch(html, /<script>x<\/script>/)
  assert.match(html, /&lt;script&gt;/)
})
