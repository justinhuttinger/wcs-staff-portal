// Supabase side of Hub deliverables: keep slots in step with a task's clubs,
// build the grid, summarize per task for the list, track "delivered", issue
// upload links, and store files. Rules live in ./slots (unit-tested).
const crypto = require('crypto')
const { supabaseAdmin } = require('../supabase')
const { getStaffGoogleAccessToken } = require('../googleUserToken')
const { hubFileName, storeFile, realDrive, positionsBySlot } = require('./drive')
const { planSlots, planOwners, affectedPeople, newUploadToken, slotLabel, allFilled, chunk } = require('./slots')

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
    slots.push(...must(await supabaseAdmin.from('hub_slots').select('id, deliverable_id, club, person_id, owner_manual').in('deliverable_id', ids)))
  }
  if (!slots.length) return []
  const items = []
  for (const ids of chunk(slots.map(s => s.id), 150)) {
    items.push(...must(await supabaseAdmin.from('hub_slot_items')
      .select('id, slot_id, file_name, mime, size_bytes, text_body, source, is_new, created_at, storage_path, drive_file_id, drive_url')
      .in('slot_id', ids).order('created_at', { ascending: true })))
  }
  return slots.map(s => {
    const own = items.filter(i => i.slot_id === s.id)
    return { ...s, items: own, filled: own.length > 0 }
  })
}

// Add/remove club slots on every deliverable of a task to match its clubs.
async function resyncSlots(task) {
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('id').eq('task_id', task.id))
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
  // New slots get owners from the clubs people cover. Removed slots can change
  // anyone's "delivered", so refresh everyone (task club edits are rare).
  await applyOwners(task, { refreshAll: true })
}

// Re-assign automatic slots to whoever covers their club. Only people whose
// slots changed hands get "delivered" refreshed, unless refreshAll (used after
// an item is added or removed, which can change anyone's delivered state).
// Writes run in parallel: this sits behind every club toggle in the UI.
async function applyOwners(task, { refreshAll = false } = {}) {
  const [people, dels] = await Promise.all([
    supabaseAdmin.from('hub_task_people').select('id, clubs, created_at').eq('task_id', task.id).then(must),
    supabaseAdmin.from('hub_deliverables').select('id').eq('task_id', task.id).then(must),
  ])
  let touched = []
  if (dels.length) {
    const slots = must(await supabaseAdmin.from('hub_slots').select('id, club, person_id, owner_manual').in('deliverable_id', dels.map(d => d.id)))
    const updates = planOwners(slots, people)
    await Promise.all(updates.map(async u => must(await supabaseAdmin.from('hub_slots').update({ person_id: u.person_id }).eq('id', u.id))))
    touched = affectedPeople(slots, updates)
  }
  const ids = refreshAll ? people.map(p => p.id) : touched
  await Promise.all(ids.map(id => refreshPersonDelivered(id)))
}

// The slots a person owns (with fill state) and their deliverables.
async function personSlots(personId) {
  const own = must(await supabaseAdmin.from('hub_slots').select('id, deliverable_id, club, person_id').eq('person_id', personId))
  if (!own.length) return { slots: [], dels: [] }
  const delIds = [...new Set(own.map(s => s.deliverable_id))]
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('*').in('id', delIds))
  const all = await slotsWithFill(delIds)
  return { slots: all.filter(s => s.person_id === personId), dels }
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
  const { slots, dels } = await personSlots(person.id)
  if (!slots.length) return []
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
  const { slots } = await personSlots(personId)
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
const extOf = name => (String(name || '').match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || ''

// Who/what a slot is, for naming its files: task title, club, deliverable,
// owner of the slot, the task's owner, and how many items it already has.
async function slotContext(slotId) {
  const slot = must(await supabaseAdmin.from('hub_slots').select('id, club, person_id, deliverable_id').eq('id', slotId).single())
  const del = must(await supabaseAdmin.from('hub_deliverables').select('name, task_id').eq('id', slot.deliverable_id).single())
  const [task, person, names, count] = await Promise.all([
    supabaseAdmin.from('hub_tasks').select('title, owner_staff_id').eq('id', del.task_id).single().then(must),
    slot.person_id ? supabaseAdmin.from('hub_task_people').select('name').eq('id', slot.person_id).maybeSingle().then(must) : null,
    clubNames(),
    supabaseAdmin.from('hub_slot_items').select('id', { count: 'exact', head: true }).eq('slot_id', slotId).then(r => r.count || 0),
  ])
  return {
    ownerId: task.owner_staff_id, taskTitle: task.title, clubName: slot.club ? (names[slot.club] || slot.club) : null,
    deliverable: del.name, person: person?.name || '', n: count + 1,
  }
}

// Drive first (one owner folder, renamed file); portal storage if Drive fails.
async function storeHubFile({ ownerId, name, file, fallbackPath }) {
  return storeFile({
    ownerId, name, file, getToken: getStaffGoogleAccessToken, drive: realDrive,
    fallback: async () => {
      await ensureBucket()
      const { error } = await supabaseAdmin.storage.from(BUCKET).upload(fallbackPath, file.buffer, { contentType: file.mimetype, upsert: false })
      if (error) throw error
      return { storage_path: fallbackPath }
    },
  })
}

// Best effort: a stored file whose row couldn't be saved, or that was removed.
async function discardStored(stored, ownerId) {
  try {
    if (stored.storage_path) await supabaseAdmin.storage.from(BUCKET).remove([stored.storage_path])
    if (stored.drive_file_id) {
      const { accessToken } = await getStaffGoogleAccessToken(ownerId)
      await realDrive.trash(accessToken, stored.drive_file_id)
    }
  } catch (e) { console.warn('[Hub] could not remove stored file', e.message) }
}

async function addSlotItem({ taskId, slotId, file, text, source, isNew, gmail }) {
  const row = { slot_id: slotId, source, is_new: isNew }
  let ownerId = null
  if (file) {
    const ctx = await slotContext(slotId)
    ownerId = ctx.ownerId
    const name = hubFileName({ ...ctx, ext: extOf(file.originalname) })
    const stored = await storeHubFile({ ownerId, name, file, fallbackPath: `${taskId}/${slotId}/${crypto.randomUUID()}-${safeName(file.originalname)}` })
    Object.assign(row, stored, { file_name: stored.drive_file_id ? name : file.originalname, mime: file.mimetype, size_bytes: file.size })
  } else {
    row.text_body = String(text || '').slice(0, 20000)
  }
  if (gmail) Object.assign(row, { gmail_message_id: gmail.messageId, gmail_attachment_id: gmail.attachmentId })
  const { data, error } = await supabaseAdmin.from('hub_slot_items').insert(row).select('*').single()
  if (error) {
    await discardStored(row, ownerId)
    throw error
  }
  return data
}

async function removeSlotItem(item, ownerId) {
  must(await supabaseAdmin.from('hub_slot_items').delete().eq('id', item.id))
  await discardStored(item, ownerId)
}

// Where the owner opens a file: its Drive page, or a 1-hour portal link.
async function openUrl(item) {
  if (item.drive_url) return item.drive_url
  if (item.storage_path) return signedUrl(item.storage_path)
  return null
}

// One-time move of the owner's portal-stored files into his Drive folder,
// named like new uploads. Items that fail stay where they are.
async function moveFilesToDrive(ownerId) {
  const tasks = must(await supabaseAdmin.from('hub_tasks').select('id').eq('owner_staff_id', ownerId))
  const result = { moved: 0, failed: 0 }
  if (!tasks.length) return result
  const dels = must(await supabaseAdmin.from('hub_deliverables').select('id').in('task_id', tasks.map(t => t.id)))
  const slots = dels.length ? must(await supabaseAdmin.from('hub_slots').select('id').in('deliverable_id', dels.map(d => d.id))) : []
  // All file items (for numbering), then just the ones still in portal storage.
  const all = slots.length ? must(await supabaseAdmin.from('hub_slot_items').select('id, slot_id, storage_path, drive_file_id, file_name, mime, created_at')
    .in('slot_id', slots.map(s => s.id)).is('text_body', null)) : []
  const position = positionsBySlot(all)
  const items = all.filter(i => i.storage_path)
  const { accessToken } = await getStaffGoogleAccessToken(ownerId)
  const folderId = await realDrive.ensureFolder(accessToken, ownerId)
  for (const it of items) {
    try {
      const { data: blob, error } = await supabaseAdmin.storage.from(BUCKET).download(it.storage_path)
      if (error) throw error
      const buffer = Buffer.from(await blob.arrayBuffer())
      const ctx = await slotContext(it.slot_id)
      const name = hubFileName({ ...ctx, n: position.get(it.id) || 1, ext: extOf(it.file_name) })
      const up = await realDrive.upload(accessToken, folderId, name, it.mime, buffer)
      const { error: upErr } = await supabaseAdmin.from('hub_slot_items').update({
        drive_file_id: up.id, drive_url: up.webViewLink || `https://drive.google.com/file/d/${up.id}/view`, storage_path: null, file_name: name,
      }).eq('id', it.id)
      if (upErr) {
        await realDrive.trash(accessToken, up.id).catch(() => {})
        throw upErr
      }
      await supabaseAdmin.storage.from(BUCKET).remove([it.storage_path])
      result.moved++
    } catch (e) {
      console.warn('[HubDrive] move failed', it.id, e.message)
      result.failed++
    }
  }
  return result
}

async function signedUrl(path) {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

// Open slots a person owes, with kind and label (for filing and suggestions).
async function openSlotsFor(personId) {
  const { slots, dels } = await personSlots(personId)
  if (!slots.length) return []
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
  // Named after the task and sender until the owner files it into a slot.
  const task = must(await supabaseAdmin.from('hub_tasks').select('title, owner_staff_id').eq('id', taskId).single())
  const person = must(await supabaseAdmin.from('hub_task_people').select('name').eq('id', personId).maybeSingle())
  const name = hubFileName({ taskTitle: task.title, clubName: null, deliverable: `from ${person?.name || 'someone'}`, person: file.originalname.replace(/\.[^.]+$/, ''), ext: extOf(file.originalname) })
  const stored = await storeHubFile({ ownerId: task.owner_staff_id, name, file, fallbackPath: `${taskId}/tray/${crypto.randomUUID()}-${safeName(file.originalname)}` })
  const { error: insErr } = await supabaseAdmin.from('hub_tray_items').insert({
    person_id: personId, gmail_message_id: gmail.messageId, gmail_attachment_id: gmail.attachmentId,
    ...stored, file_name: file.originalname, mime: file.mimetype, size_bytes: file.size,
    suggested_slot_id: suggestedSlotId,
  })
  if (insErr) {
    await discardStored(stored, task.owner_staff_id)
    if (insErr.code !== '23505') throw insErr // a concurrent run already trayed it
  }
}

// A file pulled in from the email a task was added from ("From their email").
// Never routed to a slot or the tray. Too-large files keep only their name.
async function addTaskFile({ taskId, ownerId, file, meta = {}, gmail, tooLarge = false }) {
  const base = { task_id: taskId, gmail_message_id: gmail.messageId, gmail_part_id: String(gmail.partId) }
  if (tooLarge || !file) {
    const { error } = await supabaseAdmin.from('hub_task_files').insert({
      ...base, too_large: true, file_name: meta.name, mime: meta.mime, size_bytes: meta.size,
    })
    if (error && error.code !== '23505') throw error
    return
  }
  const task = must(await supabaseAdmin.from('hub_tasks').select('title').eq('id', taskId).single())
  const name = hubFileName({ taskTitle: task.title, clubName: null, deliverable: 'from email', person: file.originalname.replace(/\.[^.]+$/, ''), ext: extOf(file.originalname) })
  const stored = await storeHubFile({ ownerId, name, file, fallbackPath: `${taskId}/email/${crypto.randomUUID()}-${safeName(file.originalname)}` })
  const { error } = await supabaseAdmin.from('hub_task_files').insert({
    ...base, ...stored, file_name: file.originalname, mime: file.mimetype, size_bytes: file.size,
  })
  if (error) {
    await discardStored(stored, ownerId)
    if (error.code !== '23505') throw error
  }
}

async function taskFiles(taskId) {
  return must(await supabaseAdmin.from('hub_task_files')
    .select('id, file_name, mime, size_bytes, too_large, drive_url, storage_path, gmail_message_id, created_at')
    .eq('task_id', taskId).order('created_at', { ascending: true }))
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
  slotContext, openUrl, moveFilesToDrive, discardStored,
  applyOwners, personSlots,
  openSlotsFor, knownGmailKeys, markGmailSeen, pendingTrayFor, addTrayItem, trayCountByTask, addTaskFile, taskFiles,
  BUCKET, resyncSlots, loadTaskDeliverables, summaryByTask, openSlotLabels, refreshPersonDelivered,
  uploadLink, addSlotItem, removeSlotItem, signedUrl, clubNames,
}
