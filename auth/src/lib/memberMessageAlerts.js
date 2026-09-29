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

module.exports = { memberMessageAlerts }
