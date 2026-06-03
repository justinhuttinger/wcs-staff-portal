// Pure selection of the first HUMAN outbound contact from a list of GHL messages.
// Human = outbound + source 'app' (manual), SMS or call. Ignores 'workflow'
// automation, inbound, and non-SMS/call types. Returns { at, kind } or null.
function pickFirstHumanContact(messages) {
  let best = null
  for (const m of (messages || [])) {
    if (m.direction !== 'outbound') continue
    if (m.source !== 'app') continue
    const isSms = m.messageType === 'TYPE_SMS'
    const isCall = m.messageType === 'TYPE_CALL'
    if (!isSms && !isCall) continue
    if (!m.dateAdded) continue
    const t = Date.parse(m.dateAdded)
    if (Number.isNaN(t)) continue
    if (best === null || t < best.t) {
      best = { t, at: m.dateAdded, kind: isCall ? 'call' : 'sms' }
    }
  }
  return best ? { at: best.at, kind: best.kind } : null
}

module.exports = { pickFirstHumanContact }
