const path = require('path')
const fs = require('fs')

const WCS_DIR = 'C:\\WCS'
const ABC_URL_FILE = path.join(WCS_DIR, 'abc-url.txt')

function getAbcUrl() {
  try {
    if (fs.existsSync(ABC_URL_FILE)) {
      return fs.readFileSync(ABC_URL_FILE, 'utf8').trim()
    }
  } catch (e) {}
  return ''
}

function getLocationFromArgs() {
  const arg = process.argv.find(a => a.startsWith('--location='))
  return arg ? arg.split('=')[1] : 'Salem'
}

module.exports = {
  PORTAL_URL: process.env.WCS_PORTAL_URL || 'https://wcs-staff-portal.onrender.com',
  getAbcUrl,
  getLocation: getLocationFromArgs,
  TOOLS: {
    grow: 'https://app.gohighlevel.com',
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
  WCS_DIR,
  ABC_URL_FILE,
}
