const cron = require('node-cron')
const { tick } = require('./dispatch')
const rhythms = require('./rhythms')

function start() {
  if (process.env.MASTERMIND_ENABLED !== 'true') {
    console.log('[mastermind] disabled (MASTERMIND_ENABLED != "true")')
    return
  }

  // Queue poll every 60 seconds
  cron.schedule('* * * * *', () => {
    tick().catch(err => console.error('[mastermind] tick error:', err.message))
  })
  console.log('[mastermind] queue polling enabled (every 60s)')

  // Recurring rhythms
  rhythms.start()
}

module.exports = { start }
