// Grandstream DP752 base: page DECT handsets by replaying its web UI calls.
// The base has no documented paging API; these requests and response shapes
// were captured on firmware 1.0.21.31 (see scripts/dp752-probe.js):
//   POST /cgi-bin/dologin         username=&password=        -> { response, body: { sid } }
//   POST /cgi-bin/dect            sid=&action=page&hs=<N>    -> { response: 'success', body: 'true' }
//                                 bad session                -> { response: 'error', body: 'false' }
//   POST /cgi-bin/api.values.get  request=<keys>&sid=        -> { response: 'success', body: {...} }
//                                 bad session                -> 'success' with every value empty
const https = require('https')

const TIMEOUT_MS = 5000
// Logging in is the slow call on this base (several seconds).
const LOGIN_TIMEOUT_MS = 10000
const MAX_HANDSETS = 5

class DP752Client {
  // getCredentials: () => ({ baseUrl, username, password }), read on each
  // login so an Admin change applies without a restart.
  constructor(getCredentials, { request } = {}) {
    this.getCredentials = getCredentials
    this.sid = null
    // Self-signed cert on the base: skip verification for these requests only.
    this.agent = new https.Agent({ rejectUnauthorized: false })
    if (request) this.request = request
  }

  request(pathname, body, { contentType = 'application/x-www-form-urlencoded', timeout = TIMEOUT_MS } = {}) {
    const { baseUrl } = this.getCredentials()
    let base
    try { base = new URL(baseUrl) } catch { return Promise.reject(new Error('Phone base address is not set')) }
    const headers = { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
    if (this.sid) headers.Cookie = `session-role=admin; session-identity=${this.sid}`
    return new Promise((resolve, reject) => {
      const req = https.request({
        host: base.hostname, port: base.port || 443, path: pathname, method: 'POST',
        headers, agent: this.agent, timeout,
      }, (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { text += c })
        res.on('end', () => {
          let json = null
          try { json = JSON.parse(text) } catch {}
          resolve({ status: res.statusCode, json })
        })
      })
      req.on('timeout', () => req.destroy(new Error('Phone base did not answer')))
      req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' || e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT'
        ? 'Phone base unreachable' : e.message)))
      req.end(body)
    })
  }

  // One login at a time: paging two handsets at once must not log in twice
  // (a second login can invalidate the first session).
  login() {
    if (!this.loggingIn) {
      this.loggingIn = this.doLogin().finally(() => { this.loggingIn = null })
    }
    return this.loggingIn
  }

  async doLogin() {
    const { username, password } = this.getCredentials()
    if (!password) throw new Error('Phone base password is not set')
    this.sid = null
    const r = await this.request('/cgi-bin/dologin',
      `username=${encodeURIComponent(username || 'admin')}&password=${encodeURIComponent(password)}`,
      { timeout: LOGIN_TIMEOUT_MS })
    const sid = r.json && r.json.body && r.json.body.sid
    if (!r.json || r.json.response !== 'success' || !sid) throw new Error('Phone base login failed, check password')
    this.sid = String(sid)
  }

  // Runs `call` with a session; a rejected session gets one fresh login and
  // one retry. `rejected(result)` says whether the base refused the session.
  async withSession(call, rejected) {
    if (!this.sid) await this.login()
    const used = this.sid
    let r = await call()
    if (rejected(r)) {
      // Another call may already have replaced the session; only log in again
      // if the one we used is still the current one.
      if (this.sid === used || !this.sid) await this.login()
      r = await call()
    }
    return r
  }

  async pageHandset(handset) {
    const started = Date.now()
    try {
      const ok = (r) => r.status === 200 && !!r.json && r.json.response === 'success'
      // The web UI sends this form body as application/json; mirror it.
      const r = await this.withSession(
        () => this.request('/cgi-bin/dect', `sid=${this.sid}&action=page&hs=${handset}`, { contentType: 'application/json' }),
        (res) => !ok(res))
      return ok(r)
        ? { handset, ok: true, latencyMs: Date.now() - started }
        : { handset, ok: false, latencyMs: Date.now() - started, error: 'Phone base refused the page' }
    } catch (e) {
      return { handset, ok: false, latencyMs: Date.now() - started, error: e.message }
    }
  }

  async handsetStatus() {
    const keys = []
    for (let n = 1; n <= MAX_HANDSETS; n++) {
      keys.push(`handset.${n}.name`, `handset${n}_subscribe`, `handset${n}_inrange`, `handset${n}_battery`, `handset${n}_charging`)
    }
    // A dead session still answers 'success', just with every value empty.
    const empty = (r) => !r.json || r.json.response !== 'success' || !r.json.body || !r.json.body['handset.1.name']
    const r = await this.withSession(
      () => this.request('/cgi-bin/api.values.get', `request=${keys.join(':')}&sid=${this.sid}`), empty)
    if (empty(r)) throw new Error('Phone base did not return handset status')
    const b = r.json.body
    const out = []
    for (let n = 1; n <= MAX_HANDSETS; n++) {
      if (b[`handset${n}_subscribe`] !== '1') continue
      out.push({
        handset: n,
        name: b[`handset.${n}.name`] || 'HS' + n,
        inRange: b[`handset${n}_inrange`] === '1',
        // A level reported by the base, not a percentage.
        battery: b[`handset${n}_battery`] === '' ? null : Number(b[`handset${n}_battery`]),
        charging: b[`handset${n}_charging`] === '1',
      })
    }
    return out
  }
}

module.exports = { DP752Client, MAX_HANDSETS }
