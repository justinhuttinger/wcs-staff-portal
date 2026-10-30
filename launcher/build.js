// Runs electron-builder, adding Windows code signing (Azure Trusted Signing)
// when the signing settings are present in the environment.
//
// Why: Windows Smart App Control blocks unsigned apps outright (no "Run
// anyway"), so every Windows release should be signed. Signing is optional
// here so local dev builds without Azure credentials still work; they just
// come out unsigned, with a warning.
//
// Usage: node build.js <electron-builder args>
//   e.g. node build.js --win --publish=never --config electron-builder.abc.yml
//
// Signing env (all needed to sign; values come from the Azure portal):
//   AZURE_SIGN_ENDPOINT          e.g. https://wus2.codesigning.azure.net
//   AZURE_SIGN_ACCOUNT           Trusted Signing account name
//   AZURE_SIGN_PROFILE           certificate profile name
//   AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET
//                                app registration with the
//                                "Trusted Signing Certificate Profile Signer" role

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)

// WCS ABC's buttons use the Prohibition font, which is gitignored (see
// .gitignore), so a fresh worktree doesn't have it. Without it the build
// quietly falls back to the default font (0.0.19 shipped that way).
const displayFont = path.join(__dirname, 'assets', 'fonts', 'ProhibitionTest-Regular.otf')
if (args.some((arg) => arg.includes('electron-builder.abc.yml')) && !fs.existsSync(displayFont)) {
  console.error(`[build] Missing ${displayFont}. Copy ProhibitionTest-Regular.otf there before building WCS ABC.`)
  process.exit(1)
}
const { AZURE_SIGN_ENDPOINT, AZURE_SIGN_ACCOUNT, AZURE_SIGN_PROFILE } = process.env
const signingVars = [
  'AZURE_SIGN_ENDPOINT', 'AZURE_SIGN_ACCOUNT', 'AZURE_SIGN_PROFILE',
  'AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET',
]
const missing = signingVars.filter((name) => !process.env[name])

if (missing.length === 0) {
  args.push(
    `-c.win.azureSignOptions.endpoint=${AZURE_SIGN_ENDPOINT}`,
    `-c.win.azureSignOptions.codeSigningAccountName=${AZURE_SIGN_ACCOUNT}`,
    `-c.win.azureSignOptions.certificateProfileName=${AZURE_SIGN_PROFILE}`,
    // Trusted Signing certificates live ~3 days. Without a timestamp the
    // signature dies with the certificate; with one it stays valid.
    '-c.win.azureSignOptions.TimestampRfc3161=http://timestamp.acs.microsoft.com',
    '-c.win.azureSignOptions.TimestampDigest=SHA256',
  )
  console.log('[build] Windows code signing ON (Azure Trusted Signing)')
} else if (missing.length < signingVars.length) {
  // Partly configured: fail loudly rather than quietly ship an installer
  // Smart App Control blocks.
  console.error(`[build] Windows code signing misconfigured, missing: ${missing.join(', ')}`)
  process.exit(1)
} else {
  console.warn('[build] Windows code signing OFF (no AZURE_SIGN_* env). Smart App Control will block this build.')
}

const result = spawnSync('npx', ['electron-builder', ...args], { stdio: 'inherit', shell: true })
process.exit(result.status ?? 1)
