const fs = require('fs')
const { dataDir, ensureDir, CONFIG_FILE, ABC_URL_FILE } = require('./paths')

function readConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    }
  } catch (e) {}
  return {}
}

function writeConfig(config) {
  try {
    ensureDir(dataDir())
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2))
  } catch (e) {}
}

function getAbcUrl() {
  const config = readConfig()
  if (config.abc_url) return config.abc_url
  try {
    if (fs.existsSync(ABC_URL_FILE)) {
      return fs.readFileSync(ABC_URL_FILE, 'utf8').trim()
    }
  } catch (e) {}
  return ''
}

function getLocationFromArgs() {
  const arg = process.argv.find(a => a.startsWith('--location='))
  if (arg) return arg.split('=')[1]
  const config = readConfig()
  return config.location || 'Salem'
}

module.exports = {
  API_URL: process.env.WCS_API_URL || 'https://api.wcstrength.com',
  PORTAL_URL: process.env.WCS_PORTAL_URL || 'https://portal.wcstrength.com',
  getAbcUrl,
  getLocation: getLocationFromArgs,
  readConfig,
  writeConfig,
  TOOLS: {
    grow: 'https://app.westcoaststrength.com',
    wheniwork: 'https://app.wheniwork.com',
    paychex: 'https://myapps.paychex.com',
  },
  LOCATIONS: {
    Salem: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
    Springfield: { booking: 'https://api.westcoaststrength.com/widget/booking/PEyaqnkjmBN5tLpo6I9F', vip: 'https://api.westcoaststrength.com/widget/survey/uM48yWzOBhXhUBsG1fhW' },
    Eugene: { booking: 'https://api.westcoaststrength.com/widget/booking/0c9CNdZ65NainMcStWXo', vip: 'https://api.westcoaststrength.com/widget/survey/xKYTE6V7QXKVpkUfWTFi' },
    Keizer: { booking: 'https://api.westcoaststrength.com/widget/booking/8qFo1GnePy0mCgV9avWW', vip: 'https://api.westcoaststrength.com/widget/survey/HXB00WKKe6srvgSmfwI7' },
    Clackamas: { booking: 'https://api.westcoaststrength.com/widget/booking/yOvDLsZMAboTVjv9c2HC', vip: 'https://api.westcoaststrength.com/widget/survey/Z9zEHwjGfQaMIYy9OueF' },
    Milwaukie: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
    Medford: { booking: 'https://api.westcoaststrength.com/widget/booking/Gq92GXsDRAgTGZeHh7mx', vip: 'https://api.westcoaststrength.com/widget/survey/FkrsORfLFVMiVS26LV9V' },
  },
  ABC_URL_FILE,
  CONFIG_FILE,
}
