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
  // config.json may carry only the location (set-wcs-club.ps1, or a club
  // added in Admin -> Clubs): take that club's ABC link from the club list.
  if (config.location) return require('./locations').getAbcUrlFor(config.location)
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
    paychex: 'https://myapps.paychex.com',
  },
  ABC_URL_FILE,
  CONFIG_FILE,
}
