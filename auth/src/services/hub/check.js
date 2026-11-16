// The Hub's background Gmail check. For every open task thread: flag new
// replies, pull attachments the person sent, file the ones that can only go
// one place, and put the rest in the owner's tray (with Claude's suggestion,
// never applied without his click). Dependencies are injected so it runs in
// tests without network or database.
const { applyReply } = require('./personState')
const { isFilableAttachment, decideFiling } = require('./fileRules')

async function runCheck({ owner, getToken, db, gmail, suggest = null }) {
  const result = { checked: 0, replies: 0, filed: 0, trayed: 0, errors: [] }
  let token
  try {
    token = (await getToken(owner.id)).accessToken
  } catch (e) {
    if (e.notConnected) { result.errors.push('gmail_not_connected'); return result }
    throw e
  }
  const ownerEmail = String(owner.email || '').toLowerCase()
  const people = await db.listOpenPeople(owner.id)

  for (const { person, task } of people) {
    result.checked++
    try {
      const messages = await gmail.getThreadFull(token, person.gmail_thread_id)

      const patch = applyReply(person, gmail.latestReply(messages, ownerEmail))
      if (patch) { await db.updatePerson(person.id, patch); result.replies++ }

      const known = await db.knownKeys(person.id)
      const incoming = []
      for (const m of messages) {
        const from = String((m.payload?.headers || []).find(h => /^from$/i.test(h.name))?.value || '').toLowerCase()
        if (!from || from.includes(ownerEmail)) continue
        for (const a of gmail.listAttachments(m)) {
          if (known.has(`${m.id}:${a.attachmentId}`)) continue
          const att = { id: a.attachmentId, attachmentId: a.attachmentId, name: a.filename, mime: a.mimeType, size: a.size, inline: a.inline, messageId: m.id, snippet: m.snippet || '' }
          if (isFilableAttachment(att)) incoming.push(att)
        }
      }
      if (!incoming.length) continue

      const slots = await db.openSlots(person.id)
      const { auto, tray } = decideFiling(incoming, slots)
      for (const { att, slotId } of auto) {
        const bytes = await gmail.getAttachment(token, att.messageId, att.attachmentId)
        await db.fileAttachment({ task, person, slotId, att, bytes, messageId: att.messageId })
        result.filed++
      }
      let suggestions = new Map()
      if (tray.length && suggest && slots.length) {
        try { suggestions = await suggest({ attachments: tray, slots }) } catch (e) { console.warn('[HubCheck] suggest failed', e.message) }
      }
      for (const att of tray) {
        const bytes = await gmail.getAttachment(token, att.messageId, att.attachmentId)
        await db.trayAttachment({ task, person, att, bytes, messageId: att.messageId, suggestedSlotId: suggestions.get(att.attachmentId) || null })
        result.trayed++
      }
      if (auto.length) await db.refreshDelivered(person.id)
    } catch (e) {
      if (e.notConnected) { result.errors.push('gmail_not_connected'); return result }
      result.errors.push(`${person.id}: ${e.message}`)
    }
  }
  return result
}

module.exports = { runCheck }
