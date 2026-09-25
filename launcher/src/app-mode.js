// Build flavor switch. One codebase ships two apps:
//   - 'portal' (default): the full WCS Portal launcher (Portal tab + tools).
//   - 'abc': "WCS ABC", a launcher that is only the ABC Financial tab, with the
//     ABC Actions toolbar, Book Day One / VIPs / Cancel Tool popups and the
//     post-signup Day One overlay. No portal sign-in: it opens straight to
//     ABC, and staff identity comes from ABC (abc-scraper `staffName`).
//
// The flavor is baked into the packaged package.json as `wcsAppMode` by
// electron-builder's extraMetadata (see electron-builder.abc.yml). For local
// dev, `WCS_APP_MODE=abc npm start` overrides it.
let mode = 'portal'
try {
  mode = require('../package.json').wcsAppMode || 'portal'
} catch {}
if (process.env.WCS_APP_MODE) mode = process.env.WCS_APP_MODE

const IS_ABC_ONLY = mode === 'abc'

module.exports = {
  APP_MODE: mode,
  IS_ABC_ONLY,
  APP_DISPLAY_NAME: IS_ABC_ONLY ? 'WCS ABC' : 'Portal',
}
