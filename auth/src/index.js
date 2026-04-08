require('dotenv').config()
const express = require('express')
const cors = require('cors')

const cookieParser = require('cookie-parser')
const app = express()
app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.use(cookieParser())

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Routes (added in subsequent tasks)
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
app.use('/reports', require('./routes/reports'))
app.use('/sync-status', require('./routes/syncStatus'))
app.use('/day-one-tracker', require('./routes/dayOneTracker'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`WCS Auth API listening on port ${PORT}`)
})
