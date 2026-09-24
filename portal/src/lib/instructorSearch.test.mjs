import { test } from 'node:test'
import assert from 'node:assert/strict'

import { filterInstructors } from './instructorSearch.js'

const staff = [
  { employee_id: '1', display_name: 'Sam Rivera', department: 'Group Exercise' },
  { employee_id: '2', display_name: 'Alex Kim', department: 'Group Exercise' },
  { employee_id: '3', display_name: 'Samantha Cole', department: 'Personal Trainers' },
]
const ids = list => list.map(i => i.employee_id)

test('an empty search returns everyone, in the order given', () => {
  assert.deepEqual(ids(filterInstructors(staff, '')), ['1', '2', '3'])
  assert.deepEqual(ids(filterInstructors(staff, '   ')), ['1', '2', '3'])
})

test('matches first name, surname, part of a name, any case', () => {
  assert.deepEqual(ids(filterInstructors(staff, 'sam')), ['1', '3'])
  assert.deepEqual(ids(filterInstructors(staff, 'KIM')), ['2'])
  assert.deepEqual(ids(filterInstructors(staff, 'cole')), ['3'])
})

test('every word must match, and department counts', () => {
  assert.deepEqual(ids(filterInstructors(staff, 'sam personal')), ['3'])
  assert.deepEqual(ids(filterInstructors(staff, 'group')), ['1', '2'])
  assert.deepEqual(ids(filterInstructors(staff, 'sam zzz')), [])
})
