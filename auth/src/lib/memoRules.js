// Rules for the monthly club memo (routes/memos.js). Pure, so they can be tested
// without a database.
const { randomUUID } = require('node:crypto')

const MAX_ITEMS = 40
const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000
const MAX_PLANNED_IMAGES = 12

// 'YYYY-MM' or 'YYYY-MM-DD' -> first of that month, else null.
function monthKey(value) {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(typeof value === 'string' ? value : '')
  if (!m) return null
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return `${m[1]}-${m[2]}-01`
}

function newestStarted(rows, t) {
  return (rows || [])
    .filter(r => (r.status === 'published' || r.status === 'ready') && r.starts_at && new Date(r.starts_at).getTime() <= t)
    .sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at))[0] || null
}

// The newest started memo, unless that memo has ended. Deliberately does not fall
// back to an older one: ending a memo must not resurrect last month's.
function pickLiveMemo(rows, now = new Date()) {
  const t = now.getTime()
  const newest = newestStarted(rows, t)
  if (!newest) return null
  if (newest.ends_at && new Date(newest.ends_at).getTime() <= t) return null
  return newest
}

// The month of the newest Main that has started, for noteStatus.
function newestMainMonth(editions, now = new Date()) {
  return newestStarted(editions, now.getTime())?.month || ''
}

// One note's state. A note with no end date lasts until a Main for a later month
// starts; one with an end date runs across months until then.
function noteStatus(note, month, newestMonth, now = new Date()) {
  if (!note.published || !note.starts_at) return 'draft'
  const t = now.getTime()
  if (note.ends_at && new Date(note.ends_at).getTime() <= t) return 'ended'
  if (new Date(note.starts_at).getTime() > t) return 'scheduled'
  if (!note.ends_at && (month || '') < newestMonth) return 'replaced'
  return 'live'
}

// A club's month of notes in one word, the most current note winning.
function notesSummary(row, month, newestMonth, now = new Date()) {
  const states = (row?.items || []).map(n => noteStatus(n, month, newestMonth, now))
  return ['live', 'scheduled', 'draft', 'ended', 'replaced'].find(s => states.includes(s)) || 'not_started'
}

// What a club shows at a moment: the live Main plus every one of its notes in date.
// notes = one club's rows, each holding that month's notes in items.
function composeMemo(editions, notes, now = new Date()) {
  const monthById = new Map((editions || []).map(e => [e.id, e.month]))
  const edition = pickLiveMemo(editions, now)
  const newestMonth = newestMainMonth(editions, now)
  const live = (notes || [])
    .filter(row => row.status === 'published')
    .map(row => ({ month: monthById.get(row.edition_id) || '', items: row.items || [] }))
    .sort((a, b) => b.month.localeCompare(a.month))
    .flatMap(row => row.items
      .filter(n => noteStatus(n, row.month, newestMonth, now) === 'live')
      .map(n => ({ ...n, month: row.month })))
  if (!edition && live.length === 0) return null
  return {
    key: `${edition?.id || 'none'}~${live.map(n => n.id).sort().join('.')}`,
    month: edition?.month || live[0].month,
    main_items: edition?.items || [],
    club_items: live.map(n => ({ title: n.title, description: n.description })),
    note_ids: live.map(n => n.id),
  }
}

// Everything a club will show from now on, one entry per change. The browser draws
// each ahead of time, so a date can change the iPads with nobody signed in.
function fullMemoPlan(editions, notes, now = new Date()) {
  const t = now.getTime()
  const times = new Set([t])
  const dated = [...(editions || []), ...(notes || []).flatMap(row => row.items || [])]
  for (const row of dated) {
    for (const value of [row.starts_at, row.ends_at]) {
      const time = value ? new Date(value).getTime() : 0
      if (time > t) times.add(time)
    }
  }
  const plan = new Map()
  for (const time of [...times].sort((a, b) => a - b)) {
    const memo = composeMemo(editions, notes, new Date(time))
    if (memo && !plan.has(memo.key)) plan.set(memo.key, memo)
  }
  return [...plan.values()]
}

function memoPlan(editions, notes, now = new Date()) {
  return fullMemoPlan(editions, notes, now).slice(0, MAX_PLANNED_IMAGES)
}

function clubStatus(row, liveIds, now = new Date()) {
  if (!row) return 'not_started'
  if (Array.isArray(row.items) && row.items.length === 0) return 'not_started'
  if (row.status !== 'published') return 'draft'
  const t = now.getTime()
  if (new Date(row.starts_at).getTime() > t) return 'scheduled'
  if (row.ends_at && new Date(row.ends_at).getTime() <= t) return 'ended'
  return [].concat(liveIds).includes(row.id) ? 'live' : 'replaced'
}

// Main's state in the same words as a club's notes.
function editionStatus(edition, liveId, now = new Date()) {
  if (edition.status !== 'ready') return 'draft'
  return clubStatus({ id: edition.id, status: 'published', starts_at: edition.starts_at, ends_at: edition.ends_at }, liveId, now)
}

// A missing start means "show now"; a missing end means "until the next one".
function parseDates(body, now = new Date()) {
  const start = body?.starts_at ? new Date(body.starts_at) : now
  if (isNaN(start.getTime())) return { error: 'Invalid start date' }
  let ends_at = null
  if (body?.ends_at) {
    const end = new Date(body.ends_at)
    if (isNaN(end.getTime())) return { error: 'Invalid end date' }
    if (end.getTime() <= start.getTime()) return { error: 'End date must be after the start date' }
    ends_at = end.toISOString()
  }
  return { starts_at: start.toISOString(), ends_at }
}

// scope = the caller's club slugs; null = every club.
function canEditClub(scope, slug) {
  return scope === null || (scope || []).includes(slug)
}

// Whitelist a list of { title, description }. Half-written items are kept so a
// draft can be saved; itemsError is what stops them being published.
function cleanItems(value) {
  if (!Array.isArray(value)) return []
  return value
    .map(item => ({
      title: cleanText(item?.title, TITLE_MAX),
      description: cleanText(item?.description, DESCRIPTION_MAX),
    }))
    .filter(item => item.title || item.description)
    .slice(0, MAX_ITEMS)
}

function cleanDate(value) {
  if (!value) return null
  const date = new Date(value)
  return isNaN(date.getTime()) ? undefined : date.toISOString()
}

// Whitelist a club's notes. A note keeps its id and published flag only from what's
// already saved, so neither can be made up by the browser.
function cleanNotes(value, existing) {
  const saved = new Map((existing || []).filter(n => n.id).map(n => [n.id, n]))
  const notes = []
  for (const item of (Array.isArray(value) ? value : []).slice(0, MAX_ITEMS)) {
    const title = cleanText(item?.title, TITLE_MAX)
    const description = cleanText(item?.description, DESCRIPTION_MAX)
    if (!title && !description) continue
    const before = saved.get(item?.id)
    // Clearing a published note's start keeps it up rather than pulling it.
    const starts_at = cleanDate(item?.starts_at) ?? (item?.starts_at ? undefined : (before?.published ? before.starts_at : null))
    const ends_at = cleanDate(item?.ends_at)
    if (starts_at === undefined || ends_at === undefined) return { error: `Invalid date on "${title || 'a note'}"` }
    if (starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
      return { error: `The end date must be after the start date on "${title || 'a note'}"` }
    }
    notes.push({ id: before?.id || randomUUID(), title, description, starts_at, ends_at, published: before?.published === true })
  }
  return { notes }
}

function itemsError(items) {
  if ((items || []).some(item => !item.title || !item.description)) {
    return 'Every item needs a title and a description'
  }
  return null
}

// This month in Pacific, as the first of the month.
function currentMonth(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' })
    .format(now).split('-')
  return `${y}-${m}-01`
}

// The month selector: every month already written, plus this month and the next
// three, newest first. There is always a memo for the month; nobody creates one.
function monthOptions(existingMonths, now = new Date()) {
  const [y, m] = currentMonth(now).split('-').map(Number)
  const months = new Set(existingMonths || [])
  for (let i = 0; i < 4; i++) {
    months.add(new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 10))
  }
  return [...months].sort().reverse()
}

function cleanText(value, max = DESCRIPTION_MAX) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

module.exports = {
  monthKey, pickLiveMemo, composeMemo, memoPlan, fullMemoPlan, newestMainMonth, noteStatus, notesSummary,
  clubStatus, editionStatus, parseDates, canEditClub, cleanText, cleanNotes,
  cleanItems, itemsError, monthOptions, currentMonth,
}
