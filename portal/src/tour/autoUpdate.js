/**
 * Picks up a new deploy on an iPad that is never closed.
 *
 * The tour app lives on a stand at the front desk, added to the Home Screen and
 * left running for weeks. Nothing in that lifecycle ever re-fetches the page, so
 * a deploy that went out at lunchtime is still invisible at closing, and staff
 * reasonably report the app as "on an old version" when the server has been
 * current for hours. The assets are hashed and the HTML is max-age=0, so a
 * reload is all it takes -- the problem is purely that a reload never happens.
 *
 * So: check every so often whether the entry bundle the HTML points at is still
 * the one running, and reload when it is not.
 *
 * The catch is that a reload mid-check-in throws away whatever staff have typed,
 * and the moment a deploy lands is unrelated to whether somebody is standing at
 * the desk. So a difference alone is not enough -- see shouldReload.
 */

const CHECK_MS = 10 * 60 * 1000
const IDLE_MS = 5 * 60 * 1000

// Pulls the entry chunk out of the served HTML. Vite hashes it, so the filename
// changing IS the deploy. Returns null in dev (the entry is /src/tour/main.jsx,
// unhashed) which correctly disables the whole thing there.
export function bundleFromHtml(html) {
  const m = /assets\/(tour-[A-Za-z0-9_-]+\.js)/.exec(html || '')
  return m ? m[1] : null
}

export function bundleFromUrl(url) {
  const name = String(url || '').split('/').pop().split('?')[0]
  return /^tour-[A-Za-z0-9_-]+\.js$/.test(name) ? name : null
}

/**
 * Reload only when nobody is mid-sentence.
 *
 * Backgrounded (iPad asleep, or staff in another app) is the free case: there is
 * no input to lose. Otherwise wait for the desk to go quiet, because a reload
 * while someone is filling in a tour outcome costs more than running the old
 * build for another ten minutes does.
 */
export function shouldReload({ current, deployed, visible, msSinceInput }) {
  if (!current || !deployed || current === deployed) return false
  if (!visible) return true
  return msSinceInput >= IDLE_MS
}

export function startAutoUpdate(entryUrl, { fetchImpl = fetch, reload } = {}) {
  const current = bundleFromUrl(entryUrl)
  if (!current) return () => {}

  let lastInput = Date.now()
  const bump = () => { lastInput = Date.now() }
  const events = ['pointerdown', 'keydown', 'touchstart']
  events.forEach(e => window.addEventListener(e, bump, { passive: true }))

  const timer = setInterval(async () => {
    let html
    try {
      // no-store gets past the browser; Cloudflare still holds the HTML for five
      // minutes, which only ever delays this check, never breaks it.
      const res = await fetchImpl('/tour.html', { cache: 'no-store' })
      html = await res.text()
    } catch {
      return // offline or the host blinked; try again next time round
    }
    const opts = {
      current,
      deployed: bundleFromHtml(html),
      visible: document.visibilityState === 'visible',
      msSinceInput: Date.now() - lastInput,
    }
    if (shouldReload(opts)) (reload || (() => window.location.reload()))()
  }, CHECK_MS)

  return () => {
    clearInterval(timer)
    events.forEach(e => window.removeEventListener(e, bump))
  }
}
