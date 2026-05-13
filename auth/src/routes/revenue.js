const { Router } = require('express')
const multer = require('multer')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { parseRevenueCsv } = require('../services/revenueCsvParser')
const { ingestParsedRevenue } = require('../services/revenueIngest')

const router = Router()

const WEBHOOK_SECRET = process.env.REVENUE_WEBHOOK_SECRET

// SendGrid Inbound Parse can send multipart with several files; admin upload sends a single file.
// 200 MB cap: a yearly backfill (~300k rows ~ 100MB) fits; a 5-year file would exceed and must be chunked.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
})

function pickCsvFile(files) {
  if (!files || files.length === 0) return null
  // Prefer fields named attachment1 / file / csv; else first text/csv-ish mimetype.
  const named = files.find(f => ['attachment1', 'file', 'csv'].includes(f.fieldname))
  if (named) return named
  const byType = files.find(f => /csv|excel|octet-stream|text\//.test(f.mimetype))
  return byType || files[0]
}

// ---------------------------------------------------------------------------
// POST /revenue/webhook — SendGrid Inbound Parse target.
// Auth: shared secret in ?secret= (SendGrid can't send custom headers).
// ---------------------------------------------------------------------------
router.post('/webhook', upload.any(), async (req, res) => {
  if (!WEBHOOK_SECRET || req.query.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'invalid webhook secret' })
  }
  const file = pickCsvFile(req.files)
  if (!file) {
    console.warn('[revenue/webhook] no attachment in payload')
    return res.status(200).json({ ignored: true, reason: 'no attachment' })
  }
  const parsed = parseRevenueCsv(file.buffer)
  const result = await ingestParsedRevenue({
    parsed,
    source: 'sendgrid_webhook',
    filename: file.originalname,
    emailSubject: req.body?.subject || null,
  })
  if (!result.ok) {
    // Return 200 so SendGrid doesn't retry an unprocessable payload for 24h.
    // The failure is already recorded in abc_revenue_imports (status='failed')
    // — visible in the Admin Backfill UI's Recent Imports table.
    console.error('[revenue/webhook] ingest failed', result)
    return res.status(200).json({ ignored: true, error: result.error, import_id: result.import_id })
  }
  console.log(`[revenue/webhook] stored ${result.row_count} rows for ${result.period_start}..${result.period_end}`)
  res.json(result)
})

// ---------------------------------------------------------------------------
// POST /revenue/upload — admin manual upload (backfill).
// Auth: session + role 'admin'.
// ---------------------------------------------------------------------------
router.post(
  '/upload',
  authenticate,
  requireRole('admin'),
  upload.single('file'),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' })
    const parsed = parseRevenueCsv(req.file.buffer)
    const result = await ingestParsedRevenue({
      parsed,
      source: 'admin_upload',
      uploadedBy: req.staff?.user_id || null,
      filename: req.file.originalname,
    })
    if (!result.ok) return res.status(500).json(result)
    res.json(result)
  }
)

module.exports = router
