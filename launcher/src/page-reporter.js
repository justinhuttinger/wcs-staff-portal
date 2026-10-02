// Reports call button pages to the API (POST /telephony/page-events) for the
// page log. Fire-and-forget: paging never waits on this. Events that can't be
// sent (API or internet down) wait in a small queue on disk and go out later.
const MAX_QUEUE = 200
const RETRY_MS = 60000

// deps: post(event) -> Promise<boolean> (true = stored, or rejected for good),
// load() -> array, save(array).
function createReporter({ post, load, save }) {
  let queue = load()
  let sending = false

  async function flush() {
    if (sending) return
    sending = true
    try {
      while (queue.length) {
        if (!(await post(queue[0]))) break
        queue.shift()
        save(queue)
      }
    } finally {
      sending = false
    }
  }

  function report(event) {
    queue.push(event)
    if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
    save(queue)
    return flush()
  }

  return { report, flush, pending: () => queue.length }
}

// ---- Electron wiring ----
function setup({ log, getClub }) {
  const fs = require('fs')
  const path = require('path')
  const { app } = require('electron')
  const { API_URL } = require('./config')
  const file = path.join(app.getPath('userData'), 'page-events-queue.json')

  const reporter = createReporter({
    load: () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return [] } },
    save: (q) => { try { fs.writeFileSync(file, JSON.stringify(q)) } catch {} },
    post: async (event) => {
      try {
        const headers = { 'Content-Type': 'application/json' }
        if (process.env.WCS_LAUNCHER_KEY) headers['x-launcher-key'] = process.env.WCS_LAUNCHER_KEY
        const res = await fetch(API_URL + '/telephony/page-events', {
          method: 'POST', headers, body: JSON.stringify(event), signal: AbortSignal.timeout(10000),
        })
        // A 4xx will never succeed on retry: drop it instead of blocking the queue.
        if (!res.ok && res.status < 500) log('[pager] page event rejected ' + res.status)
        return res.ok || res.status < 500
      } catch {
        return false
      }
    },
  })
  setInterval(() => reporter.flush().catch(() => {}), RETRY_MS).unref()

  return (ev) => {
    const club = getClub()
    if (!club) return
    reporter.report({
      club, ts: ev.ts, source: ev.source, action: ev.action, targets: ev.targets,
      results: ev.results, result: ev.result, button: ev.button || null,
    }).catch(() => {})
  }
}

module.exports = { createReporter, setup }
