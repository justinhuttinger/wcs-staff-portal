const test = require('node:test')
const assert = require('node:assert')
const { buildL10Sheet, validSpec } = require('./l10Sheet')

const spec = {
  heading: 'L10 — By Club',
  subheading: 'November 1–16, 2026 · change vs 6-month average',
  columns: ['Club', 'New Members', 'Dues Revenue'],
  rows: [
    { label: 'Salem', cells: [{ main: '116', sub: '-7.2 (-5.8%)', tone: 'bad' }, { main: '$93,310', sub: '+$784 (+0.8%)', tone: 'good' }] },
    { label: 'Keizer', cells: [{ main: '120', sub: '0', tone: 'neutral' }, { main: '$100,782', sub: '+$1 (+0.0%)', tone: 'good' }] },
    { label: 'Total', total: true, cells: [{ main: '236', sub: '+1', tone: 'good' }, { main: '$194,092', sub: '+$785', tone: 'good' }] },
  ],
}
const data = [['Club', 'New Members'], ['Salem', 116], ['Keizer', 120], ['Total', 236]]

test('validSpec accepts what the page sends and refuses anything else', () => {
  assert.ok(validSpec(spec))
  assert.ok(!validSpec(null))
  assert.ok(!validSpec({ ...spec, columns: ['Club'] }))
  assert.ok(!validSpec({ ...spec, rows: [{ label: 'x', cells: [{ main: '1' }] }] }), 'cell count must match columns')
  assert.ok(!validSpec({ ...spec, rows: [{ label: 'x', cells: [{ main: '1', tone: 'purple' }, { main: '2' }] }] }))
  assert.ok(!validSpec({ ...spec, heading: 'x'.repeat(500) }))
})

test('each cell is the value with its change under it, the change coloured by tone', () => {
  const { requests } = buildL10Sheet(spec, data)
  const rows = requests[0].updateCells.rows
  const salemNew = rows[4].values[1]
  assert.equal(salemNew.userEnteredValue.stringValue, '116\n-7.2 (-5.8%)')
  const [main, sub] = salemNew.textFormatRuns
  assert.equal(main.startIndex, 0)
  assert.equal(sub.startIndex, 4)
  assert.ok(sub.format.foregroundColor.red > 0.8, 'bad is red')
  const salemDues = rows[4].values[2].textFormatRuns[1]
  assert.ok(salemDues.format.foregroundColor.green > salemDues.format.foregroundColor.red, 'good is green')
})

test('zebra starts tinted, headers are upper case, the Total row is bold and ruled', () => {
  const { requests, sheets } = buildL10Sheet(spec, data)
  const rows = requests[0].updateCells.rows
  assert.equal(rows[3].values[1].userEnteredValue.stringValue, 'NEW MEMBERS')
  const bg = r => rows[r].values[0].userEnteredFormat.backgroundColor.red
  assert.ok(bg(4) < 1 && bg(5) === 1, 'first body row tinted, second white')
  assert.equal(rows[6].values[1].userEnteredFormat.textFormat.bold, true)
  const rule = requests.find(r => r.updateBorders && r.updateBorders.top && r.updateBorders.top.style === 'SOLID_MEDIUM')
  assert.equal(rule.updateBorders.range.startRowIndex, 6)
  assert.equal(sheets[0].hideGridlines, true)
  assert.deepEqual(sheets.map(s => s.title), ['By Club', 'Data'])
})
