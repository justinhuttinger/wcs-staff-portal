const { Router } = require('express')
const multer = require('multer')
const authenticate = require('../middleware/auth')
const { requireRole, requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')
const { classifyJobEmail, persistJobEmail } = require('../lib/operandioJobs')
const { classifyTillCount } = require('../lib/tillCountParse')
const { parseQaItems } = require('../lib/operandioEmailAudit')
const { resolveScopedSlugs } = require('../services/locationScope')
const { SLUG_CLUB_MAP } = require('../utils/locationSlug')
const { maybeEnqueueTillReceipt } = require('../services/printing/tillReceipt')
const { loadReconciliation } = require('../services/printing/loadReconciliation')

const router = Router()
// In-memory upload: SendGrid Inbound Parse posts email attachments as
// multipart file parts (attachment1..N). upload.none() used to 500 on any
// email with an attachment, losing it entirely — Operandio QA submissions
// carry their score report as a PDF attachment.
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024, files: 10 } })

const ATTACHMENT_BUCKET = 'operandio-attachments'

const WEBHOOK_SECRET = process.env.OPERANDIO_WEBHOOK_SECRET

// WCS gym slugs we care about. Anything else is ignored so the parser
// doesn't choke if Operandio adds a location later.
const KNOWN_LOCATIONS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

// Handles both:
// - "Weekly Activity for West Coast Strength: April 21st, 2026 to April 27th, 2026 at all locations"
// - "Daily Activity for West Coast Strength: April 27th, 2026 at all locations"
function parsePeriodFromSubject(subject) {
  if (!subject) return null

  // Strip "st", "nd", "rd", "th" suffixes that JS Date can't parse
  const clean = (s) => s.replace(/(\d+)(st|nd|rd|th)/i, '$1').trim()
  const iso = (d) => d.toISOString().slice(0, 10)

  // Try range form first
  const range = subject.match(/:\s*([A-Za-z]+ \d+\w*,?\s*\d{4})\s+to\s+([A-Za-z]+ \d+\w*,?\s*\d{4})/)
  if (range) {
    const start = new Date(clean(range[1]))
    const end = new Date(clean(range[2]))
    if (!isNaN(start) && !isNaN(end)) return { start: iso(start), end: iso(end) }
  }

  // Single date (daily report)
  const single = subject.match(/:\s*([A-Za-z]+ \d+\w*,?\s*\d{4})/)
  if (single) {
    const d = new Date(clean(single[1]))
    if (!isNaN(d)) return { start: iso(d), end: iso(d) }
  }

  return null
}

// Extract the Locations section from the plain-text body and return rows.
function parseLocationsSection(text) {
  if (!text) return []
  // Find "## Locations" and stop at the next "## " header
  const startIdx = text.search(/^##\s+Locations\b/m)
  if (startIdx === -1) return []
  const rest = text.slice(startIdx)
  const nextSection = rest.slice(2).search(/^##\s+/m)
  const slice = nextSection === -1 ? rest : rest.slice(0, nextSection + 2)

  const rows = []
  // Each block: "#### <Name> - Overall <pct>%"  ...  "On-time <pct>%"  "Late ..."  "Skipped ..."  "Uncompleted ..."
  const re = /^####\s+(.+?)\s+-\s+Overall\s+(\d+)%[\s\S]*?On-time\s+(\d+)%[\s\S]*?Late\s+(\d+)%[\s\S]*?Skipped\s+(\d+)%[\s\S]*?Uncompleted\s+(\d+)%/gm
  let m
  while ((m = re.exec(slice)) !== null) {
    const name = m[1].trim()
    const slug = name.toLowerCase()
    if (!KNOWN_LOCATIONS.includes(slug)) continue
    rows.push({
      location_slug: slug,
      overall_pct: parseInt(m[2], 10),
      on_time_pct: parseInt(m[3], 10),
      late_pct: parseInt(m[4], 10),
      skipped_pct: parseInt(m[5], 10),
      uncompleted_pct: parseInt(m[6], 10),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Operandio audits (QA-Cleaning + the other monthly department audits)
// Subject: "QA-Cleaning (Jun 5) submitted at Salem"
// Body (text part) carries: "Overall score 370 215 58%"
// and a click-tracking link to the full report in the Operandio app.
// Any "<job> submitted at <club>" email whose body has an Overall score is an
// audit; scoreless submission emails (daily checklists) fall through to the
// raw capture like before.
// ---------------------------------------------------------------------------

function parseAuditSubject(subject) {
  const m = (subject || '').match(/^(.+?)\s+submitted at\s+(.+)$/i)
  if (!m) return null
  const slug = m[2].trim().toLowerCase()
  if (!KNOWN_LOCATIONS.includes(slug)) return null
  const jobName = m[1].trim()
  // Department = job name minus the date parenthetical: "QA-Cleaning (Jun 5)"
  // -> "QA-Cleaning". One audit per club per department per month.
  const department = jobName.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  return { jobName, department, locationSlug: slug }
}

function parseQaScore(text) {
  const m = (text || '').match(/Overall score\s+(\d+)\s+(\d+)\s+(\d+)%/i)
  if (!m) return null
  return {
    possible: parseInt(m[1], 10),
    achieved: parseInt(m[2], 10),
    pct: parseInt(m[3], 10),
  }
}

// Per-item breakdown (incl. auditor notes) is parsed by ../lib/operandioEmailAudit.

// The email wraps every URL in a link.app.operandio.com click tracker that may
// expire — resolve it to the real app.operandio.com job URL at ingest time.
async function resolveReportUrl(text) {
  const m = (text || '').match(/Download the full report\s*\(\s*(https?:\/\/\S+)\s*\)/i)
    || (text || '').match(/View job\s*\(\s*(https?:\/\/\S+)\s*\)/i)
  if (!m) return null
  let url = m[1]
  try {
    for (let hop = 0; hop < 5; hop++) {
      const resp = await fetch(url, { method: 'GET', redirect: 'manual' })
      const loc = resp.headers.get('location')
      if (resp.status >= 300 && resp.status < 400 && loc) {
        url = new URL(loc, url).toString()
        continue
      }
      break
    }
  } catch (err) {
    console.warn('[Operandio] QA report URL resolve failed, keeping tracking link:', err.message)
  }
  return url
}

// Today's date in Pacific time (the clubs' local day, consistent with the
// rest of the app's date handling).
function pacificToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// Upload email attachments (req.files from multer) to the private
// operandio-attachments bucket. Returns metadata rows for the
// operandio_raw_emails.attachments jsonb column. Best-effort per file: one
// failed upload records the error but doesn't block the others.
async function storeAttachments(files) {
  const out = []
  for (const f of files || []) {
    const safeName = (f.originalname || 'attachment').replace(/[^\w.\-]+/g, '_')
    const path = `raw/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`
    try {
      const { error } = await supabaseAdmin.storage
        .from(ATTACHMENT_BUCKET)
        .upload(path, f.buffer, { contentType: f.mimetype || 'application/octet-stream', upsert: false })
      if (error) throw error
      out.push({ filename: f.originalname, content_type: f.mimetype, size: f.size, storage_path: path })
    } catch (err) {
      console.error('[Operandio] Attachment upload failed:', f.originalname, '-', err.message)
      out.push({ filename: f.originalname, content_type: f.mimetype, size: f.size, error: err.message })
    }
  }
  return out
}

// Stash an email the summary parser couldn't handle into the staging table
// (operandio_raw_emails) so per-submission / overdue trigger emails accumulate
// as real samples for future parsers. Both body parts are kept: submission
// emails carry the per-task table (who completed what, when) ONLY in the HTML
// part. Best-effort: a failed insert must never break the webhook's 200
// response (SendGrid retries for 24h).
async function captureRawEmail({ subject, text, html, from, reason, attachments }) {
  try {
    const { data, error } = await supabaseAdmin.from('operandio_raw_emails').insert({
      subject: subject || null,
      from_email: from || null,
      body_text: (text || '').slice(0, 100 * 1024),  // cap at 100KB
      body_html: (html || '').slice(0, 500 * 1024),  // cap at 500KB
      reason,
      attachments: attachments && attachments.length ? attachments : null,
    }).select('id').single()
    if (error) throw error
    console.log('[Operandio] Captured email:', reason, '-', subject)
    return data?.id || null
  } catch (err) {
    console.error('[Operandio] Raw email capture failed:', err.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// POST /operandio/webhook — SendGrid Inbound Parse target
// ---------------------------------------------------------------------------
router.post('/webhook', upload.any(), async (req, res) => {
  // Auth via shared secret query param. SendGrid sends multipart, no headers
  // we can use for HMAC.
  if (!WEBHOOK_SECRET || req.query.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  const subject = req.body?.subject || ''
  const text = req.body?.text || ''
  const html = req.body?.html || ''
  const from = req.body?.from || ''

  // Till drawer counts ("Drawer Open/Close Count submitted at <Loc>"). These are
  // denomination-breakdown submissions; we sum count*denomination into till_counts
  // for the reconciliation report. Detected before the generic job parse so a
  // drawer count does not also land as a generic checklist. The raw email is
  // retained (reason 'till_count') as a real sample for verification.
  //
  // Checked BEFORE the audit branch: a drawer count is identified by its job name
  // plus parsable denomination rows, which the audit branch cannot see. When a
  // scored step was added to the Drawer Close Count job in Operandio (Jul 2026),
  // its emails started carrying a real "Overall score 1 1 100%" and the audit
  // branch swallowed every close count. Job scoring must not decide where a
  // drawer count lands.
  const till = classifyTillCount({ subject, html, receivedAt: new Date().toISOString() })
  if (till) {
    const clubNumber = SLUG_CLUB_MAP[till.location_slug]
    const attachments = await storeAttachments(req.files)
    const rawId = await captureRawEmail({ subject, text, html, from, reason: 'till_count', attachments })
    if (!clubNumber) {
      // Retain the raw email (above) for debugging the unmapped slug; we
      // intentionally do NOT write a till_counts row we can't key to a club.
      console.warn('[Operandio] Till count for unmapped location:', till.location_slug)
      return res.status(200).json({ ignored: true, reason: 'Till count location not mapped to a club' })
    }
    const { error: tcErr } = await supabaseAdmin.from('till_counts').upsert({
      club_number: clubNumber,
      location_slug: till.location_slug,
      business_date: till.business_date,
      count_type: till.count_type,
      counted_amount: till.counted_amount,
      denominations: till.denominations,
      employee_name: till.employee_name,
      counted_at: till.counted_at,
      raw_email_id: rawId,
    }, { onConflict: 'club_number,business_date,count_type' })
    if (tcErr) {
      console.error('[Operandio] till_counts upsert failed:', tcErr.message)
      return res.status(500).json({ error: 'till_counts upsert failed' })
    }
    console.log('[Operandio] Till count stored:', till.location_slug, till.count_type, '$' + till.counted_amount)
    // Fire-and-forget till-close auto-print on a CLOSE count. The close row was
    // just upserted above, so loadReconciliation can read it. Must never break
    // ingestion (best-effort, swallows its own errors).
    if (till.count_type === 'close') {
      maybeEnqueueTillReceipt({
        supabase: supabaseAdmin,
        locationSlug: till.location_slug,
        businessDate: till.business_date,
        loadReconciliation,
      }).then(r => {
        if (r.enqueued) console.log('[print] till receipt queued', r.jobId)
        else if (r.reason && r.reason !== 'no_automation') console.log('[print] till receipt skipped:', r.reason)
      }).catch(e => console.error('[print] enqueue error:', e.message))
    }
    return res.json({ tillCount: true, location: till.location_slug, count_type: till.count_type, counted_amount: till.counted_amount })
  }

  // Audit submission (QA-Cleaning, department audits, ...) — parsed into
  // operandio_qa_reports for the KPI report + Audits report. Only emails with
  // a scored "Overall score" are audits; daily-checklist submission emails
  // have no score and fall through to the raw capture.
  const audit = parseAuditSubject(subject)
  const auditScore = audit ? parseQaScore(text) : null
  if (audit && auditScore) {
    const items = parseQaItems(html)
    const reportUrl = await resolveReportUrl(text)
    const attachments = await storeAttachments(req.files)
    const rawId = await captureRawEmail({ subject, text, html, from, reason: 'audit', attachments })
    const { error: qaErr } = await supabaseAdmin
      .from('operandio_qa_reports')
      .upsert({
        location_slug: audit.locationSlug,
        job_name: audit.jobName,
        department: audit.department,
        score_possible: auditScore.possible,
        score_achieved: auditScore.achieved,
        score_pct: auditScore.pct,
        report_url: reportUrl,
        items,
        raw_email_id: rawId,
        submitted_date: pacificToday(),
      }, { onConflict: 'location_slug,job_name,submitted_date', ignoreDuplicates: true })
    if (qaErr) {
      console.error('[Operandio] Audit upsert failed:', qaErr.message)
      return res.status(500).json({ error: 'Audit upsert failed' })
    }
    console.log('[Operandio] Audit stored:', audit.locationSlug, '-', audit.jobName, '-', `${auditScore.pct}%`)
    return res.json({ audit: true, location: audit.locationSlug, department: audit.department, score_pct: auditScore.pct })
  }

  // Per-job submission / overdue events (Phase 2). A checklist submission
  // ("<Job> submitted at <Loc>") or an overdue notice ("Overdue: <Job> at
  // <Loc>") is parsed into operandio_job_events (+ per-task completions for
  // submissions). These used to fall through to the raw-email staging table.
  const jobEmail = classifyJobEmail({ subject, text, html, receivedAt: new Date().toISOString() })
  if (jobEmail) {
    try {
      await persistJobEmail(supabaseAdmin, jobEmail, null)
      console.log('[Operandio] Job event stored:', jobEmail.kind, '-', jobEmail.event.location_slug, '-', jobEmail.event.job_name)
      return res.json({ jobEvent: true, kind: jobEmail.kind, location: jobEmail.event.location_slug, job: jobEmail.event.job_name })
    } catch (err) {
      console.error('[Operandio] Job event store failed:', err.message)
      // Don't lose the email — stash it raw so it can be reprocessed.
      const attachments = await storeAttachments(req.files)
      await captureRawEmail({ subject, text, html, from, reason: 'job_event_error', attachments })
      return res.status(200).json({ ignored: true, reason: 'Job event store failed; captured raw' })
    }
  }

  const period = parsePeriodFromSubject(subject)
  if (!period) {
    console.warn('[Operandio] Subject did not match expected pattern:', subject)
    const attachments = await storeAttachments(req.files)
    await captureRawEmail({ subject, text, html, from, reason: 'subject_unrecognized', attachments })
    return res.status(200).json({ ignored: true, reason: 'Subject not recognized' })
  }

  const rows = parseLocationsSection(text)
  if (!rows.length) {
    console.warn('[Operandio] No location rows parsed for', subject)
    const attachments = await storeAttachments(req.files)
    await captureRawEmail({ subject, text, html, from, reason: 'no_location_rows', attachments })
    return res.status(200).json({ ignored: true, reason: 'No location rows parsed' })
  }

  const upserts = rows.map(r => ({
    period_start: period.start,
    period_end: period.end,
    raw_subject: subject,
    ...r,
  }))

  const { error } = await supabaseAdmin
    .from('operandio_location_reports')
    .upsert(upserts, { onConflict: 'period_start,period_end,location_slug' })

  if (error) {
    console.error('[Operandio] Upsert failed:', error.message)
    return res.status(500).json({ error: 'Database upsert failed' })
  }

  console.log('[Operandio] Stored', rows.length, 'rows for', period.start, '→', period.end)
  res.json({ stored: rows.length, period })
})

// ---------------------------------------------------------------------------
// GET /operandio/range — all rows in the given date range
// Query: start_date, end_date (YYYY-MM-DD), optional location_slug
// Returns: { rows: [{period_start, period_end, location_slug, ...pcts}] }
// Daily rows have period_start = period_end. Weekly rows span 7 days.
// ---------------------------------------------------------------------------
router.get('/range', authenticate, requireReportAccess('manager', ['compliance']), async (req, res) => {
  try {
    const { start_date, end_date, location_slug } = req.query
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' })

    let q = supabaseAdmin
      .from('operandio_location_reports')
      .select('period_start, period_end, location_slug, overall_pct, on_time_pct, late_pct, skipped_pct, uncompleted_pct')
      .gte('period_start', start_date)
      .lte('period_end', end_date)
      .order('period_start', { ascending: true })

    // Lock lead/manager to their assigned clubs (corp/admin see all).
    const scoped = await resolveScopedSlugs(req)
    if (scoped.slugs) {
      if (scoped.slugs.length === 1) q = q.eq('location_slug', scoped.slugs[0])
      else q = q.in('location_slug', scoped.slugs)
    }

    const { data, error } = await q
    if (error) throw error
    res.json({ rows: data || [] })
  } catch (err) {
    console.error('[Operandio] /range error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /operandio/qa-reports — QA-Cleaning audit submissions in a date range
// Query: start_date, end_date (YYYY-MM-DD), optional location_slug (comma ok)
// Returns: { rows: [{location_slug, job_name, score_*, report_url, submitted_date}] }
// ---------------------------------------------------------------------------
router.get('/qa-reports', authenticate, requireReportAccess('manager', ['kpis', 'audits']), async (req, res) => {
  try {
    const { start_date, end_date, location_slug, department } = req.query

    let q = supabaseAdmin
      .from('operandio_qa_reports')
      .select('id, location_slug, job_name, department, score_possible, score_achieved, score_pct, report_url, submitted_date, submitted_at')
      .order('submitted_date', { ascending: false })
    if (start_date) q = q.gte('submitted_date', start_date)
    if (end_date) q = q.lte('submitted_date', end_date)
    if (department) q = q.eq('department', department)
    // Lock lead/manager to their assigned clubs (corp/admin see all).
    const scoped = await resolveScopedSlugs(req)
    if (scoped.slugs) {
      if (scoped.slugs.length === 1) q = q.eq('location_slug', scoped.slugs[0])
      else q = q.in('location_slug', scoped.slugs)
    }

    const { data, error } = await q
    if (error) throw error
    res.json({ rows: data || [] })
  } catch (err) {
    console.error('[Operandio] /qa-reports error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /operandio/qa-reports/:id — single audit with its per-item breakdown,
// used by the portal's in-house HTML report viewer.
// ---------------------------------------------------------------------------
router.get('/qa-reports/:id', authenticate, requireReportAccess('manager', ['kpis', 'audits']), async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('operandio_qa_reports')
      .select('id, location_slug, job_name, department, score_possible, score_achieved, score_pct, report_url, items, submitted_date, submitted_at')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Report not found' })
    res.json(data)
  } catch (err) {
    console.error('[Operandio] /qa-reports/:id error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /operandio/jobs — per-job submission/overdue compliance for a date range
// Query: start_date, end_date (YYYY-MM-DD), optional location_slug (comma ok),
//        optional job (exact job_name), optional person (completed_by)
// Returns who is doing the jobs and what is not getting done.
// ---------------------------------------------------------------------------
router.get('/jobs', authenticate, requireReportAccess('manager', ['compliance']), async (req, res) => {
  try {
    const { start_date, end_date, location_slug, job, person } = req.query
    if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' })

    const slugs = (location_slug && location_slug !== 'all')
      ? String(location_slug).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : null

    // --- Job events (submissions + overdue) ---
    let evq = supabaseAdmin
      .from('operandio_job_events')
      .select('location_slug, job_name, event_type, job_date, due_by, occurred_at, steps_completed, steps_total, percent, assigned_area, submitted_by')
      .gte('job_date', start_date)
      .lte('job_date', end_date)
      .order('job_date', { ascending: false })
    if (slugs) evq = slugs.length === 1 ? evq.eq('location_slug', slugs[0]) : evq.in('location_slug', slugs)
    if (job) evq = evq.eq('job_name', job)
    const { data: events, error: evErr } = await evq
    if (evErr) throw evErr

    // --- Task completions (who did what) ---
    let tq = supabaseAdmin
      .from('operandio_task_completions')
      .select('location_slug, job_name, job_date, step_n, task_name, completed_by, completed_at, status')
      .gte('job_date', start_date)
      .lte('job_date', end_date)
    if (slugs) tq = slugs.length === 1 ? tq.eq('location_slug', slugs[0]) : tq.in('location_slug', slugs)
    if (job) tq = tq.eq('job_name', job)
    if (person) tq = tq.eq('completed_by', person)
    const { data: tasks, error: tErr } = await tq
    if (tErr) throw tErr

    // Status per (location, job_name, job_date): submitted+overdue = late,
    // submitted only = on_time, overdue only = missed.
    const instanceKey = e => `${e.location_slug}|${e.job_name}|${e.job_date}`
    const inst = {}
    for (const e of events) {
      const k = instanceKey(e)
      if (!inst[k]) inst[k] = { location_slug: e.location_slug, job_name: e.job_name, job_date: e.job_date, submitted: null, overdue: null }
      inst[k][e.event_type === 'submitted' ? 'submitted' : 'overdue'] = e
    }
    const instances = Object.values(inst).map(i => ({
      ...i,
      status: i.submitted ? (i.overdue ? 'late' : 'on_time') : 'missed',
    }))

    // Per-job rollup (across dates in range).
    const jobMap = {}
    for (const i of instances) {
      const k = `${i.location_slug}|${i.job_name}`
      const j = jobMap[k] || (jobMap[k] = { location_slug: i.location_slug, job_name: i.job_name, on_time: 0, late: 0, missed: 0, total: 0 })
      j[i.status]++; j.total++
    }
    const jobs = Object.values(jobMap)
      .map(j => ({ ...j, submitted: j.on_time + j.late, completion_pct: j.total ? Math.round(((j.on_time + j.late) / j.total) * 100) : 0 }))
      .sort((a, b) => a.completion_pct - b.completion_pct || b.total - a.total)

    // Per-person rollup (task completions).
    const personMap = {}
    for (const t of tasks) {
      if (!t.completed_by) continue
      const k = `${t.completed_by}`
      const p = personMap[k] || (personMap[k] = { name: t.completed_by, locations: new Set(), tasks_done: 0, tasks_skipped: 0, jobs: new Set() })
      p.locations.add(t.location_slug)
      p.jobs.add(`${t.location_slug}|${t.job_name}|${t.job_date}`)
      if (t.status === 'skipped') p.tasks_skipped++
      else p.tasks_done++
    }
    const people = Object.values(personMap)
      .map(p => ({ name: p.name, locations: [...p.locations], tasks_done: p.tasks_done, tasks_skipped: p.tasks_skipped, jobs_submitted: p.jobs.size }))
      .sort((a, b) => b.tasks_done - a.tasks_done)

    // What isn't getting done: missed (overdue, never submitted) instances.
    const missed = instances
      .filter(i => i.status === 'missed')
      .map(i => ({
        location_slug: i.location_slug, job_name: i.job_name, job_date: i.job_date,
        due_by: i.overdue.due_by, steps_completed: i.overdue.steps_completed,
        steps_total: i.overdue.steps_total, percent: i.overdue.percent, assigned_area: i.overdue.assigned_area,
      }))
      .sort((a, b) => (a.job_date < b.job_date ? 1 : -1))

    const totals = {
      instances: instances.length,
      on_time: instances.filter(i => i.status === 'on_time').length,
      late: instances.filter(i => i.status === 'late').length,
      missed: missed.length,
      submitted: instances.filter(i => i.status !== 'missed').length,
      tasks_done: tasks.filter(t => t.status !== 'skipped').length,
      tasks_skipped: tasks.filter(t => t.status === 'skipped').length,
    }

    res.json({ range: { start: start_date, end: end_date }, totals, jobs, people, missed })
  } catch (err) {
    console.error('[Operandio] /jobs error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /operandio/jobs/instance — task-level detail for one job instance
// Query: location_slug, job_name, job_date (all required)
// ---------------------------------------------------------------------------
router.get('/jobs/instance', authenticate, requireRole('manager'), async (req, res) => {
  try {
    const { location_slug, job_name, job_date } = req.query
    if (!location_slug || !job_name || !job_date) {
      return res.status(400).json({ error: 'location_slug, job_name, job_date required' })
    }
    const { data, error } = await supabaseAdmin
      .from('operandio_task_completions')
      .select('step_n, task_name, completed_by, completed_at, status')
      .eq('location_slug', String(location_slug).toLowerCase())
      .eq('job_name', job_name)
      .eq('job_date', job_date)
      .order('step_n', { ascending: true })
    if (error) throw error
    res.json({ tasks: data || [] })
  } catch (err) {
    console.error('[Operandio] /jobs/instance error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /operandio/latest — current week + prior week for delta
// ---------------------------------------------------------------------------
router.get('/latest', authenticate, requireRole('manager'), async (req, res) => {
  try {
    // Distinct (period_start, period_end) ordered desc, take 2
    const { data: distinctRows, error: dErr } = await supabaseAdmin
      .from('operandio_location_reports')
      .select('period_start, period_end')
      .order('period_start', { ascending: false })
      .order('period_end', { ascending: false })
      .limit(20)

    if (dErr) return res.status(500).json({ error: dErr.message })

    // Dedupe to unique period pairs preserving order
    const seen = new Set()
    const periods = []
    for (const r of (distinctRows || [])) {
      const k = `${r.period_start}|${r.period_end}`
      if (!seen.has(k)) {
        seen.add(k)
        periods.push({ start: r.period_start, end: r.period_end })
      }
      if (periods.length >= 2) break
    }

    if (periods.length === 0) {
      return res.json({ current: null, previous: null })
    }

    async function fetchPeriod(p) {
      const { data, error } = await supabaseAdmin
        .from('operandio_location_reports')
        .select('location_slug, overall_pct, on_time_pct, late_pct, skipped_pct, uncompleted_pct')
        .eq('period_start', p.start)
        .eq('period_end', p.end)
      if (error) throw error
      return { period: p, rows: data || [] }
    }

    const current = await fetchPeriod(periods[0])
    const previous = periods[1] ? await fetchPeriod(periods[1]) : null

    res.json({ current, previous })
  } catch (err) {
    console.error('[Operandio] /latest error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
