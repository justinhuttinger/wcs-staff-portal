'use strict'

// Public front door for the Day One program intake site
// (program.westcoaststrength.com). Unauthenticated by design: a trainer opens
// a per-location URL on a gym tablet and submits. Everything downstream is the
// same pipeline the GHL webhook uses.

const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { LOCATIONS, getLocationBySlug } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { trainerRoster, clearRosterCache } = require('../lib/ghlBooking')
const { brandForSlug, getBrand } = require('../services/dayOneProgram/brands')
const { validateSubmission } = require('../services/dayOneProgram/publicIntake')
const { runPipeline } = require('../services/dayOneProgram/pipeline')
const jobs = require('../services/dayOneProgram/jobs')

const router = Router()

// Generating a program spends Claude + PDFShift credit, so submissions are the
// tightly limited verb; polling and the location list are cheap.
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many programs from this device. Please wait a bit and try again.' },
})
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
})

const TURNSTILE_SECRET = process.env.DAY_ONE_TURNSTILE_SECRET || ''
if (!TURNSTILE_SECRET) {
  console.warn('[DayOnePublic] DAY_ONE_TURNSTILE_SECRET not set - bot verification is DISABLED')
}

// Verify a Cloudflare Turnstile token. With no secret configured the check is
// skipped so the site works before keys are provisioned; the boot warning above
// is the reminder that it is off.
async function verifyTurnstile(token, ip) {
  if (!TURNSTILE_SECRET) return { ok: true, skipped: true }
  if (!token) return { ok: false, reason: 'missing-token' }
  try {
    const body = new URLSearchParams({ secret: TURNSTILE_SECRET, response: token })
    if (ip) body.set('remoteip', ip)
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = await resp.json().catch(() => ({}))
    return data.success ? { ok: true } : { ok: false, reason: (data['error-codes'] || []).join(',') || 'rejected' }
  } catch (e) {
    // A Cloudflare outage must not take the gyms offline.
    console.warn('[DayOnePublic] Turnstile verify failed open:', e.message)
    return { ok: true, degraded: true }
  }
}

// GET /public/day-one/locations - drives the site's location picker.
router.get('/locations', readLimiter, (req, res) => {
  res.json({
    locations: LOCATIONS.map(l => ({
      slug: l.slug,
      name: l.name,
      brand: brandForSlug(l.slug),
      brandName: getBrand(brandForSlug(l.slug)).name,
    })),
  })
})

// GET /public/day-one/trainers/:slug - who may run a Day One at this club.
// The Day One calendar's round-robin membership is the source of truth: those
// are the people GHL can actually assign, so the list cannot drift from a
// hand-kept roster. Cached in the lib for five minutes; ?refresh=1 skips the
// wait right after someone is added in GHL.
router.get('/trainers/:slug', readLimiter, async (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase()
  const club = getLocationBySlug(slug)
  if (!club) return res.status(400).json({ error: `Unknown location "${slug}"` })
  try {
    if (req.query.refresh) clearRosterCache(slug)
    const roster = await trainerRoster(club)
    // Names only. This is a public endpoint and staff emails are not needed to
    // draw a dropdown.
    res.json({ trainers: roster.map(t => t.name).filter(Boolean) })
  } catch (e) {
    // A missing or unreachable calendar must not block a program: the site
    // falls back to a free-text trainer field.
    console.warn(`[DayOnePublic] trainer roster failed for ${slug}:`, e.message)
    res.json({ trainers: [], error: e.message })
  }
})

// POST /public/day-one/intake - the whole submission.
router.post('/intake', submitLimiter, async (req, res) => {
  try {
    const { errors, client, trainerName, formData } = validateSubmission(req.body)
    if (errors.length) return res.status(400).json({ error: errors[0], errors })

    const slug = String(req.body.slug || '').trim().toLowerCase()
    const club = getLocationBySlug(slug)
    if (!club) return res.status(400).json({ error: `Unknown location "${slug}"` })

    const turnstile = await verifyTurnstile(req.body.turnstileToken, req.ip)
    if (!turnstile.ok) {
      // Say WHY. A bare 403 gives nothing to debug from, and the common cause
      // is a deploy mismatch (server secret set, page built without the site
      // key) rather than anything the trainer did.
      console.warn(`[DayOnePublic] turnstile rejected slug=${slug} reason=${turnstile.reason}`)
      const message = turnstile.reason === 'missing-token'
        ? 'This page did not send a verification token. It needs to be rebuilt with the Turnstile site key.'
        : 'Verification failed. Please reload and try again.'
      return res.status(403).json({ error: message, reason: turnstile.reason })
    }

    // Brand comes from the URL slug, never from the payload: a trainer cannot
    // pick the wrong one, and a caller cannot ask for someone else's branding.
    const brandKey = brandForSlug(slug)

    // upsert matches on email/phone, so a prospect already in GHL is reused
    // rather than duplicated. It returns no contact detail to the browser.
    const contactBody = {
      locationId: club.id,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
    }
    if (client.phone) contactBody.phone = client.phone
    const upserted = await ghlFetch('/contacts/upsert', club.apiKey, {
      method: 'POST', body: contactBody,
    })
    const contactId = upserted?.contact?.id
    if (!contactId) throw new Error('Contact upsert returned no id')

    const job = await jobs.createJob({
      contactId,
      contactName: [client.firstName, client.lastName].filter(Boolean).join(' '),
      contactEmail: client.email,
      locationId: club.id,
      clubCode: club.clubCode,
      trainerName,
      abcMemberId: null,
      brand: brandKey,
    })

    console.log(`[DayOnePublic] intake slug=${slug} brand=${brandKey} job=${job.id}`)

    // Respond immediately; the site polls /status for progress.
    res.status(202).json({ jobId: job.id, brand: brandKey })
    runPipeline(job.id, contactId, club, formData, null, brandKey)
  } catch (err) {
    console.error('[DayOnePublic] intake error:', err)
    if (!res.headersSent) res.status(500).json({ error: 'Could not start the program. Please try again.' })
  }
})

// GET /public/day-one/status/:jobId - progress for one job.
// Keyed on the job UUID rather than the contact id, so a public caller cannot
// walk contacts, and the response carries no client detail.
router.get('/status/:jobId', readLimiter, async (req, res) => {
  try {
    const row = await jobs.getById(req.params.jobId)
    if (!row) return res.status(404).json({ error: 'Not found' })
    res.json({
      jobId: row.id,
      status: row.status,
      progress: row.progress,
      // The PDF is offered the moment it is stored, without waiting on delivery.
      ready: Boolean(row.pdf_path),
      failed: row.status === 'error',
      emailed: Boolean(row.emailed),
    })
  } catch (e) {
    res.status(500).json({ error: 'Could not read status' })
  }
})

module.exports = router
