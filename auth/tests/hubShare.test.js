const test = require('node:test')
const assert = require('node:assert/strict')
const { groupSubmissions, claudeBlock } = require('../src/services/hub/share')

const deliverables = [
  { id: 'd1', name: 'Photo of Employee', kind: 'image', slots: [
    { id: 's1', club: 'salem', person_id: 'p1', items: [{ id: 'i1', file_name: 'a.jpg', text_body: null }] },
    { id: 's2', club: 'keizer', person_id: 'p2', items: [] },
  ] },
  { id: 'd2', name: 'Why they won', kind: 'text', slots: [
    { id: 's3', club: 'salem', person_id: 'p1', items: [{ id: 'i2', file_name: null, text_body: 'Always first in.' }] },
    { id: 's4', club: 'keizer', person_id: 'p2', items: [{ id: 'i3', file_name: null, text_body: 'Fixed the sauna.' }] },
  ] },
]
const people = [{ id: 'p1', name: 'Sam Lee' }, { id: 'p2', name: 'Pat Doe' }]
const clubNames = { salem: 'Salem', keizer: 'Keizer' }

test('groupSubmissions: filled slots only, by club in task order', () => {
  const groups = groupSubmissions({ deliverables, clubNames, people, clubOrder: ['salem', 'keizer'] })
  assert.deepEqual(groups.map(g => g.clubName), ['Salem', 'Keizer'])
  assert.deepEqual(groups[0].items.map(i => i.id), ['i1', 'i2'])
  assert.deepEqual(groups[1].items.map(i => i.id), ['i3'])
  assert.equal(groups[0].items[0].isFile, true)
  assert.equal(groups[0].items[1].text, 'Always first in.')
  assert.equal(groups[0].items[0].person, 'Sam Lee')
})

test('groupSubmissions: one club only when asked', () => {
  const groups = groupSubmissions({ deliverables, clubNames, people, clubOrder: ['salem', 'keizer'], club: 'keizer' })
  assert.deepEqual(groups.map(g => g.club), ['keizer'])
})

test('claudeBlock: title, share link, club sections, file links and quoted text', () => {
  const groups = groupSubmissions({ deliverables, clubNames, people, clubOrder: ['salem', 'keizer'] })
  const text = claudeBlock({ taskTitle: 'Employee of the Month', shareUrl: 'https://x/share.html?t=T', groups, fileUrl: id => `https://api/f/${id}` })
  assert.equal(text, [
    'Employee of the Month - submissions (share page: https://x/share.html?t=T)',
    '',
    '## Salem',
    '- Photo of Employee (Sam): https://api/f/i1',
    '- Why they won (Sam): "Always first in."',
    '',
    '## Keizer',
    '- Why they won (Pat): "Fixed the sauna."',
  ].join('\n'))
})

test('claudeBlock with nothing submitted says so', () => {
  assert.match(claudeBlock({ taskTitle: 'T', shareUrl: 'u', groups: [], fileUrl: () => '' }), /Nothing submitted yet/)
})

test('groupSubmissions: club "none" means only club-less slots; mime passes through', () => {
  const dels = [{ id: 'd1', name: 'Photo', kind: 'image', slots: [
    { id: 'a', club: null, person_id: 'p1', items: [{ id: 'x1', file_name: 'old.jpg', text_body: null, mime: 'image/jpeg' }] },
    { id: 'b', club: 'salem', person_id: 'p1', items: [{ id: 'x2', file_name: 'new.heic', text_body: null, mime: 'image/heic' }] },
  ] }]
  const only = groupSubmissions({ deliverables: dels, clubNames: { salem: 'Salem' }, people, clubOrder: ['salem'], club: 'none' })
  assert.deepEqual(only.flatMap(g => g.items.map(i => i.id)), ['x1'])
  const all = groupSubmissions({ deliverables: dels, clubNames: { salem: 'Salem' }, people, clubOrder: ['salem'] })
  assert.equal(all.find(g => g.club === 'salem').items[0].mime, 'image/heic')
})
