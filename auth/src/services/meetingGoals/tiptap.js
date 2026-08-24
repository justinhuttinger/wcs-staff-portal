// auth/src/services/meetingGoals/tiptap.js
// Render goal entries into the TipTap doc stored on the club's article.
//
// The doc is rebuilt whole from Supabase every publish — nothing is parsed back
// out of the article, so this format is free to change without a migration.
'use strict'

const crypto = require('crypto')
const { WEEKS_KEPT } = require('./config')

// --- TipTap node helpers (same shapes as kpiDigest/tiptap.js) ---
const p = (...content) => ({ type: 'paragraph', content })
const t = (text) => ({ type: 'text', text })
const b = (text) => ({ type: 'text', text, marks: [{ type: 'bold' }] })
const i = (text) => ({ type: 'text', text, marks: [{ type: 'italic' }] })
const ul = (items) => ({
  type: 'bulletList',
  content: items.map((c) => ({ type: 'listItem', content: [c] })),
})
const hr = { type: 'horizontalRule' }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December']

// "Monday, August 24" from a YYYY-MM-DD. Built from the string parts rather
// than a Date so there is no timezone to get wrong.
function longDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dow]
  return `${day}, ${MONTHS[m - 1]} ${d}`
}

// Entries newest-first, trimmed to WEEKS_KEPT. Entries with no action plans are
// omitted entirely rather than rendered as an empty week.
function buildGoalsDoc(entries) {
  const usable = (entries || [])
    .filter((e) => Array.isArray(e.action_plans) && e.action_plans.length > 0)
    .slice()
    .sort((a, b2) => String(b2.week_start).localeCompare(String(a.week_start)))
    .slice(0, WEEKS_KEPT)

  if (usable.length === 0) {
    return {
      type: 'doc',
      content: [p(i('No action plans recorded yet. This article is written automatically when the weekly meeting job is submitted.'))],
    }
  }

  const content = []
  usable.forEach((e, idx) => {
    if (idx > 0) content.push(hr)
    content.push(p(b(`Week of ${longDate(e.week_start)}`)))
    if (e.submitted_by) content.push(p(i(`Submitted by ${e.submitted_by}`)))
    content.push(ul(e.action_plans.map((text) => p(t(text)))))
  })
  return { type: 'doc', content }
}

// Stable fingerprint of a rendered doc, so an unchanged article is not
// rewritten every run.
function hashDoc(doc) {
  return crypto.createHash('sha256').update(JSON.stringify(doc)).digest('hex')
}

module.exports = { buildGoalsDoc, hashDoc, longDate }
