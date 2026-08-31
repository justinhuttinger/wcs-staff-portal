// auth/src/services/blogAutomation/alerts.js
// The SMS alert path moved to services/alertSms.js so the Day One integrity
// check could share it rather than keep a second copy of the webhook URL and
// the cooldown. This stays as the blog's prefixed entry point.
const { sendAlert } = require('../alertSms')

const blogAlert = (message) => sendAlert(`Blog generator: ${message}`)

module.exports = { sendAlert, blogAlert }
