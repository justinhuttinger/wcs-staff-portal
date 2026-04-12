require('dotenv').config()
const express = require('express')
const cors = require('cors')

const cookieParser = require('cookie-parser')
const app = express()

// CORS: whitelist known origins
const ALLOWED_ORIGINS = [
  process.env.PORTAL_URL || 'https://wcs-staff-portal.onrender.com',
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
app.use(express.json())
app.use(cookieParser())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes
app.use('/auth', require('./routes/auth'))
app.use('/vault', require('./routes/vault'))
app.use('/admin', require('./routes/admin'))
app.use('/config', require('./routes/config'))
app.use('/webhooks', require('./routes/webhooks'))
app.use('/appointments', require('./routes/appointments'))
app.use('/tours', require('./routes/tours'))
app.use('/oidc', require('./routes/oidc'))

// OIDC discovery at root level (some providers look here)
app.get('/.well-known/openid-configuration', (req, res) => {
  res.redirect('/oidc/.well-known/openid-configuration')
})
app.use('/reports/leaderboard', require('./routes/leaderboard'))
app.use('/reports', require('./routes/reports'))
app.use('/sync-status', require('./routes/syncStatus'))
app.use('/day-one-tracker', require('./routes/dayOneTracker'))
app.use('/trainer-availability', require('./routes/trainerAvailability'))
app.use('/sms-history', require('./routes/smsHistory'))
app.use('/meta-ads', require('./routes/metaAds'))
app.use('/google-business', require('./routes/googleBusiness'))
app.use('/communication-notes', require('./routes/communicationNotes'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`WCS Auth API listening on port ${PORT}`)
})
