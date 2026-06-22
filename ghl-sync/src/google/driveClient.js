// ghl-sync/src/google/driveClient.js
const fs = require('fs')
const os = require('os')
const path = require('path')
const { pipeline } = require('stream/promises')
const supabase = require('../db/supabase')

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'

async function getStoredTokens() {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'google_business_tokens').single()
  return data?.value ? JSON.parse(data.value) : null
}
async function storeTokens(tokens) {
  await supabase.from('app_config').upsert(
    { key: 'google_business_tokens', value: JSON.stringify(tokens) }, { onConflict: 'key' }
  )
}
async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_BUSINESS_CLIENT_ID,
      client_secret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error_description || data.error)
  return data.access_token
}
async function getAccessToken() {
  const tokens = await getStoredTokens()
  if (!tokens?.refresh_token) throw new Error('Google Business not authorized (app_config.google_business_tokens missing)')
  if (tokens.access_token && tokens.expires_at && Date.now() < tokens.expires_at - 300000) return tokens.access_token
  const access = await refreshAccessToken(tokens.refresh_token)
  tokens.access_token = access
  tokens.expires_at = Date.now() + 3600 * 1000
  await storeTokens(tokens)
  return access
}

async function driveList(params, token) {
  const url = DRIVE_FILES + '?' + new URLSearchParams({
    supportsAllDrives: 'true', includeItemsFromAllDrives: 'true', corpora: 'allDrives', ...params,
  })
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } })
  const data = await r.json()
  if (data.error) throw new Error(data.error.message || 'Drive list error')
  return data
}

function kindOf(mimeType) {
  if (mimeType && mimeType.startsWith('image/')) return 'image'
  if (mimeType && mimeType.startsWith('video/')) return 'video'
  return null
}

// BFS the folder tree; collect image/video leaves with their folder path.
async function walkMediaTree(rootId) {
  const token = await getAccessToken()
  const out = []
  const queue = [{ id: rootId, segments: [] }]
  while (queue.length) {
    const { id, segments } = queue.shift()
    let pageToken
    do {
      const data = await driveList({
        q: `'${id.replace(/'/g, "\\'")}' in parents and trashed=false`,
        fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,modifiedTime,size,webViewLink)',
        pageSize: '1000', ...(pageToken ? { pageToken } : {}),
      }, token)
      for (const f of data.files || []) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({ id: f.id, segments: [...segments, f.name] })
        } else {
          const kind = kindOf(f.mimeType)
          if (!kind) continue
          out.push({
            id: f.id, name: f.name, mimeType: f.mimeType, md5: f.md5Checksum || null,
            modifiedTime: f.modifiedTime, size: f.size ? Number(f.size) : null,
            webViewLink: f.webViewLink, kind, segments,
          })
        }
      }
      pageToken = data.nextPageToken
    } while (pageToken)
  }
  return out
}

async function downloadBuffer(fileId) {
  const token = await getAccessToken()
  const r = await fetch(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!r.ok) throw new Error('Drive download failed ' + r.status)
  return Buffer.from(await r.arrayBuffer())
}

// Stream large files (videos) to a temp path instead of buffering in memory.
async function downloadToTemp(fileId) {
  const token = await getAccessToken()
  const r = await fetch(`${DRIVE_FILES}/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: 'Bearer ' + token },
  })
  if (!r.ok || !r.body) throw new Error('Drive stream failed ' + r.status)
  const tmp = path.join(os.tmpdir(), `media-${fileId}-${process.pid}.bin`)
  await pipeline(r.body, fs.createWriteStream(tmp))
  return tmp
}

module.exports = { getAccessToken, walkMediaTree, downloadBuffer, downloadToTemp }
