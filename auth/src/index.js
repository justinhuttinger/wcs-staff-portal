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

  // Hourly GHL data sync via node-cron — syncs one location at a time
  const cron = require('node-cron')
  const { supabaseAdmin } = require('./services/supabase')

  cron.schedule('0 * * * *', async () => {
    console.log('Cron: starting hourly GHL sync...')
    try {
      const { data: locations } = await supabaseAdmin
        .from('locations')
        .select('id, name, ghl_location_id, ghl_api_key')

      const active = locations.filter(l => l.ghl_api_key && l.ghl_location_id)

      for (const loc of active) {
        try {
          console.log('Cron: syncing contacts for ' + loc.name + '...')
          await fetch(`http://localhost:${PORT}/sync/contacts?location_id=${loc.id}`, { method: 'POST' })
          console.log('Cron: syncing opportunities for ' + loc.name + '...')
          await fetch(`http://localhost:${PORT}/sync/opportunities?location_id=${loc.id}`, { method: 'POST' })
          console.log('Cron: ' + loc.name + ' done')
        } catch (err) {
          console.error('Cron: ' + loc.name + ' failed:', err.message)
        }
      }
      console.log('Cron: hourly sync complete')
    } catch (err) {
      console.error('Cron: sync failed', err.message)
    }
  })

  // On startup: full sync only if DB is empty, otherwise incremental
  setTimeout(async () => {
    try {
      const { count } = await supabaseAdmin.from('ghl_contacts').select('*', { count: 'exact', head: true })
      const isFull = !count || count === 0
      console.log('Startup: ' + (isFull ? 'DB empty, running full sync...' : count + ' contacts exist, running incremental sync...'))

      const { data: locations } = await supabaseAdmin
        .from('locations')
        .select('id, name, ghl_location_id, ghl_api_key')

      const active = locations.filter(l => l.ghl_api_key && l.ghl_location_id)
      for (const loc of active) {
        try {
          const fullParam = isFull ? '&full=true' : ''
          console.log('Startup sync: ' + loc.name + '...')
          await fetch(`http://localhost:${PORT}/sync/contacts?location_id=${loc.id}${fullParam}`, { method: 'POST' })
          await fetch(`http://localhost:${PORT}/sync/opportunities?location_id=${loc.id}`, { method: 'POST' })
          console.log('Startup sync: ' + loc.name + ' done')
        } catch (err) {
          console.error('Startup sync: ' + loc.name + ' failed:', err.message)
        }
      }
      console.log('Startup: sync complete')
    } catch (err) {
      console.error('Startup sync failed:', err.message)
    }
  }, 5000)

  console.log('Cron: hourly GHL sync scheduled')
})
