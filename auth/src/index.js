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
  'https://survey.westcoaststrength.com',
  'http://localhost:3000',
  'http://localhost:5173',
]
// The global CORS below is locked to ALLOWED_ORIGINS and is mounted with no
// path, so it answers OPTIONS preflight for EVERY url. The public class board
// is embedded on westcoaststrength.com and loaded directly by in-gym TVs, so
// its permissive CORS has to be mounted FIRST or preflight fails. This exact
// ordering bug has bitten the prospects repo before.
app.use('/public/day-one', cors({ origin: '*', methods: ['GET', 'POST'] }))
app.use('/public/group-x', cors({ origin: '*', methods: ['GET'] }))
app.use('/public/facility', cors({ origin: '*', methods: ['GET'] }))
// Shared ticket files are pasted into emails and opened from anywhere, so the
// permissive CORS has to be mounted ahead of the origin-locked one below.
app.use('/public/ticket-file', cors({ origin: '*', methods: ['GET'] }))

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
// Same trap again, and the third path to hit it. A GHL workflow webhook posts
// the whole trigger payload, not just the Custom Data rows we read, so a contact
// with a long history is comfortably over the 100kb default. Measured
// 2026-08-28: roughly three quarters of Day One booking webhooks were 413ing
// with PayloadTooLargeError before any of our code ran, which is why bookings
// kept arriving with no booking team member.
app.use('/webhooks/day-one-booked', express.json({ limit: '2mb' }))
app.use(express.json())
app.use(cookieParser())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes
app.use('/auth', require('./routes/auth'))
app.use('/vault', require('./routes/vault'))
app.use('/admin', require('./routes/admin'))
app.use('/admin/tour-locations', require('./routes/tourAdmin'))
app.use('/admin/club-integrations', require('./routes/clubIntegrationsAdmin'))
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
// Public Day One outcome form. Reached from a GHL workflow link carrying only
// {{contact.id}}, so no custom field is needed to route it.
app.use('/day-one/outcome', require('./routes/dayOneOutcome'))
// Shorter alias for the links members actually receive
// (book.westcoaststrength.com/dayone/salem/cancel?c=...). Same router; it reads
// req.baseUrl, so the page it serves calls back through whichever mount was used.
app.use('/dayone', require('./routes/dayOneBooking'))
// "Meet with Justin" — a calendar GROUP in the corporate sub-account, so the
// visitor picks a meeting length before a time.
app.use('/meetjustin', require('./routes/meetBooking'))
app.use('/public/group-x', require('./routes/publicGroupX'))
app.use('/public/facility', require('./routes/publicFacility'))
// Public, unauthenticated delivery of a ticket attachment a handler chose to
// share. Token-gated per file; the Storage bucket itself stays private.
app.use('/public/ticket-file', require('./routes/publicTicketFile'))
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
app.use('/reports/nps', require('./routes/npsReport'))
app.use('/reports/payroll', require('./routes/payroll'))
app.use('/reports/fb-roas', require('./routes/fbRoas'))
app.use('/reports/revenue', require('./routes/revenueReports'))
app.use('/reports/website-submissions', require('./routes/websiteSubmissions'))
app.use('/reports/daily-snapshot', require('./routes/dailySnapshot'))
app.use('/reports/compliance', require('./routes/compliance'))
app.use('/reports/childcare', require('./routes/childcare'))
app.use('/reports', require('./routes/reports'))
// Analytics — admin-only reporting surface. Mounted outside /reports so the
// report-access grants in the roles grid can never reach it.
app.use('/analytics/salesperson-performance', require('./routes/analyticsSalesperson'))
app.use('/analytics/club-activity', require('./routes/analyticsClubActivity'))
app.use('/analytics/topline', require('./routes/analyticsTopline'))
app.use('/analytics/past-due', require('./routes/analyticsPastDue'))
app.use('/analytics/membership-mix', require('./routes/analyticsMembershipMix'))
app.use('/analytics/revenue-per-member', require('./routes/analyticsRevenuePerMember'))
app.use('/analytics/pt-penetration', require('./routes/analyticsPtPenetration'))
app.use('/analytics/pt-scorecard', require('./routes/analyticsPtScorecard'))
app.use('/analytics/membership-trends', require('./routes/analyticsMembershipTrends'))
app.use('/analytics/net-membership', require('./routes/analyticsNetMembership'))
app.use('/analytics/revenue-by-profit-center', require('./routes/analyticsRevenueByProfitCenter'))
app.use('/analytics/revenue-trends', require('./routes/analyticsRevenueTrends'))
app.use('/analytics/first-pt-purchase', require('./routes/analyticsFirstPtPurchase'))
app.use('/analytics/trainer-performance', require('./routes/analyticsTrainerPerformance'))
app.use('/analytics/salesperson-snapshot', require('./routes/analyticsSalespersonSnapshot'))
app.use('/analytics/attrition-trends', require('./routes/analyticsAttritionTrends'))
app.use('/analytics/attrition-analysis', require('./routes/analyticsAttritionAnalysis'))
app.use('/analytics/pt-roster', require('./routes/analyticsPtRoster'))
app.use('/analytics/session-frequency', require('./routes/analyticsSessionFrequency'))
app.use('/analytics/lead-sources', require('./routes/analyticsLeadSources'))
app.use('/analytics/problem-areas', require('./routes/analyticsProblemAreas'))
app.use('/analytics/checkins', require('./routes/analyticsCheckins'))
app.use('/analytics/compliance', require('./routes/analyticsCompliance'))
app.use('/analytics/pos-sales', require('./routes/analyticsPosSales'))
app.use('/analytics/revenue', require('./routes/analyticsRevenue'))
app.use('/analytics/daily-snapshot', require('./routes/analyticsDailySnapshot'))
app.use('/analytics/group-x', require('./routes/analyticsGroupX'))
app.use('/analytics/till', require('./routes/analyticsTill'))
app.use('/analytics/audits', require('./routes/analyticsAudits'))
app.use('/analytics/member-journey', require('./routes/analyticsMemberJourney'))
app.use('/analytics/club-snapshot', require('./routes/analyticsClubSnapshot'))
app.use('/analytics/pt-snapshot', require('./routes/analyticsPtSnapshot'))
app.use('/analytics/trainer-snapshot', require('./routes/analyticsTrainerSnapshot'))
// The rows behind any number on any report. One route, a registry of record
// sets — see lib/analyticsRecords.
app.use('/analytics/records', require('./routes/analyticsRecords'))
// Second router on /tours, deliberately: routes/tours.js owns GET / (the
// tour list) and this owns /outcomes and /complete. No path collides, so
// Express falls through from the first to the second.
app.use('/tours', require('./routes/tourCompletion'))
app.use('/sync-status', require('./routes/syncStatus'))
app.use('/day-one-program', require('./routes/dayOneProgram'))
app.use('/day-one-tracker', require('./routes/dayOneTracker'))
app.use('/trainer-availability', require('./routes/trainerAvailability'))
app.use('/sms-history', require('./routes/smsHistory'))
// Mounted before /meta-ads so the longer prefix always wins, regardless of how
// Express is matching path segments.
app.use('/meta-ads-manager', require('./routes/metaAdsManager'))
app.use('/meta-ads', require('./routes/metaAds'))
app.use('/email-marketing', require('./routes/emailMarketing'))
app.use('/sms-marketing', require('./routes/smsMarketing'))
app.use('/abc-scheduler', require('./routes/abcScheduler'))
app.use('/group-x', require('./routes/groupX'))
app.use('/facility-schedule', require('./routes/facilitySchedule'))
app.use('/club-features', require('./routes/clubFeatures'))
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
app.use('/meeting-goals', require('./routes/meetingGoals'))
app.use('/meeting-notes', require('./routes/meetingNotes'))
app.use('/inventory', require('./routes/inventory'))
app.use('/till', require('./routes/till'))
app.use('/media', require('./routes/media'))
app.use('/custom-fields', require('./routes/customFields'))
app.use('/custom-values', require('./routes/customValues'))
app.use('/admin/shared-credentials', require('./routes/sharedCredentials'))
app.use('/admin/cache', require('./routes/cacheAdmin'))
app.use('/admin/exports', require('./routes/exports'))
app.use('/admin/lapsed-checkins', require('./routes/lapsedCheckins'))
app.use('/audit-log', require('./routes/auditLog'))
app.use('/changelog', require('./routes/changelog'))
app.use('/ui-preferences', require('./routes/uiPreferences'))
app.use('/backgrounds', require('./routes/backgrounds'))
app.use('/forms', require('./routes/forms'))
app.use('/public/day-one', require('./routes/publicDayOne'))
app.use('/public/forms', require('./routes/publicForms'))
app.use('/public/nps', require('./routes/publicNps'))
app.use('/nps', require('./routes/nps'))

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

  // Weekly meeting goals articles — opt-in via OPERANDIO_GOALS_ENABLED=true.
  try {
    require('./services/meetingGoals').start()
  } catch (err) {
    console.error('[meetingGoals] failed to start:', err.message)
  }

  // Meeting-notes poller — opt-in via MEETING_NOTES_ENABLED=true.
  try {
    require('./services/meetingNotes').start()
  } catch (err) {
    console.error('[meetingNotes] failed to start:', err.message)
  }

  // Weekly Day One data integrity check. Silent unless something is wrong.
  // Opt-in via DAY_ONE_INTEGRITY_ENABLED=true.
  try {
    require('./services/dayOneIntegrity').start()
  } catch (err) {
    console.error('[dayOneIntegrity] failed to start:', err.message)
  }

  // Day One calendar reconciler. Keeps day_one_appointments self-healing when a
  // booking webhook is missed. Opt-in via DAY_ONE_RECONCILE_ENABLED=true.
  try {
    require('./services/dayOneReconcile').start()
  } catch (err) {
    console.error('[dayOneReconcile] failed to start:', err.message)
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

  // Nightly membership snapshot — records what the membership actually was
  // that day, because abc_members is current-state only and a re-join rewrites
  // the past. See migration 182. Opt out via MEMBERSHIP_SNAPSHOT_DISABLED=1.
  try {
    require('./services/membershipSnapshot').start()
  } catch (err) {
    console.error('[membershipSnapshot] failed to start:', err.message)
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

  // "Not interested" for Lead Sources is GHL WORKFLOW membership, which is not
  // in any sync and cannot be read on a report load: it is a paginated POST per
  // club against contacts/search. Synced here, daily, and once at startup so a
  // fresh deploy is not reporting yesterday's answer as today's.
  //
  // Opt-in, because it needs the per-club GHL tokens. Without them every club
  // records status 'failed' and the report says so rather than showing zero.
  if (process.env.GHL_NOT_INTERESTED_SYNC_ENABLED === 'true') {
    const { syncNotInterested } = require('./services/ghlNotInterestedSync')
    const runNotInterested = () =>
      syncNotInterested()
        .then(rows => {
          const total = rows.reduce((a, r) => a + r.contacts, 0)
          const bad = rows.filter(r => r.status === 'failed')
          console.log(`[not-interested] synced ${total} contacts across ${rows.length} clubs` +
            (bad.length ? ` — ${bad.length} failed: ${bad.map(b => b.slug).join(', ')}` : ''))
        })
        .catch(err => console.error('[not-interested] sync failed:', err.message))

    // A minute after boot rather than immediately, so it does not compete with
    // the first requests a deploy has to serve.
    setTimeout(runNotInterested, 60 * 1000).unref()
    setInterval(runNotInterested, 24 * 60 * 60 * 1000).unref()
  }

  // Memory verification instrumentation (see auth memory-leak fixes): log
  // process.memoryUsage() every 15 minutes so RSS growth in production is
  // visible in Render logs without attaching a profiler. `external` and
  // `rss - heapUsed` matter specifically because this service uses `canvas`
  // and `chartjs-node-canvas` (trends Excel export) for native rendering —
  // those allocations live outside the V8 heap, so a leak there grows RSS
  // without ever showing up as heapUsed and without ever producing a
  // "JavaScript heap out of memory" error. Cheap: one interval, one log line,
  // no history retained in memory.
  const mb = n => (n / 1024 / 1024).toFixed(1)
  setInterval(() => {
    const m = process.memoryUsage()
    console.log(
      `[memory] rss=${mb(m.rss)}MB heapUsed=${mb(m.heapUsed)}MB external=${mb(m.external)}MB ` +
      `heapTotal=${mb(m.heapTotal)}MB nonHeap=${mb(m.rss - m.heapUsed)}MB`
    )
  }, 15 * 60 * 1000).unref()
})
