const { Router } = require('express')
const multer = require('multer')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
const upload = multer()

const WEBHOOK_SECRET = process.env.OPERANDIO_WEBHOOK_SECRET

// WCS gym slugs we care about. Anything else is ignored so the parser
// doesn't choke if Operandio adds a location later.
const KNOWN_LOCATIONS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

// "Weekly Activity for West Coast Strength: April 21st, 2026 to April 27th, 2026 at all locations"
function parsePeriodFromSubject(subject) {
  if (!subject) return null
  const m = subject.match(/:\s*([A-Za-z]+ \d+\w*,?\s*\d{4})\s+to\s+([A-Za-z]+ \d+\w*,?\s*\d{4})/)
  if (!m) return null

  // Strip "st", "nd", "rd", "th" suffixes that JS Date can't parse
  const clean = (s) => s.replace(/(\d+)(st|nd|rd|th)/i, '$1')
  const start = new Date(clean(m[1]))
  const end = new Date(clean(m[2]))
  if (isNaN(start) || isNaN(end)) return null
  const iso = (d) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
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
// POST /operandio/webhook — SendGrid Inbound Parse target
// ---------------------------------------------------------------------------
router.post('/webhook', upload.none(), async (req, res) => {
  // Auth via shared secret query param. SendGrid sends multipart, no headers
  // we can use for HMAC.
  if (!WEBHOOK_SECRET || req.query.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  const subject = req.body?.subject || ''
  const text = req.body?.text || ''

  const period = parsePeriodFromSubject(subject)
  if (!period) {
    console.warn('[Operandio] Subject did not match expected pattern:', subject)
    return res.status(200).json({ ignored: true, reason: 'Subject not recognized' })
  }

  const rows = parseLocationsSection(text)
  if (!rows.length) {
    console.warn('[Operandio] No location rows parsed for', subject)
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
