// Incoming phone calls -> WCS ABC banner.
//
// GHL fires a workflow webhook when a club's phone rings (routes/telephony.js).
// We look the caller up in abc_members, park the result here per club, and the
// WCS ABC app at that club polls for it every few seconds.
//
// Proof of concept: the queue is in memory, so a call that lands during a
// Render redeploy is lost, and a second API instance would not see it. The
// auth API runs one instance, and a missed banner costs nothing (the phone
// still rings), so that is acceptable until this graduates to a table.

const TTL_MS = 2 * 60 * 1000
const MAX_PER_CLUB = 20

// Last 10 digits: "(425) 954-9854", "+14259549854" and "4259549854" all match.
function last10(phone) {
  const d = String(phone || '').replace(/\D+/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

function createCallQueue({ ttlMs = TTL_MS, now = () => Date.now() } = {}) {
  const byClub = new Map() // club number -> [{ id, at, ...call }]
  let seq = 0

  function prune(list) {
    const cutoff = now() - ttlMs
    while (list.length && list[0].at < cutoff) list.shift()
    while (list.length > MAX_PER_CLUB) list.shift()
  }

  return {
    push(club, call) {
      const key = String(club)
      const list = byClub.get(key) || []
      const entry = { ...call, id: ++seq, at: now() }
      list.push(entry)
      prune(list)
      byClub.set(key, list)
      return entry
    },
    // Calls for a club newer than afterId. The poller passes back the last id
    // it saw; a fresh app (afterId 0) gets whatever is still inside the TTL.
    since(club, afterId = 0) {
      const list = byClub.get(String(club))
      if (!list) return []
      prune(list)
      return list.filter(c => c.id > Number(afterId || 0))
    },
    // Highest id handed out so far, so a restarted app can skip old calls.
    latestId() { return seq },
  }
}

// abc_members rows (+ active PT rows) -> what the banner shows. A phone can be
// shared (families, a parent's number on a kid's account), so every match is
// returned, best first: real memberships, then active, then this club.
function summarizeMatches(members, ptRows, callClub) {
  const ptByMember = new Map()
  for (const p of ptRows || []) {
    const k = `${p.club_number}:${p.member_id}`
    if (!ptByMember.has(k)) ptByMember.set(k, [])
    ptByMember.get(k).push(p)
  }
  const isActive = m => String(m.member_status || '').toLowerCase() === 'active'
  // ABC keeps prospects, guests and test accounts as "Active" records with a
  // NON-MEMBER membership type. They aren't members, so they rank last and
  // the banner treats them like an unknown caller.
  const isNonMember = m => /non-?member/i.test(m.membership_type || '')
  return (members || [])
    .map(m => {
      const pt = ptByMember.get(`${m.club_number}:${m.member_id}`) || []
      return {
        memberId: m.member_id,
        clubNumber: m.club_number,
        name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim(),
        status: m.member_status || null,
        active: isActive(m),
        nonMember: isNonMember(m),
        pastDue: !!m.is_past_due,
        membershipType: m.membership_type || null,
        barcode: m.barcode || null,
        ptClient: pt.length > 0,
        ptTrainer: pt.map(p => p.trainer_name).filter(Boolean)[0] || null,
      }
    })
    .sort((a, b) =>
      (a.nonMember - b.nonMember) ||
      (b.active - a.active) ||
      ((b.clubNumber === String(callClub)) - (a.clubNumber === String(callClub))) ||
      (b.ptClient - a.ptClient))
}

module.exports = { last10, createCallQueue, summarizeMatches, TTL_MS }
