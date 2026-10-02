// Call button page log (POST /telephony/page-events, table page_events).
// Pure validation so it can be tested without a database.

const SOURCES = ['button', 'test']
const RESULTS = ['ok', 'partial', 'failed', 'suppressed']
const MAX_HANDSET = 5

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const intOrNull = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null)
const handset = (v) => intOrNull(v, 1, MAX_HANDSET)

// Returns { row } ready to insert, or { error }.
function cleanPageEvent(body, now = Date.now()) {
  const b = body || {}
  const club = str(b.club, 20).replace(/^0+/, '')
  if (!/^\d+$/.test(club)) return { error: 'club required' }
  if (!SOURCES.includes(b.source)) return { error: 'bad source' }
  if (!RESULTS.includes(b.result)) return { error: 'bad result' }
  const ts = Date.parse(b.ts)
  // A queued event may arrive late, but not from the future or last month.
  if (!Number.isFinite(ts) || ts > now + 10 * 60 * 1000 || ts < now - 7 * 24 * 3600 * 1000) return { error: 'bad ts' }

  const targets = (Array.isArray(b.targets) ? b.targets : []).map(handset).filter(Boolean).slice(0, MAX_HANDSET)
  const results = (Array.isArray(b.results) ? b.results : []).slice(0, MAX_HANDSET)
    .filter((r) => r && handset(r.handset))
    .map((r) => ({
      handset: r.handset,
      ok: r.ok === true,
      latencyMs: intOrNull(r.latencyMs, 0, 600000),
      error: str(r.error, 200) || null,
    }))
  const button = b.button && typeof b.button === 'object' ? b.button : {}
  return {
    row: {
      club_number: club,
      occurred_at: new Date(ts).toISOString(),
      source: b.source,
      action: str(b.action, 20) || 'single',
      targets,
      results,
      result: b.result,
      button_ieee: str(button.ieee, 20) || null,
      button_name: str(button.name, 40) || null,
      battery: intOrNull(button.battery, 0, 100),
      linkquality: intOrNull(button.linkquality, 0, 255),
    },
  }
}

module.exports = { cleanPageEvent }
