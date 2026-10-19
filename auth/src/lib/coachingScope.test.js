const test = require('node:test')
const assert = require('node:assert')
const {
  scopeFor, canAccessClient, canAddAtClub, clubsForTrainer, filterClients, isAllScope,
} = require('./coachingScope')

const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

test('corporate, director and admin see every client', () => {
  for (const role of ['corporate', 'director', 'admin']) {
    assert.deepEqual(scopeFor({ id: ME, role }, { allowedClubNumbers: ['30935'] }), { all: true })
  }
})

test('a manager is scoped to their clubs', () => {
  assert.deepEqual(
    scopeFor({ id: ME, role: 'manager' }, { allowedClubNumbers: ['30935', '31599'] }),
    { clubNumbers: ['30935', '31599'] },
  )
  // No assigned clubs is an empty list, never "all".
  assert.deepEqual(scopeFor({ id: ME, role: 'manager' }, {}), { clubNumbers: [] })
})

test('anyone below manager coaches only their own clients', () => {
  for (const role of ['personal_trainer', 'team_member', 'lead', 'custom', 'front_desk']) {
    const s = scopeFor({ id: ME, role }, { allowedClubNumbers: ['30935'] })
    assert.equal(s.coachStaffId, ME)
    assert.deepEqual(s.clubNumbers, ['30935'])
    assert.equal(isAllScope(s), false)
  }
})

test('a staff row without an id gets a scope that matches nobody', () => {
  const s = scopeFor({ role: 'lead' }, { allowedClubNumbers: ['30935'] })
  assert.equal(canAccessClient(s, { club_number: '30935', coach_staff_id: null }), false)
})

test('canAccessClient: trainer by coach, manager by club, admin always', () => {
  const trainer = scopeFor({ id: ME, role: 'lead' }, { allowedClubNumbers: ['30935'] })
  const manager = scopeFor({ id: ME, role: 'manager' }, { allowedClubNumbers: ['30935'] })
  const admin = scopeFor({ id: ME, role: 'admin' }, {})
  const mine = { member_id: 'a', club_number: '30935', coach_staff_id: ME }
  const theirs = { member_id: 'b', club_number: '30935', coach_staff_id: OTHER }
  const otherClub = { member_id: 'c', club_number: '31599', coach_staff_id: ME }

  assert.equal(canAccessClient(trainer, mine), true)
  assert.equal(canAccessClient(trainer, theirs), false)
  // A trainer's own client at another club is still theirs.
  assert.equal(canAccessClient(trainer, otherClub), true)
  assert.equal(canAccessClient(trainer, null), false)

  assert.equal(canAccessClient(manager, theirs), true)
  assert.equal(canAccessClient(manager, otherClub), false)
  assert.equal(canAccessClient(manager, { club_number: 30935 }), true)
  assert.equal(canAccessClient(manager, null), false)

  assert.equal(canAccessClient(admin, otherClub), true)
  assert.equal(canAccessClient(admin, null), false)
})

test('canAddAtClub: trainers and managers add at their clubs only', () => {
  const trainer = scopeFor({ id: ME, role: 'lead' }, { allowedClubNumbers: ['30935'] })
  const manager = scopeFor({ id: ME, role: 'manager' }, { allowedClubNumbers: ['30935'] })
  assert.equal(canAddAtClub(trainer, '30935'), true)
  assert.equal(canAddAtClub(trainer, '31599'), false)
  assert.equal(canAddAtClub(manager, '31599'), false)
  assert.equal(canAddAtClub({ all: true }, '31599'), true)
  assert.equal(canAddAtClub(manager, ''), false)
})

test('clubsForTrainer: assigned clubs win, else the clubs of their clients, else none', () => {
  assert.deepEqual(clubsForTrainer(['30935'], [{ club_number: '31599' }]), ['30935'])
  assert.deepEqual(clubsForTrainer([], [{ club_number: '31599' }, { club_number: '31599' }]), ['31599'])
  assert.deepEqual(clubsForTrainer([], []), [])
})

test('filterClients keeps only rows in scope', () => {
  const rows = [
    { member_id: 'a', club_number: '30935', coach_staff_id: ME },
    { member_id: 'b', club_number: '30935', coach_staff_id: OTHER },
    { member_id: 'c', club_number: '31599', coach_staff_id: OTHER },
  ]
  const trainer = scopeFor({ id: ME, role: 'lead' }, { allowedClubNumbers: ['30935'] })
  const manager = scopeFor({ id: ME, role: 'manager' }, { allowedClubNumbers: ['30935'] })
  assert.deepEqual(filterClients(trainer, rows).map(r => r.member_id), ['a'])
  assert.deepEqual(filterClients(manager, rows).map(r => r.member_id), ['a', 'b'])
  assert.deepEqual(filterClients({ all: true }, rows).map(r => r.member_id), ['a', 'b', 'c'])
})
