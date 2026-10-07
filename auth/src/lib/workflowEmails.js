// Turns the workflow email series (~/wcs-creative/emails/<series>/) into the
// per-club GHL custom values the workflows send: "<Name> Subject" and
// "<Name> HTML". Pure functions; scripts/push-workflow-emails.js does the I/O.
//
// Series format (owned by the email build): each <slug>/ has email.html and
// subject.txt ("*subject | preview", starred = pick). Club-specific bits are
// [[snake_case]] placeholders. GHL can't resolve a custom value inside another
// one, so they are filled in here, per club, before the HTML is stored.

const PLACEHOLDER_RE = /\[\[([a-z0-9_]+)\]\]/g

// "New leads" #3 -> "New Lead Email 3"; milestone-050 -> "Check In 50 Email".
function emailName(meta) {
  switch (meta.group) {
    case 'New leads': return `New Lead Email ${meta.order}`
    case 'Free pass': return `Free Pass Email ${meta.order}`
    case 'New member': return `New Member Email ${meta.order}`
    case 'Check-in milestones': {
      const n = Number(String(meta.slug).match(/(\d+)$/)?.[1])
      return `Check In ${n} Email`
    }
    default: return `${meta.group} Email ${meta.order}`
  }
}

// The starred "subject | preview" line of subject.txt (else the first).
function pickSubject(subjectTxt) {
  const lines = String(subjectTxt || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  const line = lines.find(l => l.startsWith('*')) || lines[0] || ''
  const [subject, preview = ''] = line.replace(/^\*/, '').split('|').map(s => s.trim())
  return { subject, preview }
}

function placeholdersIn(text) {
  return [...new Set([...String(text || '').matchAll(PLACEHOLDER_RE)].map(m => m[1]))]
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;')

// Fill one email for one club.
// - <a href="[[key]]"> becomes href="<url>" data-wcs-link="key", so the portal's
//   link editor knows exactly which link it is later.
// - any other href="[[key]]" (Outlook's VML button) gets the URL.
// - [[key]] in text gets the HTML-escaped value.
// - src="images/x" becomes the hosted URL from imageUrls[x].
// Returns { html, missing: [keys with no value], unhosted: [image files] }.
function renderEmailHtml(html, values, imageUrls = {}) {
  const missing = new Set()
  const val = (k) => {
    const v = values[k]
    if (v == null || String(v).trim() === '') { missing.add(k); return `[[${k}]]` }
    return String(v)
  }
  let out = html.replace(/<a\b([^>]*?)\bhref="\[\[([a-z0-9_]+)\]\]"([^>]*)>/gi, (m, pre, key, post) => {
    const tagged = /\bdata-wcs-link=/i.test(pre + post) ? '' : ` data-wcs-link="${key}"`
    return `<a${pre}href="${escAttr(val(key))}"${tagged}${post}>`
  })
  out = out.replace(/\bhref="\[\[([a-z0-9_]+)\]\]"/gi, (m, key) => `href="${escAttr(val(key))}"`)
  out = out.replace(PLACEHOLDER_RE, (m, key) => (values[key] == null || String(values[key]).trim() === '' ? (missing.add(key), m) : escHtml(values[key])))
  const unhosted = new Set()
  out = out.replace(/\bsrc="images\/([^"]+)"/gi, (m, file) => {
    if (imageUrls[file]) return `src="${escAttr(imageUrls[file])}"`
    unhosted.add(file)
    return m
  })
  return { html: out, missing: [...missing], unhosted: [...unhosted] }
}

function renderSubject(subject, values) {
  const missing = new Set()
  const text = String(subject).replace(PLACEHOLDER_RE, (m, key) => {
    const v = values[key]
    if (v == null || String(v).trim() === '') { missing.add(key); return m }
    return String(v)
  })
  return { text, missing: [...missing] }
}

// Club values: defaults, overridden per club. "{club}" in a value becomes the
// club slug, so one pattern can cover every club.
function clubValues(config, slug) {
  const merged = { ...(config.defaults || {}), ...((config.clubs || {})[slug] || {}) }
  const out = {}
  for (const [k, v] of Object.entries(merged)) out[k] = typeof v === 'string' ? v.replace(/\{club\}/g, slug) : v
  return out
}

function imageFiles(html) {
  return [...new Set([...String(html).matchAll(/\bsrc="images\/([^"]+)"/gi)].map(m => m[1]))]
}

module.exports = { emailName, pickSubject, placeholdersIn, renderEmailHtml, renderSubject, clubValues, imageFiles }
