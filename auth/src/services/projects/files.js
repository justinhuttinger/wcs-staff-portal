// Pure helpers for Projects files and links: link validation, default link
// titles and safe storage names. Unit-tested.

const GOOGLE_KINDS = [
  [/docs\.google\.com\/document\//, 'Google Doc'],
  [/docs\.google\.com\/spreadsheets\//, 'Google Sheet'],
  [/docs\.google\.com\/presentation\//, 'Google Slides'],
  [/docs\.google\.com\/forms\//, 'Google Form'],
  [/drive\.google\.com\/drive\/(u\/\d+\/)?folders\//, 'Drive folder'],
  [/drive\.google\.com\//, 'Drive file'],
]

// Returns { url, title } or { error }. Only http(s); a missing title becomes
// the Google file type or the site's host name.
function cleanLink({ url, title } = {}) {
  const raw = String(url || '').trim()
  if (!raw) return { error: 'Paste a link' }
  let parsed
  try { parsed = new URL(raw) } catch { return { error: 'That does not look like a link' } }
  if (!['http:', 'https:'].includes(parsed.protocol)) return { error: 'Links must start with http:// or https://' }
  if (raw.length > 2000) return { error: 'That link is too long' }
  let name = String(title || '').trim().slice(0, 200)
  if (!name) {
    const hit = GOOGLE_KINDS.find(([re]) => re.test(raw))
    name = hit ? hit[1] : parsed.hostname.replace(/^www\./, '')
  }
  return { url: parsed.toString(), title: name }
}

function safeFileName(name) {
  const cleaned = String(name || 'file').replace(/[\r\n"/\\<>:|?*]/g, '').trim().slice(0, 200)
  return cleaned || 'file'
}

module.exports = { cleanLink, safeFileName }
