// auth/src/services/meetingNotes/clickup.js
// Minimal ClickUp v3 Docs client for the meeting-notes job. The notetaker
// writes each meeting as a Doc named "<Meeting> - MM/DD/YYYY"; we list docs,
// fetch a doc's single page content (markdown), and expose lookups the job
// uses. Auth is the same CLICKUP_API_KEY the tickets route already uses.
'use strict'

const { parseDocName } = require('./parse')

const API = 'https://api.clickup.com/api'
const KEY = process.env.CLICKUP_API_KEY
const WORKSPACE_ID = process.env.CLICKUP_WORKSPACE_ID || '9011189579' // West Coast Strength

function assertKey() {
  if (!KEY) throw new Error('CLICKUP_API_KEY not configured')
}

async function cuFetch(url) {
  assertKey()
  const res = await fetch(url, { headers: { Authorization: KEY }, signal: AbortSignal.timeout(30000) })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { _raw: text } }
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${body.err || body._raw || 'request failed'}`)
  return body
}

// All docs in the workspace (paginated), newest-ish first as ClickUp returns.
// Returns raw doc objects with at least { id, name }.
async function listDocs({ maxPages = 12, pageSize = 50 } = {}) {
  const out = []
  let cursor = null
  for (let i = 0; i < maxPages; i++) {
    const qs = new URLSearchParams({ limit: String(pageSize) })
    if (cursor) qs.set('next_cursor', cursor)
    const body = await cuFetch(`${API}/v3/workspaces/${WORKSPACE_ID}/docs?${qs.toString()}`)
    const docs = body.docs || []
    out.push(...docs)
    cursor = body.next_cursor
    if (!cursor || docs.length === 0) break
  }
  return out
}

// The markdown content of a doc's first (usually only) page.
async function getDocContent(docId) {
  const body = await cuFetch(`${API}/v3/workspaces/${WORKSPACE_ID}/docs/${docId}/pages`)
  const pages = Array.isArray(body) ? body : (body.pages || [])
  if (!pages.length) return ''
  // Notetaker docs are single-page; if multiple, concatenate in order.
  return pages.map((p) => p.content || '').join('\n\n').trim()
}

// Dated meeting docs only, annotated with parsed { meeting, date }, newest first.
async function listMeetingDocs(opts) {
  const docs = await listDocs(opts)
  return docs
    .map((d) => {
      const parsed = parseDocName(d.name)
      return parsed ? { id: d.id, name: d.name, meeting: parsed.meeting, date: parsed.date } : null
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date))
}

module.exports = { listDocs, getDocContent, listMeetingDocs, WORKSPACE_ID }
