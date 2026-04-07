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
app.use('/sync', require('./routes/sync'))
app.use('/oidc', require('./routes/oidc'))

// OIDC discovery at root level (some providers look here)
app.get('/.well-known/openid-configuration', (req, res) => {
  res.redirect('/oidc/.well-known/openid-configuration')
})
app.use('/reports', require('./routes/reports'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`WCS Auth API listening on port ${PORT}`)

  // GHL data sync — calls sync functions directly (no HTTP timeout issues)
  const cron = require('node-cron')
  const { supabaseAdmin } = require('./services/supabase')
  const syncRouter = require('./routes/sync')

  async function runSync() {
    const { data: locations } = await supabaseAdmin
      .from('locations')
      .select('id, name, ghl_location_id, ghl_api_key')

    const active = locations.filter(l => l.ghl_api_key && l.ghl_location_id)

    for (const loc of active) {
      try {
        console.log('Sync: ' + loc.name + ' contacts...')
        const cResult = await syncRouter.syncContactsForLocation(loc)
        console.log('Sync: ' + loc.name + ' — ' + cResult.fetched + ' contacts, ' + cResult.upserted + ' upserted')

        console.log('Sync: ' + loc.name + ' opportunities...')
        const oResult = await syncRouter.syncOpportunitiesForLocation(loc)
        console.log('Sync: ' + loc.name + ' — ' + oResult.fetched + ' opportunities, ' + oResult.upserted + ' upserted')
      } catch (err) {
        console.error('Sync: ' + loc.name + ' failed:', err.message)
      }
    }
    console.log('Sync: complete')
  }

  // Hourly sync
  cron.schedule('0 * * * *', () => {
    console.log('Cron: starting hourly GHL sync...')
    runSync().catch(err => console.error('Cron sync failed:', err.message))
  })

  // Startup sync
  setTimeout(() => {
    console.log('Startup: running GHL sync...')
    runSync().catch(err => console.error('Startup sync failed:', err.message))
  }, 5000)

  console.log('Cron: hourly GHL sync scheduled')
})
// v2
