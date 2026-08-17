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
  'https://forms.westcoaststrength.com',
  'http://localhost:3000',
  'http://localhost:5173',
]
// The global CORS below is locked to ALLOWED_ORIGINS and is mounted with no
// path, so it answers OPTIONS preflight for EVERY url. The public class board
// is embedded on westcoaststrength.com and loaded directly by in-gym TVs, so
// its permissive CORS has to be mounted FIRST or preflight fails. This exact
// ordering bug has bitten the prospects repo before.
app.use('/public/group-x', cors({ origin: '*', methods: ['GET'] }))
app.use('/public/facility', cors({ origin: '*', methods: ['GET'] }))

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

// The tour-intake webhook carries a base64 profile photo, which can exceed the
// global express.json() 100kb default. Register a higher-limit JSON parser for
// just this path BEFORE the global one — whichever parser consumes the stream
// first wins, so the global parser skips an already-parsed body.
app.use('/webhooks/tour-intake', express.json({ limit: '6mb' }))
// The Day One PT-intake webhook carries the full GHL contact + every intake
// field; a large submission (long notes, many custom fields) can exceed the
// 100kb default and 413. The old standalone service hit this. Give it room.
app.use('/day-one-program', express.json({ limit: '2mb' }))
app.use(express.json())
app.use(cookieParser())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes
app.use('/auth', require('./routes/auth'))
app.use('/vault', require('./routes/vault'))
app.use('/admin', require('./routes/admin'))
app.use('/admin/tour-locations', require('./routes/tourAdmin'))
app.use('/config', require('./routes/config'))
app.use('/launcher', require('./routes/launcher'))
app.use('/webhooks', require('./routes/webhooks'))
app.use('/webhooks', require('./routes/metaCapi'))
// Same module, second mount: the Gravity Forms lead route answers at
// /meta/lead. One CAPI implementation, one place hashing happens.
app.use('/meta', require('./routes/metaCapi'))
app.use('/appointments', require('./routes/appointments'))
app.use('/tours', require('./routes/tours'))
app.use('/tour-intake', require('./routes/tourIntake'))
app.use('/public/tour', require('./routes/publicTour'))
// Standalone API-driven Day One booking widget (replaces the embedded GHL
// booking iframe, which trips a captcha). Not wired into the portal yet.
app.use('/day-one-booking', require('./routes/dayOneBooking'))
app.use('/public/group-x', require('./routes/publicGroupX'))
app.use('/public/facility', require('./routes/publicFacility'))
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
app.use('/reports/pt-projections', require('./routes/ptProjections'))
app.use('/reports/payroll', require('./routes/payroll'))
app.use('/reports/fb-roas', require('./routes/fbRoas'))
app.use('/reports/revenue', require('./routes/revenueReports'))
app.use('/reports/website-submissions', require('./routes/websiteSubmissions'))
app.use('/reports/daily-snapshot', require('./routes/dailySnapshot'))
app.use('/reports/compliance', require('./routes/compliance'))
app.use('/reports', require('./routes/reports'))
app.use('/sync-status', require('./routes/syncStatus'))
app.use('/day-one-program', require('./routes/dayOneProgram'))
app.use('/day-one-tracker', require('./routes/dayOneTracker'))
app.use('/trainer-availability', require('./routes/trainerAvailability'))
app.use('/sms-history', require('./routes/smsHistory'))
app.use('/meta-ads', require('./routes/metaAds'))
app.use('/email-marketing', require('./routes/emailMarketing'))
app.use('/abc-scheduler', require('./routes/abcScheduler'))
app.use('/group-x', require('./routes/groupX'))
app.use('/facility-schedule', require('./routes/facilitySchedule'))
app.use('/class-seeding', require('./routes/classSeeding'))
app.use('/google-business', require('./routes/googleBusiness'))
app.use('/google-sheets', require('./routes/googleSheetsAuth'))
app.use('/google-analytics', require('./routes/googleAnalytics'))
app.use('/google-chat', require('./routes/googleChatAuth'))
app.use('/operandio', require('./routes/operandio'))
app.use('/print', require('./routes/print'))
app.use('/revenue', require('./routes/revenue'))
app.use('/drive-folders', require('./routes/driveFolders'))
app.use('/communication-notes', require('./routes/communicationNotes'))
app.use('/hr-documents', require('./routes/hrDocuments'))
app.use('/help-center', require('./routes/helpCenter'))
app.use('/ticketing', require('./routes/ticketing'))
app.use('/abc-sync', require('./routes/abcSync'))
app.use('/referral-rewards', require('./routes/referralRewards'))
app.use('/marketing-tracker', require('./routes/marketingTracker'))
app.use('/blog-automation', require('./routes/blogAutomation'))
app.use('/kpi-digest', require('./routes/kpiDigest'))
app.use('/meeting-notes', require('./routes/meetingNotes'))
app.use('/inventory', require('./routes/inventory'))
app.use('/till', require('./routes/till'))
app.use('/media', require('./routes/media'))
app.use('/custom-fields', require('./routes/customFields'))
app.use('/admin/shared-credentials', require('./routes/sharedCredentials'))
app.use('/admin/cache', require('./routes/cacheAdmin'))
app.use('/admin/exports', require('./routes/exports'))
app.use('/admin/lapsed-checkins', require('./routes/lapsedCheckins'))
app.use('/audit-log', require('./routes/auditLog'))
app.use('/changelog', require('./routes/changelog'))
app.use('/forms', require('./routes/forms'))
app.use('/public/forms', require('./routes/publicForms'))

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

  // Inventory ABC sync (catalog daily, POS every 30m). Opt out via env.
  if (process.env.INVENTORY_SYNC_DISABLED !== '1') {
    try {
      require('./services/inventorySync').start()
    } catch (err) {
      console.error('[inventorySync] failed to start:', err.message)
    }
  }

  // Operandio API compliance sync — opt-in via OPERANDIO_API_SYNC_ENABLED=true.
  try {
    require('./services/operandioSync').start()
  } catch (err) {
    console.error('[operandioSync] failed to start:', err.message)
  }

  // Blog automation weekly cron — opt-in via BLOG_AUTOMATION_ENABLED=true.
  try {
    require('./services/blogAutomation').start()
  } catch (err) {
    console.error('[blog] failed to start:', err.message)
  }

  // Weekly Operandio KPI digest — opt-in via OPERANDIO_KPI_DIGEST_ENABLED=true.
  try {
    require('./services/kpiDigest').start()
  } catch (err) {
    console.error('[kpiDigest] failed to start:', err.message)
  }

  // Meeting-notes poller — opt-in via MEETING_NOTES_ENABLED=true.
  try {
    require('./services/meetingNotes').start()
  } catch (err) {
    console.error('[meetingNotes] failed to start:', err.message)
  }

  // Nightly top-up for open-ended facility series. Without it an open-ended
  // lap swim silently stops appearing once its written horizon runs out.
  // Opt out via FACILITY_TOPUP_DISABLED=1 (checked inside start()).
  try {
    require('./services/facilitySeriesTopUp').start()
  } catch (err) {
    console.error('[facilityTopUp] failed to start:', err.message)
  }

  // Nightly top-up for open-ended Group X series. These create real ABC
  // classes, so the job is rate-conscious. Opt out via GROUPX_TOPUP_DISABLED=1.
  try {
    require('./services/groupXSeriesTopUp').start()
  } catch (err) {
    console.error('[groupXTopUp] failed to start:', err.message)
  }

  // Nightly class seeding — puts house accounts into empty Group X classes so
  // the ABC app does not read as "nobody goes to this" for a class that is
  // actually busy. Opt out via CLASS_SEEDING_DISABLED=1 (checked inside start()).
  try {
    require('./services/classSeeding').start()
  } catch (err) {
    console.error('[classSeeding] failed to start:', err.message)
  }

  // Nightly KPI snapshot — freezes end-of-day KPIs for the History view.
  // Opt out via KPI_SNAPSHOT_DISABLED=1 (checked inside start()).
  try {
    require('./services/kpiSnapshot').start()
  } catch (err) {
    console.error('[kpiSnapshot] failed to start:', err.message)
  }

  // Forms module: Google Sheets retry sweep. Opt out via FORMS_SHEETS_DISABLED=1.
  try {
    require('./services/formsSheets').start()
  } catch (err) {
    console.error('[formsSheets] failed to start:', err.message)
  }

  // RBAC v2: load admin-created role -> base-tier map so the synchronous auth
  // gates can resolve custom roles. Refresh periodically as a safety net for
  // roles created on another server instance (CRUD also refreshes in-process).
  try {
    const { refreshCustomRoleTiers } = require('./middleware/role')
    refreshCustomRoleTiers().catch(err => console.error('[rbac] role-tier load failed:', err.message))
    setInterval(() => {
      refreshCustomRoleTiers().catch(err => console.error('[rbac] role-tier refresh failed:', err.message))
    }, 5 * 60 * 1000).unref()
  } catch (err) {
    console.error('[rbac] role-tier startup failed:', err.message)
  }
})
