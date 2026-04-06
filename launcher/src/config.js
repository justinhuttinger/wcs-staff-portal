const path = require('path')

module.exports = {
  CHROME_PATH: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  PORTAL_URL: process.env.WCS_PORTAL_URL || 'https://wcs-portal.westcoaststrength.com',
  MONITOR_INTERVAL_MS: 5000,
  IDLE_TIMEOUT_MS: 10 * 60 * 1000,
  RELAUNCH_DELAY_MS: 2000
}
