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
// How long after a call staff can still save an enquiry against it.
const ENQUIRY_WINDOW_MS = 60 * 60 * 1000
const MAX_RECENT = 500
// Reports of the same number at the same club this close together are one call.
const DEDUPE_MS = 90 * 1000

// Last 10 digits: "(425) 954-9854", "+14259549854" and "4259549854" all match.
function last10(phone) {
  const d = String(phone || '').replace(/\D+/g, '')
  return d.length >= 10 ? d.slice(-10) : null
}

// A desk phone's action URL reports the caller however its firmware feels like:
// "5035551212", "+15035551212", "sip:5035551212@10.0.0.5" or
// '"Jane" <sip:+15035551212@pbx.example.com>'. The host part can hold digits
// (an IP), so cut it off before counting. Extensions and anonymous callers
// come back null.
function callerNumber(raw) {
  const s = String(raw || '')
  const sip = s.match(/sips?:([^@>;]+)/i)
  return last10(sip ? sip[1] : s.split('@')[0])
}

function createCallQueue({ ttlMs = TTL_MS, now = () => Date.now() } = {}) {
  const byClub = new Map() // club number -> [{ id, at, ...call }]
  // Every call from the last hour by id, for enquiry saves. The launcher only
  // gets to write to a GHL contact that actually called this club recently.
  const recent = new Map() // id -> { club, at, call }
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
      recent.set(entry.id, { club: key, at: entry.at, call: entry })
      // Map keeps insertion order, so the oldest are first.
      for (const [id, r] of recent) {
        if (recent.size <= MAX_RECENT && r.at >= now() - ENQUIRY_WINDOW_MS) break
        recent.delete(id)
      }
      return entry
    },
    // The call with this id, if this club received it within the enquiry window.
    recentCall(club, id) {
      const r = recent.get(Number(id))
      if (!r || r.club !== String(club)) return null
      if (r.at < now() - ENQUIRY_WINDOW_MS) return null
      return r.call
    },
    // This club's latest call from this number in the last withinMs, if any.
    // One call reaches us several times (every handset in the ring group, then
    // GHL once it connects), and should only make one banner.
    findByPhone(club, phone10, withinMs = DEDUPE_MS) {
      const list = byClub.get(String(club))
      if (!list || !phone10) return null
      const cutoff = now() - withinMs
      for (let i = list.length - 1; i >= 0 && list[i].at >= cutoff; i--) {
        if (last10(list[i].phone) === phone10) return list[i]
      }
      return null
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
// returned, best first: active accounts always first (Justin, 2026-09-28: "if
// someone has multiple accounts, always prioritize the active one"), then real
// memberships over NON-MEMBER records, then this club, then PT clients.
function summarizeMatches(members, ptRows, callClub) {
  const ptByMember = new Map()
  for (const p of ptRows || []) {
    const k = `${p.club_number}:${p.member_id}`
    if (!ptByMember.has(k)) ptByMember.set(k, [])
    ptByMember.get(k).push(p)
  }
  const isActive = m => String(m.member_status || '').toLowerCase() === 'active'
  // ABC keeps prospects, guests and test accounts as "Active" records with a
  // NON-MEMBER membership type. They aren't members, so the banner treats them
  // like an unknown caller.
  const isNonMember = m => /non-?member/i.test(m.membership_type || '')
  return (members || [])
    .map(m => {
      const pt = ptByMember.get(`${m.club_number}:${m.member_id}`) || []
      return {
        memberId: m.member_id,
        clubNumber: m.club_number,
        name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim(),
        firstName: m.first_name || '',
        lastName: m.last_name || '',
        email: m.email || '',
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
      (b.active - a.active) ||
      (a.nonMember - b.nonMember) ||
      ((b.clubNumber === String(callClub)) - (a.clubNumber === String(callClub))) ||
      (b.ptClient - a.ptClient))
}

// Staff-typed enquiry fields -> { value } with clean values, or { error }.
function cleanEnquiry(b) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')
  const out = { firstName: s(b.firstName, 80), lastName: s(b.lastName, 80), email: s(b.email, 200).toLowerCase() }
  if (!out.firstName) return { error: 'First name is required' }
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return { error: "That email doesn't look right" }
  return { value: out }
}

module.exports = { last10, callerNumber, createCallQueue, summarizeMatches, cleanEnquiry, TTL_MS, ENQUIRY_WINDOW_MS, DEDUPE_MS }
