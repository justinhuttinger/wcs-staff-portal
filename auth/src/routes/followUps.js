// Follow-ups: the owner's personal tracker for things he is waiting on from
// people. A project is sent as an email from his own Gmail; he nudges by hand
// (one click, Claude drafts in his voice, he edits, it sends as a reply in the
// same thread). A reply from the recipient flips the project to "replied" so he
// can review it. Nothing is sent on a timer.
//
// Owner-only: admin role AND an email on FOLLOW_UPS_EMAILS. Gmail access comes
// from his row in staff_google_tokens, connected through the dedicated consent
// flow below (Gmail send + read, plus the scopes the meeting-notes flow already
// holds so connecting here never narrows that token).
const { Router } = require('express')
const crypto = require('crypto')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { getStaffGoogleAccessToken } = require('../services/googleUserToken')
const gmail = require('../services/followUps/gmail')
const { draftEmail } = require('../services/followUps/draft')

const router = Router()

const OWNER_EMAILS = (process.env.FOLLOW_UPS_EMAILS || 'justin@wcstrength.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const GOOGLE_CLIENT_ID = process.env.GOOGLE_BUSINESS_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_BUSINESS_CLIENT_SECRET
const AUTH_API_URL = process.env.AUTH_API_URL || 'https://api.wcstrength.com'
const REDIRECT_URI = `${AUTH_API_URL}/follow-ups/callback`

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  // Kept so this token still serves Sheets export and meeting notes.
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
].join(' ')

const STATUSES = ['active', 'replied', 'done', 'cancelled']
const EMAIL_RE = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function requireOwner(req, res, next) {
  if (!OWNER_EMAILS.includes(String(req.staff?.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not available' })
  }
  next()
}

// Auth is per-route: /callback is Google's redirect and carries no bearer token.
const owner = [authenticate, requireRole('admin'), requireOwner]

function sendError(res, e) {
  if (e.notConnected) return res.status(412).json({ error: 'Connect Gmail first', code: 'gmail_not_connected' })
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

function ownerName(staff) {
  return staff?.first_name || String(staff?.display_name || '').split(' ')[0] || 'Justin'
}

// ---------- OAuth ----------

const STATE_TTL_MS = 10 * 60 * 1000
const stateMap = new Map()
function setState(staffId) {
  const state = crypto.randomBytes(24).toString('base64url')
  stateMap.set(state, { staffId, expires: Date.now() + STATE_TTL_MS })
  for (const [k, v] of stateMap) if (v.expires < Date.now()) stateMap.delete(k)
  return state
}
function consumeState(state) {
  const e = stateMap.get(state)
  if (!e) return null
  stateMap.delete(state)
  return e.expires < Date.now() ? null : e
}

router.get('/status', owner, async (req, res) => {
  try {
    const { data: tok } = await supabaseAdmin
      .from('staff_google_tokens').select('email, scope').eq('staff_id', req.staff.id).maybeSingle()
    const scope = tok?.scope || ''
    const ready = !!tok && scope.includes('gmail.send') && scope.includes('gmail.readonly')
    res.json({ connected: !!tok, ready, email: tok?.email || null, aiReady: !!process.env.ANTHROPIC_API_KEY })
  } catch (e) { sendError(res, e) }
})

router.post('/authorize-url', owner, (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google OAuth not configured' })
  const state = setState(req.staff.id)
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code',
    scope: SCOPES, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    login_hint: req.staff.email,
  })
  res.json({ url })
})

router.get('/callback', async (req, res) => {
  const closeHtml = (msg, ok = true) => `<!DOCTYPE html><html><head><meta charset="utf-8">`
    + `<title>Follow-ups ${ok ? 'Connected' : 'Error'}</title></head><body style="font:14px system-ui;padding:32px;text-align:center">`
    + `<h1 style="color:${ok ? '#2e7d32' : '#c62828'}">${ok ? 'Gmail connected ✓' : 'Connection failed'}</h1><p>${String(msg).replace(/</g, '&lt;')}</p>`
    + `<script>try{window.opener&&window.opener.postMessage({type:'follow-ups-auth',ok:${ok}},'*')}catch(e){}setTimeout(()=>window.close(),${ok ? 1500 : 4000})</script></body></html>`
  const { code, error, state } = req.query
  if (error) return res.status(400).send(closeHtml('Authorization denied: ' + error, false))
  if (!code || !state) return res.status(400).send(closeHtml('Missing code or state', false))
  const entry = consumeState(String(state))
  if (!entry) return res.status(400).send(closeHtml('Invalid or expired state. Retry from the portal.', false))
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(code), client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
    })
    const tokens = await tokenRes.json()
    if (tokens.error || !tokens.refresh_token) {
      throw new Error(tokens.error_description || tokens.error || 'No refresh token returned. Try connecting again.')
    }
    const scope = tokens.scope || ''
    if (!scope.includes('gmail.send') || !scope.includes('gmail.readonly')) {
      throw new Error('Gmail access was not granted. Tick both Gmail boxes on the Google screen.')
    }
    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    })
    const info = infoRes.ok ? await infoRes.json().catch(() => ({})) : {}
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
    const { error: upErr } = await supabaseAdmin.from('staff_google_tokens').upsert({
      staff_id: entry.staffId, email: info.email || '', access_token: tokens.access_token,
      refresh_token: tokens.refresh_token, expires_at: expiresAt, scope,
    }, { onConflict: 'staff_id' })
    if (upErr) throw upErr
    res.send(closeHtml(`Signed in as ${info.email || 'your Google account'}.`, true))
  } catch (e) { res.status(500).send(closeHtml(e.message || 'Token exchange failed', false)) }
})

// ---------- projects ----------

async function loadProject(req, id) {
  const { data, error } = await supabaseAdmin
    .from('follow_up_projects').select('*').eq('id', id).eq('owner_staff_id', req.staff.id).maybeSingle()
  if (error) throw error
  if (!data) { const e = new Error('Not found'); e.status = 404; throw e }
  return data
}

async function loadHistory(projectId) {
  const { data, error } = await supabaseAdmin
    .from('follow_up_messages').select('kind, subject, body, sent_at')
    .eq('project_id', projectId).order('sent_at', { ascending: true })
  if (error) throw error
  return data || []
}

router.get('/projects', owner, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('follow_up_projects').select('*').eq('owner_staff_id', req.staff.id)
      .order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    res.json({ projects: data || [] })
  } catch (e) { sendError(res, e) }
})

router.get('/projects/:id/messages', owner, async (req, res) => {
  try {
    await loadProject(req, req.params.id)
    res.json({ messages: await loadHistory(req.params.id) })
  } catch (e) { sendError(res, e) }
})

// Reads each waiting thread and flips it to "replied" when the recipient has
// written since the last reply we saw. Run when the screen opens.
router.post('/check-replies', owner, async (req, res) => {
  try {
    const { data: projects, error } = await supabaseAdmin
      .from('follow_up_projects').select('*').eq('owner_staff_id', req.staff.id)
      .eq('status', 'active').not('gmail_thread_id', 'is', null)
    if (error) throw error
    if (!projects?.length) return res.json({ updated: [] })
    const { accessToken, email } = await getStaffGoogleAccessToken(req.staff.id)
    const ownerEmail = email || req.staff.email
    const updated = []
    let next = 0
    const worker = async () => {
      while (next < projects.length) {
        const p = projects[next++]
        try {
          const reply = gmail.latestReply(await gmail.getThread(accessToken, p.gmail_thread_id), ownerEmail)
          const seen = p.last_reply_at ? new Date(p.last_reply_at).getTime() : 0
          if (reply && reply.at > seen) {
            const patch = {
              status: 'replied', last_reply_at: new Date(reply.at).toISOString(),
              last_reply_snippet: reply.snippet.slice(0, 500), updated_at: new Date().toISOString(),
            }
            const { data: row } = await supabaseAdmin.from('follow_up_projects')
              .update(patch).eq('id', p.id).select('*').single()
            if (row) updated.push(row)
          }
        } catch (e) {
          if (e.notConnected) throw e
          console.warn('[FollowUps] thread check failed', p.id, e.message)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, projects.length) }, worker))
    res.json({ updated })
  } catch (e) { sendError(res, e) }
})

function cleanFields(body) {
  const out = {
    recipient_name: String(body.recipient_name || '').trim().slice(0, 120),
    recipient_email: String(body.recipient_email || '').trim().toLowerCase().slice(0, 200),
    title: String(body.title || '').trim().slice(0, 300),
    details: String(body.details || '').trim().slice(0, 4000) || null,
    due_date: body.due_date && DATE_RE.test(String(body.due_date)) ? String(body.due_date) : null,
  }
  if (!out.recipient_name) return { error: 'Name is required' }
  if (!EMAIL_RE.test(out.recipient_email)) return { error: 'A valid email is required' }
  if (!out.title) return { error: 'Say what you need from them' }
  return { fields: out }
}

// Draft only. kind=initial takes the form fields; kind=nudge takes projectId.
router.post('/draft', owner, async (req, res) => {
  try {
    const body = req.body || {}
    const kind = body.kind === 'nudge' ? 'nudge' : 'initial'
    let project
    let history = []
    if (kind === 'nudge') {
      project = await loadProject(req, body.projectId)
      history = await loadHistory(project.id)
    } else {
      const { fields, error } = cleanFields(body)
      if (error) return res.status(400).json({ error })
      project = fields
    }
    project = { ...project, instructions: String(body.instructions || '').trim().slice(0, 1000) || null }
    const { accessToken } = await getStaffGoogleAccessToken(req.staff.id)
    let samples = []
    try { samples = await gmail.recentSentSamples(accessToken, req.staff.id) } catch (e) {
      if (e.notConnected) throw e
      console.warn('[FollowUps] voice samples unavailable:', e.message)
    }
    const draft = await draftEmail({ kind, project, history, ownerName: ownerName(req.staff), samples })
    if (kind === 'nudge') draft.subject = gmail.replySubject(project.subject)
    res.json(draft)
  } catch (e) { sendError(res, e) }
})

// Creates the project and sends the first email.
router.post('/projects', owner, async (req, res) => {
  try {
    const body = req.body || {}
    const { fields, error } = cleanFields(body)
    if (error) return res.status(400).json({ error })
    const subject = String(body.subject || '').trim().slice(0, 250)
    const text = String(body.body || '').trim()
    if (!subject || !text) return res.status(400).json({ error: 'Subject and message are required' })

    const { accessToken } = await getStaffGoogleAccessToken(req.staff.id)
    const sent = await gmail.sendEmail(accessToken, {
      toName: fields.recipient_name, toEmail: fields.recipient_email, subject, body: text,
    })
    const now = new Date().toISOString()
    const { data: project, error: insErr } = await supabaseAdmin.from('follow_up_projects').insert({
      ...fields, owner_staff_id: req.staff.id, subject, status: 'active',
      gmail_thread_id: sent.threadId, first_message_id_header: sent.messageIdHeader || null,
      last_sent_at: now,
    }).select('*').single()
    if (insErr) throw insErr
    await supabaseAdmin.from('follow_up_messages').insert({
      project_id: project.id, kind: 'initial', subject, body: text, gmail_message_id: sent.id, sent_at: now,
    })
    res.json({ project })
  } catch (e) { sendError(res, e) }
})

// Sends a nudge as a reply in the project's thread.
router.post('/projects/:id/nudge', owner, async (req, res) => {
  try {
    const project = await loadProject(req, req.params.id)
    if (['done', 'cancelled'].includes(project.status)) {
      return res.status(400).json({ error: 'This follow-up is closed' })
    }
    const text = String(req.body?.body || '').trim()
    if (!text) return res.status(400).json({ error: 'Message is required' })
    const subject = gmail.replySubject(project.subject)
    const { accessToken } = await getStaffGoogleAccessToken(req.staff.id)
    const sent = await gmail.sendEmail(accessToken, {
      toName: project.recipient_name, toEmail: project.recipient_email, subject, body: text,
      threadId: project.gmail_thread_id, inReplyTo: project.first_message_id_header,
    })
    const now = new Date().toISOString()
    await supabaseAdmin.from('follow_up_messages').insert({
      project_id: project.id, kind: 'nudge', subject, body: text, gmail_message_id: sent.id, sent_at: now,
    })
    const { data: row, error } = await supabaseAdmin.from('follow_up_projects').update({
      status: 'active', last_sent_at: now, nudge_count: (project.nudge_count || 0) + 1, updated_at: now,
    }).eq('id', project.id).select('*').single()
    if (error) throw error
    res.json({ project: row })
  } catch (e) { sendError(res, e) }
})

// Status changes and small edits (due date, details).
router.patch('/projects/:id', owner, async (req, res) => {
  try {
    const project = await loadProject(req, req.params.id)
    const body = req.body || {}
    const patch = { updated_at: new Date().toISOString() }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Bad status' })
      patch.status = body.status
      patch.completed_at = body.status === 'done' ? patch.updated_at : null
    }
    if (body.due_date !== undefined) {
      if (body.due_date && !DATE_RE.test(String(body.due_date))) return res.status(400).json({ error: 'Bad date' })
      patch.due_date = body.due_date || null
    }
    if (body.details !== undefined) patch.details = String(body.details || '').trim().slice(0, 4000) || null
    const { data, error } = await supabaseAdmin.from('follow_up_projects')
      .update(patch).eq('id', project.id).select('*').single()
    if (error) throw error
    res.json({ project: data })
  } catch (e) { sendError(res, e) }
})

module.exports = router
