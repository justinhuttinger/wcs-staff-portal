// Which emailed attachments are real deliverables, and which can be filed
// without asking. Pure; tested in tests/hubFileRules.test.js.
const { kindAccepts } = require('./slots')

const SIGNATURE_IMAGE_BYTES = 20 * 1024

// Small inline images are email-signature logos, not deliverables.
function isFilableAttachment(att) {
  const size = Number(att.size || 0)
  if (size <= 0) return false
  if (att.inline && /^image\//.test(String(att.mime || '')) && size < SIGNATURE_IMAGE_BYTES) return false
  return true
}

// Auto-file only when exactly one open slot can take an attachment AND no
// other attachment in this batch could also go there. Everything else goes to
// the owner's tray: a wrong club's slot is worse than one click.
// pending: attachments already waiting in the tray for this person; they still
// compete for the slots they fit, so a newcomer can't jump the queue.
function decideFiling(attachments, openSlots, pending = []) {
  const fits = attachments.map(att => ({ att, slots: openSlots.filter(s => kindAccepts(s.kind, att.mime)) }))
  const auto = []
  const tray = []
  for (const f of fits) {
    if (f.slots.length !== 1) { tray.push(f.att); continue }
    const slotId = f.slots[0].id
    const rivals = fits.filter(o => o !== f && o.slots.some(s => s.id === slotId))
    const waiting = pending.filter(p => kindAccepts(f.slots[0].kind, p.mime))
    if (rivals.length || waiting.length) tray.push(f.att)
    else auto.push({ att: f.att, slotId })
  }
  return { auto, tray }
}

module.exports = { isFilableAttachment, decideFiling }
