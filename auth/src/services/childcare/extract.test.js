// node --test auth/src/services/childcare/extract.test.js
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { normalizeStepName, parseCount, countsFromSteps, buildEntries } = require('./extract')

test('normalizeStepName strips the (copy) suffix Operandio adds', () => {
  // Both questions were created by duplicating a step, which produced
  // "... Younger than 1 Year (copy)" in the live processes on 2026-08-24.
  assert.equal(normalizeStepName('Total Number of Children Younger than 1 Year (copy)'),
    'total number of children younger than 1 year')
  assert.equal(normalizeStepName('Total Number of Children Younger than 1 Year (copy 2)'),
    'total number of children younger than 1 year')
  assert.equal(normalizeStepName('  Total  Number of Children Older than 1 Year '),
    'total number of children older than 1 year')
})

test('parseCount treats non-numeric answers as unknown, never zero', () => {
  assert.equal(parseCount('10'), 10)
  assert.equal(parseCount(' 0 '), 0)      // a real zero is still a real zero
  assert.equal(parseCount(''), null)
  assert.equal(parseCount('-'), null)
  assert.equal(parseCount('n/a'), null)
  assert.equal(parseCount('about 5'), null)
  assert.equal(parseCount('3.5'), null)
  assert.equal(parseCount(null), null)
})

test('countsFromSteps reads both metrics regardless of order or suffix', () => {
  const counts = countsFromSteps([
    { name: 'Total Number of Children Younger than 1 Year (copy)', response: '2' },
    { name: 'Total Number of Children Older than 1 Year', response: '10' },
    { name: 'Toys put away', response: 'true' },
  ])
  assert.deepEqual(counts, { over1: 10, under1: 2, conflicts: 0 })
})

test('countsFromSteps leaves a blank metric unknown', () => {
  const counts = countsFromSteps([
    { name: 'Total Number of Children Older than 1 Year', response: '4' },
    { name: 'Total Number of Children Younger than 1 Year', response: '' },
  ])
  assert.deepEqual(counts, { over1: 4, under1: null, conflicts: 0 })
})

const BLOCKS = new Map([['p-morning', 'morning'], ['p-evening', 'evening']])
const job = (over, patch = {}) => ({
  id: patch.id || 'j1', location_slug: 'milwaukie', process_id: 'p-evening',
  job_date: '2026-08-24', submitted: true, submitted_at: '2026-08-25T02:18:06Z',
  submitted_by: 'Justin Huttinger', ...patch,
})
const steps = (over1, under1) => ([
  { name: 'Total Number of Children Older than 1 Year', response: String(over1) },
  { name: 'Total Number of Children Younger than 1 Year', response: String(under1) },
])

test('buildEntries produces one entry per club/day/block', () => {
  const jobs = [job(10, { id: 'a' }), job(3, { id: 'b', process_id: 'p-morning' })]
  const stepsByJob = new Map([['a', steps(10, 2)], ['b', steps(3, 1)]])
  const entries = buildEntries(jobs, stepsByJob, BLOCKS)
  assert.equal(entries.length, 2)
  assert.deepEqual(entries.map((e) => e.block).sort(), ['evening', 'morning'])
})

test('a second submission for one block is a correction, not more children', () => {
  // Real 2026-08-24 case: two evening submissions three minutes apart,
  // 10/2 then 9/9. Summing would double-count the same kids and inflate
  // every average the staffing decision is made from.
  const jobs = [
    job(10, { id: 'first', submitted_at: '2026-08-25T02:18:06Z' }),
    job(9, { id: 'second', submitted_at: '2026-08-25T02:21:03Z' }),
  ]
  const stepsByJob = new Map([['first', steps(10, 2)], ['second', steps(9, 9)]])
  const entries = buildEntries(jobs, stepsByJob, BLOCKS)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].over1, 9)          // latest wins
  assert.equal(entries[0].under1, 9)
  assert.equal(entries[0].submissions, 2)    // but the correction stays visible
  assert.equal(entries[0].job_id, 'second')
})

test('latest wins regardless of the order jobs arrive in', () => {
  const jobs = [
    job(9, { id: 'second', submitted_at: '2026-08-25T02:21:03Z' }),
    job(10, { id: 'first', submitted_at: '2026-08-25T02:18:06Z' }),
  ]
  const stepsByJob = new Map([['first', steps(10, 2)], ['second', steps(9, 9)]])
  const entries = buildEntries(jobs, stepsByJob, BLOCKS)
  assert.equal(entries[0].over1, 9)
  assert.equal(entries[0].submissions, 2)
})

test('buildEntries skips jobs that are not childcare, not submitted, or numberless', () => {
  const jobs = [
    job(1, { id: 'other', process_id: 'p-unrelated' }),
    job(1, { id: 'draft', submitted: false }),
    job(1, { id: 'blank' }),
  ]
  const stepsByJob = new Map([
    ['other', steps(5, 5)],
    ['draft', steps(5, 5)],
    ['blank', [{ name: 'Toys put away', response: 'true' }]],
  ])
  assert.deepEqual(buildEntries(jobs, stepsByJob, BLOCKS), [])
})

test('buildEntries keeps a day where only one metric was answered', () => {
  const jobs = [job(4, { id: 'partial' })]
  const stepsByJob = new Map([['partial', [
    { name: 'Total Number of Children Older than 1 Year', response: '4' },
    { name: 'Total Number of Children Younger than 1 Year', response: '' },
  ]]])
  const entries = buildEntries(jobs, stepsByJob, BLOCKS)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].over1, 4)
  assert.equal(entries[0].under1, null)
})

// --- one checklist asking the same question twice ---------------------------
//
// Duplicating a step in Operandio leaves the original AND the copy live.
// Milwaukie's evening list did exactly that on 2026-08-24.

test('a question answered twice with different numbers keeps the higher', () => {
  // Undercounting is the direction that leaves a room short-staffed, so the
  // ambiguous case resolves upward rather than downward.
  const counts = countsFromSteps([
    { name: 'Total Number of Children Older than 1 Year', response: '9' },
    { name: 'Total Number of Children Older than 1 Year', response: '10' },
  ])
  assert.equal(counts.over1, 10)
  assert.equal(counts.conflicts, 1)
})

test('the higher wins regardless of which order the rows arrive in', () => {
  // The old code took whichever came last, so the same day read 9 or 10
  // depending on the order PostgREST happened to return.
  const a = countsFromSteps([
    { name: 'Total Number of Children Older than 1 Year', response: '10' },
    { name: 'Total Number of Children Older than 1 Year', response: '9' },
  ])
  assert.equal(a.over1, 10)
})

test('a (copy) of a question counts as the same question, not a second metric', () => {
  const counts = countsFromSteps([
    { name: 'Total Number of Children Younger than 1 Year', response: '9' },
    { name: 'Total Number of Children Younger than 1 Year (copy)', response: '2' },
  ])
  assert.equal(counts.under1, 9)
  assert.equal(counts.conflicts, 1)
})

test('the same answer twice is duplication, not a disagreement', () => {
  const counts = countsFromSteps([
    { name: 'Total Number of Children Older than 1 Year', response: '4' },
    { name: 'Total Number of Children Older than 1 Year (copy)', response: '4' },
  ])
  assert.equal(counts.over1, 4)
  assert.equal(counts.conflicts, 0)
})
