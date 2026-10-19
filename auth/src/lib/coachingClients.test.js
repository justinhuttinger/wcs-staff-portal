const test = require('node:test')
const assert = require('node:assert')
const {
  weekStart, programPhase, currentProgram, scheduledPrograms, clientCounts, summarizeClient,
  buildActivity, epley, progressFor, loggedExercises, latestAt, pairKey,
} = require('./coachingClients')

test('weekStart: Monday of the week, Monday itself and Sunday included', () => {
  assert.equal(weekStart('2026-10-19'), '2026-10-19') // Monday
  assert.equal(weekStart('2026-10-21'), '2026-10-19') // Wednesday
  assert.equal(weekStart('2026-10-25'), '2026-10-19') // Sunday belongs to the week before
  assert.equal(weekStart('2026-11-02'), '2026-11-02')
  assert.equal(weekStart('2026-03-01'), '2026-02-23') // across a month (and leap-free Feb)
})

const p = (over) => ({ id: 'x', is_active: true, starts_on: null, ends_on: null, created_at: '2026-10-01T00:00:00Z', ...over })

test('programPhase and currentProgram: newest started wins, future is scheduled', () => {
  const today = '2026-10-19'
  assert.equal(programPhase(p({ is_active: false }), today), 'archived')
  assert.equal(programPhase(p({ ends_on: '2026-10-18' }), today), 'ended')
  assert.equal(programPhase(p({ starts_on: '2026-10-20' }), today), 'scheduled')
  assert.equal(programPhase(p({ starts_on: '2026-10-19' }), today), 'current')

  const list = [
    p({ id: 'old', starts_on: '2026-09-01' }),
    p({ id: 'new', starts_on: '2026-10-12' }),
    p({ id: 'next', starts_on: '2026-11-01' }),
    p({ id: 'next2', starts_on: '2026-10-26' }),
  ]
  assert.equal(currentProgram(list, today).id, 'new')
  assert.deepEqual(scheduledPrograms(list, today).map(x => x.id), ['next2', 'next'])
  assert.equal(currentProgram([], today), null)
})

const S = (member_id, performed_on, done = true) => ({
  member_id, club_number: '30935', performed_on, completed_at: done ? `${performed_on}T18:00:00Z` : null,
})

test('clientCounts: active, new in 7 days, trained this week, not trained 7+ days, archived', () => {
  const today = '2026-10-21' // Wednesday; week starts 10-19
  const clients = [
    { member_id: 'a', club_number: '30935', status: 'active', upgraded_at: '2026-10-20T10:00:00Z' },
    { member_id: 'b', club_number: '30935', status: 'active', upgraded_at: '2026-09-01T10:00:00Z' },
    { member_id: 'c', club_number: '30935', status: 'active', upgraded_at: null },
    { member_id: 'd', club_number: '30935', status: 'archived', upgraded_at: '2026-10-20T10:00:00Z' },
  ]
  const sessions = [
    S('a', '2026-10-20'),
    S('b', '2026-10-17'), // last week but within 7 days
    S('c', '2026-10-10'),
    S('c', '2026-10-21', false), // unfinished does not count
    S('d', '2026-10-21'),
  ]
  assert.deepEqual(clientCounts(clients, sessions, today), {
    active: 3, newLast7: 1, trainedThisWeek: 1, notTrained7: 1, archived: 1,
  })
})

test('summarizeClient: last workout, this week, current and next program', () => {
  const today = '2026-10-21'
  const client = { member_id: 'a', club_number: '30935' }
  const sessions = [S('a', '2026-10-20'), S('a', '2026-10-19'), S('a', '2026-10-15'), S('a', '2026-10-21', false), S('b', '2026-10-21')]
  const programs = [
    { ...p({ id: 'cur', name: 'Block 2', starts_on: '2026-10-12' }), member_id: 'a', club_number: '30935' },
    { ...p({ id: 'nxt', name: 'Block 3', starts_on: '2026-11-09' }), member_id: 'a', club_number: '30935' },
    { ...p({ id: 'oth', name: 'Other', starts_on: '2026-10-20' }), member_id: 'b', club_number: '30935' },
  ]
  const s = summarizeClient(client, { sessions, programs }, today)
  assert.equal(s.last_workout_on, '2026-10-20')
  assert.equal(s.workouts_this_week, 2)
  assert.deepEqual(s.current_program, { id: 'cur', name: 'Block 2' })
  assert.deepEqual(s.next_program, { id: 'nxt', name: 'Block 3', starts_on: '2026-11-09' })
})

test('buildActivity: programs, workouts and messages newest first', () => {
  const items = buildActivity({
    programs: [{ id: 'p1', name: 'Block 1', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-05T10:00:00Z' }],
    sessions: [
      { id: 's1', completed_at: '2026-10-03T18:00:00Z', performed_on: '2026-10-03', day_name: 'Push A', set_count: 12 },
      { id: 's2', completed_at: null, performed_on: '2026-10-04' },
    ],
    messages: [{ sender: 'member', body: 'Knee felt sore', created_at: '2026-10-04T08:00:00Z' }],
  })
  assert.deepEqual(items.map(i => i.kind), ['program_updated', 'message', 'workout_completed', 'program_assigned'])
  assert.equal(items[2].text, 'Completed Push A (12 sets)')
  assert.equal(items[1].text, 'Messaged: Knee felt sore')
})

test('buildActivity: an untouched program is only "assigned"', () => {
  const items = buildActivity({ programs: [{ id: 'p1', name: 'B', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:30Z' }] })
  assert.deepEqual(items.map(i => i.kind), ['program_assigned'])
})

test('epley: one rep is the weight, otherwise w * (1 + r/30)', () => {
  assert.equal(epley(100, 1), 100)
  assert.equal(epley(100, 10), 133.3)
  assert.equal(epley(null, 5), null)
  assert.equal(epley(100, 0), null)
})

test('progressFor: best weight, reps at it, est. 1RM and volume per day', () => {
  const rows = [
    { performed_on: '2026-10-01', exercise_id: 'e1', exercise_name: 'Bench', weight: 100, reps: 8 },
    { performed_on: '2026-10-01', exercise_id: 'e1', exercise_name: 'Bench', weight: 110, reps: 5 },
    { performed_on: '2026-10-01', exercise_id: 'e2', exercise_name: 'Row', weight: 50, reps: 10 },
    { performed_on: '2026-10-08', exercise_id: 'e1', exercise_name: 'Bench', weight: 105, reps: 10 },
    { performed_on: '2026-10-08', exercise_id: 'e1', exercise_name: 'Bench', weight: null, reps: 10 },
  ]
  assert.deepEqual(progressFor(rows, 'e1'), [
    { performed_on: '2026-10-01', bestWeight: 110, bestReps: 5, est1rm: 128.3, volume: 1350, sets: 2 },
    { performed_on: '2026-10-08', bestWeight: 105, bestReps: 10, est1rm: 140, volume: 1050, sets: 2 },
  ])
  assert.deepEqual(loggedExercises(rows), [
    { exercise_id: 'e1', name: 'Bench', days: 2 },
    { exercise_id: 'e2', name: 'Row', days: 1 },
  ])
})

test('latestAt and pairKey', () => {
  assert.equal(latestAt([null, '2026-10-01T00:00:00Z', undefined, '2026-10-03T00:00:00Z']), '2026-10-03T00:00:00Z')
  assert.equal(latestAt([]), null)
  assert.equal(pairKey({ member_id: 'a', club_number: 30935 }), 'a|30935')
})
