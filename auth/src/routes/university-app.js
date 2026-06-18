// WCS University — trainee web app route (server-rendered, framable).
//
// Kept in its own file (not university.js) so it's independent of the API
// router. Mounted at /university/app behind UNIVERSITY_ENABLED. Identity comes
// from GHL Custom Menu Link params (?email=&name=…) — the trainee is matched by
// email (the key /calls/identify stamps; phone is a fallback). URL-param
// identity is spoofable; acceptable for internal training. SSO is the future
// hardening path. Renders the guided COURSE (stepper) + MY CALLS history.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { reconcileProgress } = require('../services/university/curriculum')
const { renderAppPage } = require('../services/university/app-page')

const router = Router()

function normalizePhone(p) {
  const d = String(p || '').replace(/\D+/g, '')
  if (!d) return null
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d[0] === '1') return `+${d}`
  return `+${d}`
}

router.get('/app', async (req, res) => {
  const email = req.query.email ? String(req.query.email).trim().toLowerCase() : null
  const phone = normalizePhone(req.query.phone)
  const traineeId = email || phone
  const trainee = { name: req.query.name || email || 'Trainee', phone, email }

  // Framable inside GHL.
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.removeHeader('X-Frame-Options')
  res.setHeader('Content-Security-Policy', 'frame-ancestors *;')

  try {
    if (!traineeId) {
      const course = await reconcileProgress('__anon__', null)
      return res.send(renderAppPage({ trainee, course, calls: [] }))
    }

    // Reconcile the course (advances graded steps from passing calls) and load
    // the call history in parallel.
    const [course, sessRes] = await Promise.all([
      reconcileProgress(traineeId, trainee.name),
      supabaseAdmin.from('roleplay_sessions').select('*').eq('trainee_id', traineeId)
        .order('created_at', { ascending: false }).limit(50),
    ])

    // Grades joined by session_id (race-proof vs. attribution re-keying).
    const sessionIds = (sessRes.data || []).map(s => s.id)
    const gradesRes = sessionIds.length
      ? await supabaseAdmin.from('roleplay_grades').select('*').in('session_id', sessionIds).order('graded_at', { ascending: false })
      : { data: [] }
    const gradeBySession = {}
    for (const g of gradesRes.data || []) {
      if (!gradeBySession[g.session_id]) gradeBySession[g.session_id] = g
    }

    const calls = (sessRes.data || []).map(s => {
      const g = gradeBySession[s.id]
      return {
        id: s.id, scenario: s.scenario, call_type: s.call_type, difficulty: s.difficulty,
        status: s.status, created_at: s.created_at, transcript: s.transcript,
        overall_score: g?.overall_score ?? null, strengths: g?.strengths || null, improvements: g?.improvements || null,
      }
    })

    res.send(renderAppPage({ trainee, course, calls }))
  } catch (err) {
    console.error('[university/app] render failed:', err.message)
    res.status(500).send('<!DOCTYPE html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">WCS University is temporarily unavailable. Please try again.</body>')
  }
})

module.exports = router
