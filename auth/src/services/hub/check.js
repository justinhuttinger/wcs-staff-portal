// The Hub's background Gmail check. For every open task thread: flag new
// replies, pull attachments the person sent, file the ones that can only go
// one place, and put the rest in the owner's tray (with Claude's suggestion,
// never applied without his click). Dependencies are injected so it runs in
// tests without network or database.
//
// Each attachment is handled once: its key (message id + stable part id) is
// recorded as seen, so a discarded or deleted file never comes back.
const { applyReply } = require('./personState')
const { isFilableAttachment, decideFiling } = require('./fileRules')

const MAX_BYTES = 25 * 1024 * 1024

async function runCheck({ owner, getToken, db, gmail, suggest = null }) {
  const result = { checked: 0, replies: 0, filed: 0, trayed: 0, errors: [] }
  let token
  let ownerEmail
  try {
    const t = await getToken(owner.id)
    token = t.accessToken
    // The connected Gmail address is who sends; the staff login may differ.
    ownerEmail = String(t.email || owner.email || '').toLowerCase()
  } catch (e) {
    if (e.notConnected) { result.errors.push('gmail_not_connected'); return result }
    throw e
  }
  const people = await db.listOpenPeople(owner.id)

  for (const { person, task } of people) {
    result.checked++
    let autoFiled = false
    try {
      const messages = await gmail.getThreadFull(token, person.gmail_thread_id)

      const patch = applyReply(person, gmail.latestReply(messages, ownerEmail))
      if (patch) { await db.updatePerson(person.id, patch); result.replies++ }

      const seen = await db.knownKeys(person.id)
      const incoming = []
      for (const m of messages) {
        const from = gmail.emailFrom(gmail.headerValue(m.payload?.headers, 'From'))
        if (!from || from === ownerEmail) continue
        for (const a of gmail.listAttachments(m)) {
          const key = `${m.id}:${a.partId ?? a.attachmentId}`
          if (seen.has(key)) continue
          const att = {
            key, partId: a.partId ?? a.attachmentId, attachmentId: a.attachmentId, name: a.filename,
            mime: a.mimeType, size: a.size, inline: a.inline, messageId: m.id, snippet: m.snippet || '',
          }
          if (!isFilableAttachment(att)) { await db.markSeen(person.id, key); continue }
          incoming.push(att)
        }
      }
      if (!incoming.length) continue

      // Too big to fetch: tell the owner (open it in Gmail), never download.
      const tooLarge = incoming.filter(a => a.size > MAX_BYTES)
      for (const att of tooLarge) {
        await db.trayAttachment({ task, person, att, bytes: null, tooLarge: true, messageId: att.messageId, suggestedSlotId: null })
        await db.markSeen(person.id, att.key)
        result.trayed++
      }
      const fits = incoming.filter(a => a.size <= MAX_BYTES)
      if (!fits.length) continue

      const slots = await db.openSlots(person.id)
      const pending = await db.pendingTray(person.id)
      const { auto, tray } = decideFiling(fits, slots, pending)
      try {
        for (const { att, slotId } of auto) {
          const bytes = await gmail.getAttachment(token, att.messageId, att.attachmentId)
          await db.fileAttachment({ task, person, slotId, att, bytes, messageId: att.messageId })
          await db.markSeen(person.id, att.key)
          result.filed++
          autoFiled = true
        }
      } finally {
        if (autoFiled) await db.refreshDelivered(person.id)
      }

      let suggestions = new Map()
      if (tray.length && suggest && slots.length) {
        try { suggestions = await suggest({ attachments: tray, slots }) } catch (e) { console.warn('[HubCheck] suggest failed', e.message) }
      }
      for (const att of tray) {
        const bytes = await gmail.getAttachment(token, att.messageId, att.attachmentId)
        await db.trayAttachment({ task, person, att, bytes, messageId: att.messageId, suggestedSlotId: suggestions.get(att.key) || null })
        await db.markSeen(person.id, att.key)
        result.trayed++
      }
    } catch (e) {
      if (e.notConnected) { result.errors.push('gmail_not_connected'); return result }
      result.errors.push(`${person.id}: ${e.message}`)
    }
  }
  return result
}

module.exports = { runCheck, MAX_BYTES }
