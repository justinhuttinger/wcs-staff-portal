// Google Drive storage for Hub files. Everything goes into ONE folder the owner
// owns ("Hub Uploads", created with his token, remembered by id so he can
// rename or move it). Files are renamed on arrival:
//   <Task> - <Club> - <Deliverable> - <Person>.<ext>
// If Drive is unavailable for any reason, the file goes to portal storage
// instead so nobody sending a file ever sees a failure.
const { supabaseAdmin } = require('../supabase')

const FOLDER_NAME = 'Hub Uploads'
const DRIVE = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink'

// ---------- pure ----------

function cleanPart(s) {
  return String(s || '')
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

function hubFileName({ taskTitle, clubName, deliverable, person, ext, n = 1 }) {
  const parts = [taskTitle, clubName, deliverable, person].map(cleanPart).filter(Boolean)
  const base = parts.join(' - ') || 'Hub file'
  const suffix = n > 1 ? ` (${n})` : ''
  const e = cleanPart(ext).toLowerCase().replace(/^\./, '')
  return `${base}${suffix}${e ? `.${e}` : ''}`
}

// Stores bytes in Drive, or calls fallback() when anything about Drive fails.
async function storeFile({ ownerId, name, file, getToken, drive, fallback }) {
  try {
    const { accessToken } = await getToken(ownerId)
    const folderId = await drive.ensureFolder(accessToken, ownerId)
    const up = await drive.upload(accessToken, folderId, name, file.mimetype, file.buffer)
    if (!up?.id) throw new Error('Drive upload returned no id')
    return { drive_file_id: up.id, drive_url: up.webViewLink || `https://drive.google.com/file/d/${up.id}/view` }
  } catch (e) {
    console.warn('[HubDrive] falling back to portal storage:', e.message)
    return fallback()
  }
}

// ---------- Drive REST ----------

async function driveFetch(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const e = new Error(`Drive ${res.status}: ${body.slice(0, 200)}`)
    e.status = res.status
    throw e
  }
  return res
}

async function ensureFolder(token, ownerId) {
  const { data: row } = await supabaseAdmin.from('hub_settings').select('drive_folder_id').eq('owner_staff_id', ownerId).maybeSingle()
  if (row?.drive_folder_id) {
    try {
      const r = await driveFetch(token, `${DRIVE}/files/${row.drive_folder_id}?fields=id,trashed`)
      const f = await r.json()
      if (f.id && !f.trashed) return f.id
    } catch (e) {
      if (e.status !== 404) throw e
    }
  }
  const r = await driveFetch(token, `${DRIVE}/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })
  const { id } = await r.json()
  const { error } = await supabaseAdmin.from('hub_settings')
    .upsert({ owner_staff_id: ownerId, drive_folder_id: id, updated_at: new Date().toISOString() }, { onConflict: 'owner_staff_id' })
  if (error) throw error
  return id
}

async function upload(token, folderId, name, mime, buffer) {
  const boundary = `hub${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
  const meta = JSON.stringify({ name, parents: [folderId] })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ])
  const r = await driveFetch(token, UPLOAD, {
    method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
  })
  return r.json()
}

async function rename(token, fileId, name) {
  await driveFetch(token, `${DRIVE}/files/${fileId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
}

async function trash(token, fileId) {
  await driveFetch(token, `${DRIVE}/files/${fileId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
  })
}

// The file's bytes as a fetch Response (for streaming through share links).
function download(token, fileId) {
  return driveFetch(token, `${DRIVE}/files/${fileId}?alt=media`)
}

async function folderUrl(ownerId) {
  const { data } = await supabaseAdmin.from('hub_settings').select('drive_folder_id').eq('owner_staff_id', ownerId).maybeSingle()
  return data?.drive_folder_id ? `https://drive.google.com/drive/folders/${data.drive_folder_id}` : null
}

const realDrive = { ensureFolder, upload, rename, trash, download }

module.exports = { hubFileName, storeFile, realDrive, folderUrl, FOLDER_NAME }
