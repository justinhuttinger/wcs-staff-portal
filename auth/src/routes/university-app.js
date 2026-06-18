// WCS University — trainee web app route (server-rendered, framable).
//
// Kept in its own file (not university.js) so it's independent of the API
// router. Mounted at /university/app behind UNIVERSITY_ENABLED. Identity comes
// from GHL Custom Menu Link params (?phone=&email=&name=…) — the trainee is
// matched by phone (sessions are keyed by the caller's number). URL-param
// identity is spoofable; acceptable for internal training. SSO is the future
// hardening path.

const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { getMilestoneConfig } = require('../services/university/config')
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
  const phone = normalizePhone(req.query.phone)
  const traineeId = phone || (req.query.email ? String(req.query.email) : null)
  const trainee = {
    name: req.query.name || req.query.email || 'Trainee',
    phone,
    email: req.query.email || null,
  }

  // Framable inside GHL.
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.removeHeader('X-Frame-Options')
  res.setHeader('Content-Security-Policy', 'frame-ancestors *;')

  try {
    const cfg = await getMilestoneConfig()
    const requiredKeys = (cfg.milestones || []).filter(m => m.required).map(m => m.key)

    if (!traineeId) {
      return res.send(renderAppPage({ trainee, graduation: null, milestones: [], requiredKeys, calls: [] }))
    }

    const [msRes, gradRes, sessRes, gradesRes] = await Promise.all([
      supabaseAdmin.from('trainee_milestones').select('*').eq('trainee_id', traineeId),
      supabaseAdmin.from('trainee_graduation').select('*').eq('trainee_id', traineeId).maybeSingle(),
      supabaseAdmin.from('roleplay_sessions').select('*').eq('trainee_id', traineeId).order('created_at', { ascending: false }).limit(50),
      supabaseAdmin.from('roleplay_grades').select('*').eq('trainee_id', traineeId).order('graded_at', { ascending: false }),
    ])

    const gradeBySession = {}
    for (const g of gradesRes.data || []) {
      if (!gradeBySession[g.session_id]) gradeBySession[g.session_id] = g
    }

    const calls = (sessRes.data || []).map(s => {
      const g = gradeBySession[s.id]
      return {
        id: s.id,
        scenario: s.scenario,
        call_type: s.call_type,
        difficulty: s.difficulty,
        status: s.status,
        created_at: s.created_at,
        transcript: s.transcript,
        overall_score: g?.overall_score ?? null,
        strengths: g?.strengths || null,
        improvements: g?.improvements || null,
      }
    })

    res.send(renderAppPage({
      trainee,
      graduation: gradRes.data || null,
      milestones: msRes.data || [],
      requiredKeys,
      calls,
    }))
  } catch (err) {
    console.error('[university/app] render failed:', err.message)
    res.status(500).send('<!DOCTYPE html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px">WCS University is temporarily unavailable. Please try again.</body>')
  }
})

module.exports = router
