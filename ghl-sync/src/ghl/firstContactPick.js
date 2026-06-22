// Pure selection of the first HUMAN outbound contact from a list of GHL messages.
// Returns { at, kind } ('sms' | 'call') or null.
//
// Human detection (refined after live Medford data, 2026-06-22):
//  - CALLS (TYPE_CALL): a call placed through GHL's dialer is tagged
//    source:'workflow' even when a human staff member dials it, but it ALWAYS
//    carries that staff member's `userId`. Automated drops are a different type
//    (TYPE_CAMPAIGN_VOICEMAIL), so an outbound TYPE_CALL with a `userId` is a
//    genuine human call. Keying on `source:'app'` here wrongly discarded every
//    human call (e.g. JT Nelms calling a lead 7h in showed as 36h).
//  - TEXTS (TYPE_SMS): a manually-typed text is source:'app' AND carries a
//    `userId`. We require BOTH because (a) automated workflow texts can also
//    carry a `userId` (the workflow owner) and (b) the source:'app' "Day One
//    booking confirmation" auto-text has no `userId` — neither is a human reach.
//    Bulk blasts (source:'bulk_actions') are excluded for the same reason.
//
// In all cases: outbound only, must have a usable `dateAdded`, earliest wins.
function pickFirstHumanContact(messages) {
  let best = null
  for (const m of (messages || [])) {
    if (m.direction !== 'outbound') continue
    if (!m.userId) continue // every human-initiated send carries a staff userId

    const isCall = m.messageType === 'TYPE_CALL'
    const isSms = m.messageType === 'TYPE_SMS'
    // Calls: any human-dialed outbound call (userId already required above).
    // Texts: only a manually-typed ('app') SMS — excludes automated workflow/bulk
    // texts that happen to carry a userId.
    if (!isCall && !(isSms && m.source === 'app')) continue

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
