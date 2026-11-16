// Supabase side of Hub deliverables: keep slots in step with a task's clubs,
// build the grid, summarize per task for the list, track "delivered", issue
// upload links, and store files. Rules live in ./slots (unit-tested).
const crypto = require('crypto')
const { supabaseAdmin } = require('../supabase')
const { planSlots, newUploadToken, slotLabel, allFilled, chunk } = require('./slots')

const BUCKET = 'hub-task-files'
const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.wcstrength.com'

let bucketReady = false
async function ensureBucket() {
  if (bucketReady) return
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: 25 * 1024 * 1024 })
  if (error && !/already exists/i.test(error.message)) throw error
  bucketReady = true
}

async function clubNames() {
  const { data } = await supabaseAdmin.from('clubs').select('slug, name')
  return Object.fromEntries((data || []).map(c => [c.slug, c.name]))
}

function must({ data, error }) {
  if (error) throw error
  return data
}

// Slots plus whether each holds an item, for a set of deliverables.
async function slotsWithFill(deliverableIds) {
  if (!deliverableIds.length) return []
  // Batched so long id lists never make an over-long request URL.
  const slots = []
  for (const ids of chunk(deliverableIds, 150)) {
    slots.push(...must(await supabaseAdmin.from('hub_slots').select('id, deliverable_id, club').in('deliverable_id', ids)))
  }
  if (!slots.length) return []
  const items = []
  for (const ids of chunk(slots.map(s => s.id), 150)) {
    items.push(...must(await supabaseAdmin.from('hub_slot_items')
      .select('id, slot_id, file_name, mime, size_bytes, text_body, source, is_new, created_at')
      .in('slot_id', ids).order('created_at', { ascending: true })))
  }
  return slots.map(s => {
    const own = items.filter(i => i.slot_id === s.id)
    return { ...s, items: own, filled: own.length > 0 }
  })
}

// Add/remove club slots on every deliverable of a task to match its clubs.
async function resyncSlots(task) {
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('id, person_id').eq('task_id', task.id))
  if (!dels.length) return
  const slots = await slotsWithFill(dels.map(d => d.id))
  for (const d of dels) {
    const mine = slots.filter(s => s.deliverable_id === d.id)
    const { add, remove } = planSlots(task.clubs || [], mine)
    if (add.length) {
      must(await supabaseAdmin.from('hub_slots').insert(add.map(club => ({ deliverable_id: d.id, club }))))
    }
    for (const club of remove) {
      const victim = mine.find(s => (s.club ?? null) === club && !s.filled)
      if (victim) must(await supabaseAdmin.from('hub_slots').delete().eq('id', victim.id))
    }
  }
  // New or removed slots can change who has delivered everything.
  for (const pid of new Set(dels.map(d => d.person_id).filter(Boolean))) await refreshPersonDelivered(pid)
}

async function loadTaskDeliverables(task) {
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('*').eq('task_id', task.id)
    .order('sort', { ascending: true }).order('created_at', { ascending: true }))
  const slots = await slotsWithFill(dels.map(d => d.id))
  const names = await clubNames()
  return dels.map(d => ({
    ...d,
    slots: slots.filter(s => s.deliverable_id === d.id)
      .map(s => ({ ...s, label: slotLabel(d, s.club, names) }))
      .sort((a, b) => (task.clubs || []).indexOf(a.club) - (task.clubs || []).indexOf(b.club)),
  }))
}

// taskId -> { allIn, newItems } for the list view.
async function summaryByTask(taskIds) {
  const out = new Map()
  if (!taskIds.length) return out
  const dels = []
  for (const ids of chunk(taskIds, 150)) {
    dels.push(...must(await supabaseAdmin.from('hub_deliverables').select('id, task_id').in('task_id', ids)))
  }
  const slots = await slotsWithFill(dels.map(d => d.id))
  const trays = await trayCountByTask(taskIds)
  for (const id of taskIds) {
    const delIds = new Set(dels.filter(d => d.task_id === id).map(d => d.id))
    const mine = slots.filter(s => delIds.has(s.deliverable_id))
    out.set(id, {
      allIn: allFilled(mine),
      newItems: mine.reduce((n, s) => n + s.items.filter(i => i.is_new).length, 0) + (trays.get(id) || 0),
    })
  }
  return out
}

// Open slot labels a person still owes, e.g. ['Eugene Photo', 'Keizer Copy'].
async function openSlotLabels(person, task) {
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('*').eq('person_id', person.id))
  if (!dels.length) return []
  const slots = await slotsWithFill(dels.map(d => d.id))
  const names = await clubNames()
  return slots.filter(s => !s.filled).map(s => slotLabel(dels.find(d => d.id === s.deliverable_id), s.club, names))
}

// Delivered when every slot the person owes is filled; back to waiting/new
// when one is cleared. An unseen reply keeps "replied" so it still shows.
async function refreshPersonDelivered(personId) {
  if (!personId) return
  const person = must(await supabaseAdmin.from('hub_task_people')
    .select('id, state, reply_seen, gmail_thread_id').eq('id', personId).maybeSingle())
  if (!person) return
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('id').eq('person_id', personId))
  const slots = await slotsWithFill(dels.map(d => d.id))
  let next = person.state
  if (allFilled(slots)) {
    if (!(person.state === 'replied' && !person.reply_seen)) next = 'delivered'
  } else if (person.state === 'delivered') {
    next = person.gmail_thread_id ? 'waiting' : 'new'
  }
  if (next !== person.state) {
    must(await supabaseAdmin.from('hub_task_people').update({ state: next }).eq('id', personId))
  }
}

async function uploadLink(personId) {
  const existing = must(await supabaseAdmin.from('hub_upload_tokens').select('token').eq('person_id', personId).maybeSingle())
  let token = existing?.token
  if (!token) {
    token = newUploadToken()
    const { error } = await supabaseAdmin.from('hub_upload_tokens').insert({ token, person_id: personId })
    if (error) {
      // Lost a race with another request: use the one that won.
      const again = must(await supabaseAdmin.from('hub_upload_tokens').select('token').eq('person_id', personId).single())
      token = again.token
    }
  }
  return `${PORTAL_URL}/upload.html?t=${encodeURIComponent(token)}`
}

function safeName(name) {
  return String(name || 'file').replace(/[^\w.\-]+/g, '_').slice(-80) || 'file'
}

// Stores a file or text in a slot. Returns the new item row.
async function addSlotItem({ taskId, slotId, file, text, source, isNew, gmail }) {
  const row = { slot_id: slotId, source, is_new: isNew }
  if (file) {
    await ensureBucket()
    const path = `${taskId}/${slotId}/${crypto.randomUUID()}-${safeName(file.originalname)}`
    const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false })
    if (error) throw error
    Object.assign(row, { storage_path: path, file_name: file.originalname, mime: file.mimetype, size_bytes: file.size })
  } else {
    row.text_body = String(text || '').slice(0, 20000)
  }
  if (gmail) Object.assign(row, { gmail_message_id: gmail.messageId, gmail_attachment_id: gmail.attachmentId })
  const { data, error } = await supabaseAdmin.from('hub_slot_items').insert(row).select('*').single()
  if (error) {
    if (row.storage_path) await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path])
    throw error
  }
  return data
}

async function removeSlotItem(item) {
  if (item.storage_path) await supabaseAdmin.storage.from(BUCKET).remove([item.storage_path])
  must(await supabaseAdmin.from('hub_slot_items').delete().eq('id', item.id))
}

async function signedUrl(path) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

// Open slots a person owes, with kind and label (for filing and suggestions).
async function openSlotsFor(personId) {
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('*').eq('person_id', personId))
  if (!dels.length) return []
  const slots = await slotsWithFill(dels.map(d => d.id))
  const names = await clubNames()
  return slots.filter(s => !s.filled).map(s => {
    const d = dels.find(x => x.id === s.deliverable_id)
    return { id: s.id, kind: d.kind, label: slotLabel(d, s.club, names) }
  })
}

// "message:part" keys already handled for this person (filed, trayed,
// discarded or deleted all count: handled once, never again).
async function knownGmailKeys(personId) {
  const rows = must(await supabaseAdmin.from('hub_gmail_seen').select('message_id, part_id').eq('person_id', personId))
  return new Set(rows.map(r => `${r.message_id}:${r.part_id}`))
}

async function markGmailSeen(personId, key) {
  const i = key.indexOf(':')
  const { error } = await supabaseAdmin.from('hub_gmail_seen')
    .insert({ person_id: personId, message_id: key.slice(0, i), part_id: key.slice(i + 1) })
  if (error && error.code !== '23505') throw error
}

// Mime types already waiting in this person's tray (they compete for slots).
async function pendingTrayFor(personId) {
  return must(await supabaseAdmin.from('hub_tray_items').select('mime').eq('person_id', personId).eq('too_large', false))
}

async function addTrayItem({ taskId, personId, file, gmail, suggestedSlotId, tooLarge = false, meta = {} }) {
  if (tooLarge) {
    const { error } = await supabaseAdmin.from('hub_tray_items').insert({
      person_id: personId, gmail_message_id: gmail.messageId, gmail_attachment_id: gmail.attachmentId,
      storage_path: null, too_large: true, file_name: meta.name, mime: meta.mime, size_bytes: meta.size,
    })
    if (error && error.code !== '23505') throw error
    return
  }
  await ensureBucket()
  const path = `${taskId}/tray/${crypto.randomUUID()}-${safeName(file.originalname)}`
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, { contentType: file.mimetype, upsert: false })
  if (error) throw error
  const { error: insErr } = await supabaseAdmin.from('hub_tray_items').insert({
    person_id: personId, gmail_message_id: gmail.messageId, gmail_attachment_id: gmail.attachmentId,
    storage_path: path, file_name: file.originalname, mime: file.mimetype, size_bytes: file.size,
    suggested_slot_id: suggestedSlotId,
  })
  if (insErr) {
    await supabaseAdmin.storage.from(BUCKET).remove([path])
    if (insErr.code !== '23505') throw insErr // a concurrent run already trayed it
  }
}

// taskId -> number of tray items waiting on the owner.
async function trayCountByTask(taskIds) {
  const out = new Map()
  if (!taskIds.length) return out
  const people = []
  for (const ids of chunk(taskIds, 150)) {
    people.push(...must(await supabaseAdmin.from('hub_task_people').select('id, task_id').in('task_id', ids)))
  }
  for (const ids of chunk(people.map(p => p.id), 150)) {
    const rows = must(await supabaseAdmin.from('hub_tray_items').select('person_id').in('person_id', ids))
    for (const r of rows) {
      const tid = people.find(p => p.id === r.person_id).task_id
      out.set(tid, (out.get(tid) || 0) + 1)
    }
  }
  return out
}

module.exports = {
  openSlotsFor, knownGmailKeys, markGmailSeen, pendingTrayFor, addTrayItem, trayCountByTask,
  BUCKET, resyncSlots, loadTaskDeliverables, summaryByTask, openSlotLabels, refreshPersonDelivered,
  uploadLink, addSlotItem, removeSlotItem, signedUrl, clubNames,
}
