#!/usr/bin/env node
// DP752 paging probe (Member Call Button, phase 0).
//
// The DP752 base has no documented paging API, so this replays what its web
// UI sends and prints the raw responses. Nothing in the launcher is built on
// these calls until this script pages handsets reliably.
//
// Usage (from the club LAN):
//   node scripts/dp752-probe.js --status              read handset status only
//   node scripts/dp752-probe.js --hs 1,2              page handsets 1 and 2
//   node scripts/dp752-probe.js --hs all              page every handset (what the web UI button sends)
//
// Auth, one of:
//   DP752_PASSWORD=...   log in as admin (DP752_USERNAME to change the user)
//   --sid <sid>          reuse a browser session (cookie `session-identity`)
//
// Options: --base https://192.168.1.134   --form (send the page call as form-encoded, not the UI's application/json)
const https = require('https')

const args = process.argv.slice(2)
function flag(name) { return args.includes('--' + name) }
function opt(name, fallback) {
  const i = args.indexOf('--' + name)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}

const BASE = new URL(opt('base', process.env.DP752_BASE || 'https://192.168.1.134'))
const USERNAME = process.env.DP752_USERNAME || 'admin'
const PASSWORD = process.env.DP752_PASSWORD || ''
const TIMEOUT_MS = 5000

// Self-signed cert on the base: skip verification for this host only.
const agent = new https.Agent({ rejectUnauthorized: false })

function post(path, body, { sid, contentType = 'application/x-www-form-urlencoded' } = {}) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
    if (sid) headers.Cookie = `session-role=admin; session-identity=${sid}`
    const req = https.request({
      host: BASE.hostname, port: BASE.port || 443, path, method: 'POST', headers, agent, timeout: TIMEOUT_MS,
    }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { text += c })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(text) } catch {}
        resolve({ status: res.statusCode, text, json, ms: Date.now() - started })
      })
    })
    req.on('timeout', () => req.destroy(new Error('timeout after ' + TIMEOUT_MS + 'ms')))
    req.on('error', reject)
    req.end(body)
  })
}

function show(label, r) {
  console.log(`\n[${label}] HTTP ${r.status} in ${r.ms}ms`)
  console.log(r.text.length > 1500 ? r.text.slice(0, 1500) + ' ...' : r.text)
}

// The UI's own code checks `response` for 'success' / 'error'.
function isOk(r) { return r.status === 200 && !!r.json && r.json.response === 'success' }

async function login() {
  const body = `username=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`
  const r = await post('/cgi-bin/dologin', body)
  show('login', r)
  const sid = r.json && r.json.body && r.json.body.sid
  if (!isOk(r) || !sid) throw new Error('login failed (see response above)')
  return String(sid)
}

async function status(sid) {
  const keys = []
  for (let n = 1; n <= 5; n++) {
    keys.push(`handset.${n}.name`, `handset${n}_subscribe`, `handset${n}_inrange`, `handset${n}_battery`, `handset${n}_charging`)
  }
  const r = await post('/cgi-bin/api.values.get', `request=${keys.join(':')}&sid=${sid}`, { sid })
  show('status', r)
  return r
}

async function page(sid, hs) {
  const r = await post('/cgi-bin/dect', `sid=${sid}&action=page&hs=${hs}`, {
    sid, contentType: flag('form') ? 'application/x-www-form-urlencoded' : 'application/json',
  })
  show('page hs=' + hs, r)
  return r
}

async function main() {
  let sid = opt('sid', '')
  if (!sid) {
    if (!PASSWORD) {
      console.error('Set DP752_PASSWORD or pass --sid <sid>. See the header of this file.')
      process.exit(2)
    }
    sid = await login()
  }
  console.log('session ok (sid ' + sid.slice(0, 4) + '...)')

  if (flag('status') || !opt('hs', '')) await status(sid)

  const targets = opt('hs', '').split(',').map((s) => s.trim()).filter(Boolean)
  let failed = 0
  // One at a time so each response is easy to read against what the handsets did.
  for (const hs of targets) {
    const r = await page(sid, hs)
    const ok = isOk(r)
    if (!ok) failed++
    console.log(`=> handset ${hs}: ${ok ? 'OK' : 'FAILED'}`)
  }
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error('\nERROR: ' + e.message)
  process.exit(1)
})
