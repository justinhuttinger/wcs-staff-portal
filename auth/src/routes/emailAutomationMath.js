// Period math for cumulative workflow email snapshots.
//
// Mirrors ghl-sync/src/sync/emailSnapshotDiff.js. The two packages have
// separate dependency roots and cannot require across them, so this is a
// deliberate duplicate. Change both together.

const COUNTER_FIELDS = [
  'sent', 'accepted', 'delivered', 'opened', 'clicked', 'unsubscribed',
  'complained', 'permanent_fail', 'temporary_fail', 'rejected', 'failed', 'replied',
]

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function diffSnapshots(latest, baseline) {
  if (!latest) return null
  const out = { is_lifetime: !baseline }
  for (const f of COUNTER_FIELDS) {
    const d = num(latest[f]) - (baseline ? num(baseline[f]) : 0)
    out[f] = d > 0 ? d : 0
  }
  return out
}

const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)

function computeRates(c) {
  const delivered = num(c.delivered)
  const sent = num(c.sent)
  const bounced = num(c.permanent_fail) + num(c.temporary_fail)
  return {
    open_rate: pct(num(c.opened), delivered),
    click_rate: pct(num(c.clicked), delivered),
    reply_rate: pct(num(c.replied), delivered),
    unsubscribe_rate: pct(num(c.unsubscribed), delivered),
    bounce_rate: pct(bounced, sent),
  }
}

module.exports = { COUNTER_FIELDS, diffSnapshots, computeRates }
