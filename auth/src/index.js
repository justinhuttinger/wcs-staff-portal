require('dotenv').config()
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

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
app.use('/reports', require('./routes/reports'))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`WCS Auth API listening on port ${PORT}`)

  // Hourly GHL data sync via node-cron
  const cron = require('node-cron')
  cron.schedule('0 * * * *', async () => {
    console.log('Cron: starting hourly GHL sync...')
    try {
      const res = await fetch(`http://localhost:${PORT}/sync/all`, { method: 'POST' })
      const data = await res.json()
      console.log('Cron: sync complete', JSON.stringify(data).substring(0, 200))
    } catch (err) {
      console.error('Cron: sync failed', err.message)
    }
  })
  console.log('Cron: hourly GHL sync scheduled')
})
