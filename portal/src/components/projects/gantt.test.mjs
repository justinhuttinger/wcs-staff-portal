import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, dayDiff, taskSpan, barBox, groupRows, dragDates, monthBands } from './gantt.js'

test('day math crosses months and years', () => {
  assert.equal(addDays('2026-11-30', 2), '2026-12-02')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(dayDiff('2026-11-23', '2026-12-01'), 8)
})

test('taskSpan: start_date wins, else created day; no due = no bar; start after due collapses', () => {
  assert.deepEqual(taskSpan({ start_date: '2026-11-20', due_date: '2026-11-25' }), { start: '2026-11-20', end: '2026-11-25', explicitStart: true })
  assert.equal(taskSpan({ created_at: '2026-11-10T18:00:00', due_date: '2026-11-25' }).start, '2026-11-10')
  assert.equal(taskSpan({ created_at: '2026-11-10T18:00:00' }), null)
  assert.equal(taskSpan({ created_at: '2026-11-30T18:00:00', due_date: '2026-11-25' }).start, '2026-11-25')
})

test('barBox: inside, clipped either end, and outside', () => {
  assert.deepEqual(barBox({ start: '2026-11-25', end: '2026-11-27' }, '2026-11-23', 42), { left: 2, width: 3, clipStart: false, clipEnd: false })
  assert.deepEqual(barBox({ start: '2026-11-20', end: '2026-11-24' }, '2026-11-23', 42), { left: 0, width: 2, clipStart: true, clipEnd: false })
  assert.equal(barBox({ start: '2026-11-01', end: '2026-11-02' }, '2026-11-23', 42), null)
  assert.equal(barBox({ start: '2027-02-01', end: '2027-02-02' }, '2026-11-23', 42), null)
  assert.equal(barBox(null, '2026-11-23', 42), null)
})

test('groupRows: by person lists a task under each assignee, unassigned last', () => {
  const tasks = [
    { id: 'a', assignees: [{ staff_id: 'j' }, { staff_id: 'al' }] },
    { id: 'b', assignees: [] },
    { id: 'c', assignees: [{ staff_id: 'j' }], category_id: 'k' },
  ]
  const names = { j: 'Jon', al: 'Alex' }
  const rows = groupRows(tasks, 'person', { nameOf: id => names[id] })
  assert.deepEqual(rows.map(r => [r.label, r.tasks.map(t => t.id).join('')]), [['Alex', 'a'], ['Jon', 'ac'], ['Unassigned', 'b']])
  const byCat = groupRows(tasks, 'category', { categories: [{ id: 'k', name: 'Ops' }, { id: 'z', name: 'Empty' }] })
  assert.deepEqual(byCat.map(r => [r.label, r.tasks.length]), [['Ops', 1], ['No category', 2]])
})

test('dragDates: move shifts both and writes a start; ends never cross', () => {
  const span = { start: '2026-11-23', end: '2026-11-26', explicitStart: false }
  assert.deepEqual(dragDates(span, 'move', 2), { due_date: '2026-11-28', start_date: '2026-11-25' })
  assert.deepEqual(dragDates(span, 'end', 3), { due_date: '2026-11-29' })
  assert.deepEqual(dragDates(span, 'end', -10), { due_date: '2026-11-23' })
  assert.deepEqual(dragDates(span, 'start', 10), { start_date: '2026-11-26' })
  assert.deepEqual(dragDates(span, 'move', 0), {})
})

test('monthBands cover the window month by month', () => {
  const bands = monthBands('2026-11-23', 42)
  assert.deepEqual(bands.map(b => [b.key, b.left, b.width]), [['2026-11', 0, 8], ['2026-12', 8, 31], ['2027-01', 39, 3]])
})
