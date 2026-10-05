// Scope rules for the GM Event Calendar (routes/eventCalendar.js). Pure, so
// they can be tested without a database.
const { CLUBS } = require('../config/clubs')

const EVENT_TYPE = 'event'
// Custom fields an event carries — keep in sync with the 'event' entry in
// portal/src/config/marketingTypes.js.
const EVENT_FIELDS = ['description']

const LOCATION_SLUGS = new Set(CLUBS.map(c => c.slug))

// Visible = touches at least one of the caller's clubs.
function inView(effort, scope) {
  if (effort.type !== EVENT_TYPE) return false
  if (scope === null) return true
  return (effort.locations || []).some(l => scope.includes(l))
}

// Editable = every club on the event is one of the caller's. A company-wide
// event Marketing put on all seven clubs is visible to a GM but not theirs to
// move or delete.
function canEdit(effort, scope) {
  if (effort.type !== EVENT_TYPE) return false
  if (scope === null) return true
  const locs = effort.locations || []
  return locs.length > 0 && locs.every(l => scope.includes(l))
}

function withEditable(effort, scope) {
  return { ...effort, editable: canEdit(effort, scope) }
}

// Whitelist + normalize an incoming event. Status and type are never taken
// from the client.
function buildEventRow(body, scope) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { error: 'Title is required' }

  if (!body.start_at) return { error: 'Start date is required' }
  const start = new Date(body.start_at)
  if (isNaN(start.getTime())) return { error: 'Invalid start date' }

  let end = null
  if (body.end_at) {
    const d = new Date(body.end_at)
    if (isNaN(d.getTime())) return { error: 'Invalid end date' }
    if (d.getTime() < start.getTime()) return { error: 'End date must be after the start date' }
    end = d.toISOString()
  }

  const locations = Array.isArray(body.locations)
    ? [...new Set(body.locations.map(s => String(s).toLowerCase()).filter(s => LOCATION_SLUGS.has(s)))]
    : []
  if (locations.length === 0) return { error: 'Pick at least one club' }
  if (scope !== null && locations.some(l => !scope.includes(l))) {
    return { error: 'You can only plan events for your own clubs', status: 403 }
  }

  const rawCustom = (body.custom && typeof body.custom === 'object' && !Array.isArray(body.custom)) ? body.custom : {}
  const custom = {}
  for (const k of EVENT_FIELDS) {
    if (typeof rawCustom[k] === 'string' && rawCustom[k].trim()) custom[k] = rawCustom[k]
  }

  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes : null

  return { row: { title, type: EVENT_TYPE, start_at: start.toISOString(), end_at: end, locations, custom, notes } }
}

module.exports = { EVENT_TYPE, LOCATION_SLUGS, inView, canEdit, withEditable, buildEventRow }
