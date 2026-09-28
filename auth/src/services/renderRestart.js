// Restart the Render services that read the club list at boot, after a change
// in Admin -> Clubs.
//
// Needs RENDER_API_KEY and the service ids in RENDER_CLUB_RESTART_SERVICES
// (comma-separated, e.g. "srv-auth...,srv-ghlsync..."). Without them nothing is
// restarted and the caller tells the admin to restart by hand.
//
// The auth API restarts itself too, so this runs AFTER the response is sent.

const RENDER_API = 'https://api.render.com/v1'

function restartTargets() {
  return String(process.env.RENDER_CLUB_RESTART_SERVICES || '')
    .split(',').map(s => s.trim()).filter(Boolean)
}

function canRestart() {
  return Boolean(process.env.RENDER_API_KEY) && restartTargets().length > 0
}

async function restartClubServices({ fetchImpl = fetch } = {}) {
  if (!canRestart()) return { restarted: [], skipped: 'RENDER_API_KEY / RENDER_CLUB_RESTART_SERVICES not set' }
  // Restart everything except ourselves first, so our own restart can't cut the loop short.
  const self = process.env.RENDER_SERVICE_ID
  const ids = restartTargets().sort((a, b) => (a === self) - (b === self))
  const restarted = []
  const failed = []
  for (const id of ids) {
    try {
      const r = await fetchImpl(`${RENDER_API}/services/${encodeURIComponent(id)}/restart`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RENDER_API_KEY}`, Accept: 'application/json' },
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      restarted.push(id)
    } catch (err) {
      failed.push({ id, error: err.message })
      console.error(`[clubs] restart of ${id} failed: ${err.message}`)
    }
  }
  return { restarted, failed }
}

module.exports = { restartClubServices, canRestart, restartTargets }
