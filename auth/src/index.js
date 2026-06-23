require('dotenv').config()
const express = require('express')
const cors = require('cors')

const cookieParser = require('cookie-parser')
const app = express()

// Render terminates TLS at its proxy and forwards X-Forwarded-For. Trust one
// hop so express-rate-limit and req.ip read the real client address instead
// of the proxy's loopback. Without this, express-rate-limit logs validation
// errors on every request.
app.set('trust proxy', 1)

// CORS: whitelist known origins
const ALLOWED_ORIGINS = [
  process.env.PORTAL_URL || 'https://portal.wcstrength.com',
  'http://localhost:3000',
  'http://localhost:5173',
]
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (Electron, server-to-server, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    cb(null, false)
  },
  credentials: true,
}))

// Raw body parser for staff import MUST be registered before express.json()
app.use('/admin/staff/import', express.raw({ type: '*/*', limit: '10mb' }))
app.use(express.json({
  verify: (req, _res, buf) => {
    // ClickUp signs the raw body. Capture it for the mastermind webhook so HMAC verifies.
    if (req.path === '/webhooks/mastermind') {
      req.rawBody = buf.toString('utf8')
    }
  },
}))
app.use(cookieParser())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes
app.use('/auth', require('./routes/auth'))
app.use('/vault', require('./routes/vault'))
app.use('/admin', require('./routes/admin'))
app.use('/config', require('./routes/config'))
app.use('/launcher', require('./routes/launcher'))
app.use('/webhooks', require('./routes/webhooks'))
app.use('/webhooks', require('./routes/metaCapi'))
app.use('/webhooks', require('./routes/mastermind'))
app.use('/appointments', require('./routes/appointments'))
app.use('/tours', require('./routes/tours'))
app.use('/oidc', require('./routes/oidc'))

// OIDC discovery at root level (some providers look here)
app.get('/.well-known/openid-configuration', (req, res) => {
  res.redirect('/oidc/.well-known/openid-configuration')
})
app.use('/reports/leaderboard', require('./routes/leaderboard'))
app.use('/reports/pt-roster', require('./routes/ptRoster'))
app.use('/reports/pt-new-clients', require('./routes/ptNewClients'))
app.use('/reports/session-frequency', require('./routes/sessionFrequency'))
app.use('/reports/deactivated-pt', require('./routes/deactivatedPT'))
app.use('/reports/pt-health', require('./routes/ptHealth'))
app.use('/reports/checkins', require('./routes/checkinsReport'))
app.use('/reports/pt-sessions', require('./routes/ptSessions'))
app.use('/reports/payroll', require('./routes/payroll'))
app.use('/reports/fb-roas', require('./routes/fbRoas'))
app.use('/reports/revenue', require('./routes/revenueReports'))
app.use('/reports/website-submissions', require('./routes/websiteSubmissions'))
app.use('/reports/daily-snapshot', require('./routes/dailySnapshot'))
app.use('/reports', require('./routes/reports'))
app.use('/sync-status', require('./routes/syncStatus'))
app.use('/day-one-program', require('./routes/dayOneProgram'))
app.use('/day-one-tracker', require('./routes/dayOneTracker'))
app.use('/trainer-availability', require('./routes/trainerAvailability'))
app.use('/sms-history', require('./routes/smsHistory'))
app.use('/meta-ads', require('./routes/metaAds'))
app.use('/abc-scheduler', require('./routes/abcScheduler'))
app.use('/google-business', require('./routes/googleBusiness'))
app.use('/google-sheets', require('./routes/googleSheetsAuth'))
app.use('/google-analytics', require('./routes/googleAnalytics'))
app.use('/operandio', require('./routes/operandio'))
app.use('/revenue', require('./routes/revenue'))
app.use('/drive-folders', require('./routes/driveFolders'))
app.use('/communication-notes', require('./routes/communicationNotes'))
app.use('/hr-documents', require('./routes/hrDocuments'))
app.use('/help-center', require('./routes/helpCenter'))
app.use('/ticket-embeds', require('./routes/ticketEmbeds'))
app.use('/tickets', require('./routes/tickets'))
app.use('/abc-sync', require('./routes/abcSync'))
app.use('/referral-rewards', require('./routes/referralRewards'))
app.use('/marketing-tracker', require('./routes/marketingTracker'))
app.use('/inventory', require('./routes/inventory'))
app.use('/media', require('./routes/media'))
app.use('/custom-fields', require('./routes/customFields'))
app.use('/admin/shared-credentials', require('./routes/sharedCredentials'))
app.use('/admin/cache', require('./routes/cacheAdmin'))
app.use('/admin/exports', require('./routes/exports'))
app.use('/admin/mastermind', require('./routes/mastermindStats'))
app.use('/audit-log', require('./routes/auditLog'))

// WCS University (voice roleplay training) — ships dark behind a flag until the
// Retell agent + GHL custom fields are configured. See services/university/README.md.
if (process.env.UNIVERSITY_ENABLED === 'true') {
  // Admin enrollment API — its own dark flag + JWT/admin gate, mounted at the
  // distinct /university/admin prefix (before the others) so its auth never
  // touches the public /app page or the machine endpoints.
  if (process.env.UNIVERSITY_ENROLL_ENABLED === 'true') {
    app.use('/university/admin', require('./routes/university-admin'))
    console.log('[university] enrollment admin mounted at /university/admin')
  }
  // Trainee web app (server-rendered, param-auth) — mount BEFORE the API router
  // so its JWT `authenticate` middleware doesn't intercept the public /app page.
  app.use('/university', require('./routes/university-app'))
  app.use('/university', require('./routes/university'))
  console.log('[university] routes mounted at /university')
}

// Global error handler — catch unhandled errors, don't leak stack traces
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message, err.stack)
  res.status(500).json({ error: 'Internal server error' })
})

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason)
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`WCS Auth API listening on port ${PORT}`)
  // Register the slow-report warmCache functions and kick off the warmer.
  // The warmer has a 30s startup grace and skips outside Pacific 6am–10pm.
  // Disable in tests / when explicitly opted out via env.
  if (process.env.CACHE_WARMER_DISABLED !== '1') {
    try {
      const cacheWarmer = require('./services/cacheWarmer')
      cacheWarmer.registerDefaultRoutes()
      cacheWarmer.start()
    } catch (err) {
      console.error('[cacheWarmer] failed to start:', err.message)
    }
  }

  // Marketing Mastermind processor — no-op if MASTERMIND_ENABLED != 'true'
  try {
    require('./mastermind').start()
  } catch (err) {
    console.error('[mastermind] failed to start:', err.message)
  }

  // Inventory ABC sync (catalog daily, POS every 30m). Opt out via env.
  if (process.env.INVENTORY_SYNC_DISABLED !== '1') {
    try {
      require('./services/inventorySync').start()
    } catch (err) {
      console.error('[inventorySync] failed to start:', err.message)
    }
  }
})
