// Finds, labels and swaps the links inside GHL custom values: plain URLs in
// SMS copy and call scripts, and href links in email HTML. Used by Workflows &
// Scripts so a link (e.g. a club's tour booking page) can be changed in every
// message that uses it.
//
// Email HTML pushed from the workflow email series tags each link with
// data-wcs-link="<key>" (tour_booking_link, day_one_link, ...), which names it
// exactly. Everything else is named by recognising the URL.

// What a link is, from its URL, for links with no data-wcs-link tag.
const URL_LABELS = [
  { test: /widget\/bookings\/[^/?#\s]*tour/i, key: 'tour_booking_link', label: 'Tour booking' },
  { test: /join\.westcoaststrength\.com\/[^?#\s]+\?\S+/i, key: 'join_offer_link', label: 'Join (with offer)' },
  { test: /join\.westcoaststrength\.com/i, key: 'join_link', label: 'Online join' },
  { test: /book\.westcoaststrength\.com|day-?one/i, key: 'day_one_link', label: 'Day One booking' },
  { test: /vip\./i, key: 'vip_link', label: 'VIP referral' },
  { test: /g\.page|google\.com\/maps|search\.google|writereview|review/i, key: 'review_link', label: 'Review' },
  { test: /widget\/bookings\//i, key: 'booking_link', label: 'Booking page' },
]

export const KEY_LABELS = {
  tour_booking_link: 'Tour booking',
  one_month_free_link: 'Join: 1 month free',
  half_off_link: 'Join: 50% off first month',
  day_one_link: 'Day One booking',
  vip_link: 'VIP referral',
  join_link: 'Online join',
  join_offer_link: 'Join (with offer)',
  review_link: 'Review',
  booking_link: 'Booking page',
}

export function labelForUrl(url) {
  const hit = URL_LABELS.find(r => r.test.test(url))
  return hit ? { key: hit.key, label: hit.label } : { key: null, label: 'Link' }
}

// Bare domains count ("api.westcoaststrength.com/widget/...") because that's
// how several texts are written. Stops at whitespace, quotes and brackets, and
// drops trailing sentence punctuation.
const TEXT_URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|space|me|ly|gl|app|page)(?:\/[^\s<>"'()]*)?/gi

function trimUrl(u) {
  return u.replace(/[.,!?;:]+$/, '')
}

export function isHtmlValue(value) {
  return /<(html|body|table|a)\b/i.test(value || '')
}

const decodeAmp = (s) => s.replace(/&amp;/g, '&')

// Every link in a value: [{ url, key, label, text }] in order of appearance,
// one entry per distinct URL.
export function findLinks(value) {
  const v = value || ''
  const seen = new Map()
  const add = (url, key, text) => {
    if (!url || /^(mailto:|tel:|#|\{\{)/i.test(url)) return
    const named = key ? { key, label: KEY_LABELS[key] || key } : labelForUrl(url)
    const prev = seen.get(url)
    if (prev) {
      if (text && !prev.texts.includes(text)) prev.texts.push(text)
      return
    }
    seen.set(url, { url, key: named.key, label: named.label, texts: text ? [text] : [] })
  }
  if (isHtmlValue(v)) {
    const A_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    let m
    while ((m = A_RE.exec(v))) {
      const attrs = m[1]
      const href = attrs.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1]
      const key = attrs.match(/\bdata-wcs-link\s*=\s*"([^"]*)"/i)?.[1] || null
      const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (href) add(decodeAmp(href.trim()), key, text)
    }
    // Outlook's VML button carries the same URL in <v:rect href="...">.
    const VML_RE = /<v:[a-z]+\b[^>]*\bhref\s*=\s*"([^"]*)"/gi
    while ((m = VML_RE.exec(v))) add(decodeAmp(m[1].trim()), null, '')
  } else {
    for (const raw of v.match(TEXT_URL_RE) || []) add(trimUrl(raw), null, '')
  }
  return [...seen.values()]
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Replace one URL with another everywhere it appears in a value. The match
// must end at a URL boundary (end, space, quote, bracket, or sentence
// punctuation followed by one), so changing ".../salem" leaves
// ".../salem?promo=x" alone. In HTML both the raw and &amp;-encoded forms are
// replaced (hrefs, the VML button, any visible copy of the link).
export function replaceLink(value, oldUrl, newUrl) {
  if (!oldUrl || oldUrl === newUrl) return value
  // Not in the middle of a longer URL ("api.x.com" inside "https://api.x.com").
  const head = '(?<![\\w/.:-])'
  const tail = '(?=[.,!?;:]*(?:$|[\\s<>"\'()]))'
  let out = value.replace(new RegExp(head + escapeRe(oldUrl) + tail, 'g'), () => newUrl)
  if (isHtmlValue(value) && oldUrl.includes('&')) {
    const enc = oldUrl.replace(/&/g, '&amp;')
    out = out.replace(new RegExp(head + escapeRe(enc) + tail, 'g'), () => newUrl.replace(/&/g, '&amp;'))
  }
  return out
}

// All links across a club's custom values, grouped by URL:
// [{ url, variants, key, label, texts, uses: [{ id, name, url }] }], most used
// first. The same page written with and without "https://" or "www." (texts
// often drop it, email hrefs never do) counts as one link; each use keeps the
// exact form it was written in so it can be replaced.
export function linkIdentity(url) {
  return url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase()
}

export function collectClubLinks(customValues) {
  const byId = new Map()
  for (const cv of customValues || []) {
    for (const l of findLinks(cv.value)) {
      const id = linkIdentity(l.url)
      const cur = byId.get(id) || { ...l, variants: [], texts: [], uses: [] }
      // Show the full https form when any message has it.
      if (/^https?:/i.test(l.url) && !/^https?:/i.test(cur.url)) cur.url = l.url
      if (!cur.variants.includes(l.url)) cur.variants.push(l.url)
      if (!cur.key && l.key) { cur.key = l.key; cur.label = l.label }
      for (const t of l.texts) if (!cur.texts.includes(t)) cur.texts.push(t)
      if (!cur.uses.some(u => u.id === cv.id)) cur.uses.push({ id: cv.id, name: cv.name, url: l.url })
      byId.set(id, cur)
    }
  }
  return [...byId.values()].sort((a, b) => b.uses.length - a.uses.length || a.label.localeCompare(b.label))
}

// Email custom values are named "<Name> Subject", "<Name> Preview" and
// "<Name> HTML", where the name includes the word Email ("New Lead Email 1
// Subject"). Every email in the club shares the sender values "Email From
// Name" and "Email From Address". Returns { pairs: [{ base, subject, preview,
// html }] sorted by name, sender: { name, address }, ids }, where ids holds
// every value that belongs to the emails (so the texts list leaves them out).
const EMAIL_SUFFIX_RE = /^(.*\bemail\b.*?)\s+(subject|html|preview)$/i
const SENDER_NAMES = { 'email from name': 'name', 'email from address': 'address' }

export function emailPairs(customValues) {
  const byBase = new Map()
  const sender = { name: null, address: null }
  for (const cv of customValues || []) {
    const senderKey = SENDER_NAMES[(cv.name || '').trim().toLowerCase()]
    if (senderKey) { sender[senderKey] = cv; continue }
    const m = (cv.name || '').match(EMAIL_SUFFIX_RE)
    if (!m) continue
    const base = m[1].trim()
    const pair = byBase.get(base.toLowerCase()) || { base, subject: null, preview: null, html: null }
    pair[m[2].toLowerCase()] = cv
    byBase.set(base.toLowerCase(), pair)
  }
  const pairs = [...byBase.values()].sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }))
  const ids = new Set([
    ...pairs.flatMap(p => [p.subject?.id, p.preview?.id, p.html?.id]),
    sender.name?.id, sender.address?.id,
  ].filter(Boolean))
  return { pairs, sender, ids }
}

// The email's hidden preheader (the inbox preview line) is the text at the
// start of a display:none div styled mso-hide:all, before its zero-width
// padding. Swap it so the HTML matches the "<Name> Preview" value.
export function setPreheader(html, text) {
  const esc = String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return html.replace(/(<div\b[^>]*mso-hide:\s*all[^>]*>)([^<&]*)/i, (m, open) => open + esc)
}
