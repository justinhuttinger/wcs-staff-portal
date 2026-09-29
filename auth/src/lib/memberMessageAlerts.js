// Staff-typed ABC member alerts ("Member Message Alert"), for the WCS ABC
// check-in cue. ABC's check-in card only shows the alert's short `message`;
// the full text staff typed is in `note`, which used to mean opening the
// member's account. GET /{club}/members/{id} returns both in `alerts[]`:
//
//   { abcCode: 'Member Message Alert', message: 'TEST', text: 'TEST',
//     note: '<full text>', color: 'Red', sound: 'Has Message', priority: '99',
//     alertId: '…' }
//
// System alerts (Need Photo, Payment Overdue, …) are in the same array with
// other abcCodes and are left out here.

const MEMBER_MESSAGE = 'member message alert'

function memberMessageAlerts(member) {
  const alerts = (member && Array.isArray(member.alerts)) ? member.alerts : []
  return alerts
    .filter(a => String(a.abcCode || '').toLowerCase() === MEMBER_MESSAGE)
    .map(a => ({
      alertId: a.alertId || null,
      message: String(a.message || a.text || '').trim(),
      note: String(a.note || '').trim(),
      color: String(a.color || '').trim(),
    }))
    .filter(a => a.message || a.note)
}

// POST /member-alerts/ack body -> a purple_alert_acks row, or { error }.
function cleanAck(b = {}) {
  const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const memberId = s(b.memberId, 64).toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(memberId)) return { error: 'Bad member id' }
  const club = s(b.club, 20).replace(/\D/g, '')
  if (!club) return { error: 'club required' }
  const initials = s(b.initials, 10).replace(/[^A-Za-z]/g, '').toUpperCase()
  if (initials.length < 2 || initials.length > 4) return { error: 'Type your initials (2-4 letters)' }
  const message = s(b.message, 500)
  if (!message) return { error: 'message required' }
  const shownAt = s(b.shownAt, 40)
  return {
    value: {
      club_number: club,
      member_id: memberId,
      member_name: s(b.memberName, 200) || null,
      alert_id: s(b.alertId, 64) || null,
      alert_message: message,
      alert_note: s(b.note, 2000) || null,
      initials,
      abc_staff_name: s(b.staffName, 120) || null,
      shown_at: shownAt && !Number.isNaN(Date.parse(shownAt)) ? new Date(shownAt).toISOString() : null,
    },
  }
}

module.exports = { memberMessageAlerts, cleanAck }
