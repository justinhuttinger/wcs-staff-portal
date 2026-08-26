// Field-schema helpers for the ticketing module. A ticket *type* carries a
// schema: an ordered array of field definitions, the same shape the Form
// Builder uses (see services/formsSchema.js). Kept as its own module so the two
// tools can diverge (ticketing may grow priority/assignment-aware fields).

// Display-only fields collect no answer. 'link' renders a clickable link/button
// (e.g. a downloadable PDF the submitter prints, fills out, and re-uploads via a
// file field). It carries a `label` (link text) and an http(s) `url`.
const DISPLAY_TYPES = ['header', 'description', 'link']
// 'file' collects an attachment. Its value in `data` is the uploaded file's
// name (a string, for the record); the bytes are stored as a ticket attachment
// tagged with the field id.
const INPUT_TYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'dropdown', 'radio', 'checkbox', 'date', 'file']
const FIELD_TYPES = [...INPUT_TYPES, ...DISPLAY_TYPES]
const OPTION_TYPES = ['dropdown', 'radio', 'checkbox']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Validate the stored schema of a ticket type (admin-authored, so errors are
// developer/admin facing).
function validateSchema(schema) {
  if (!Array.isArray(schema)) return { ok: false, error: 'schema must be an array' }
  const seen = new Set()
  for (const f of schema) {
    if (!f || typeof f !== 'object') return { ok: false, error: 'field must be an object' }
    if (typeof f.id !== 'string' || !/^f_[a-z0-9]{1,12}$/i.test(f.id)) {
      return { ok: false, error: `invalid field id: ${f.id}` }
    }
    if (seen.has(f.id)) return { ok: false, error: `duplicate field id: ${f.id}` }
    seen.add(f.id)
    if (!FIELD_TYPES.includes(f.type)) return { ok: false, error: `invalid field type: ${f.type}` }
    const isDisplay = DISPLAY_TYPES.includes(f.type)
    if (!isDisplay && (typeof f.label !== 'string' || !f.label.trim())) {
      return { ok: false, error: `field ${f.id} needs a label` }
    }
    if (OPTION_TYPES.includes(f.type)) {
      const opts = f.options
      if (!Array.isArray(opts) || opts.length === 0 || opts.some(o => typeof o !== 'string' || !o.trim())) {
        return { ok: false, error: `field ${f.id} needs at least one option` }
      }
    }
    if (f.type === 'link') {
      if (typeof f.label !== 'string' || !f.label.trim()) {
        return { ok: false, error: `link field ${f.id} needs link text` }
      }
      const url = typeof f.url === 'string' ? f.url.trim() : ''
      if (!/^https?:\/\/.+/i.test(url)) {
        return { ok: false, error: `link field ${f.id} needs a valid http(s) URL` }
      }
    }
  }
  return { ok: true }
}

function isBlank(v) {
  return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)
}

// Validate + normalize a submitter's answers against a type schema. Returns
// { ok, errors, cleaned } — cleaned is the sanitized data to persist.
function validateSubmission(schema, data) {
  const errors = {}
  const cleaned = {}
  const body = data && typeof data === 'object' ? data : {}
  const inputs = (schema || []).filter(f => INPUT_TYPES.includes(f.type))
  const known = new Set(inputs.map(f => f.id))

  for (const key of Object.keys(body)) {
    if (!known.has(key)) errors[key] = 'Unknown field'
  }

  for (const f of inputs) {
    const raw = body[f.id]
    if (isBlank(raw)) {
      if (f.required) errors[f.id] = 'This field is required'
      continue
    }
    if (f.type === 'checkbox') {
      const arr = Array.isArray(raw) ? raw.map(String) : [String(raw)]
      if (arr.some(v => !f.options.includes(v))) { errors[f.id] = 'Invalid selection'; continue }
      cleaned[f.id] = arr
      continue
    }
    const v = String(raw).trim()
    if (v.length > 5000) { errors[f.id] = 'Too long'; continue }
    switch (f.type) {
      case 'email':
        if (!EMAIL_RE.test(v)) { errors[f.id] = 'Enter a valid email address'; continue }
        break
      case 'phone': {
        const digits = v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
        if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) {
          errors[f.id] = 'Enter a valid 10-digit phone number'; continue
        }
        cleaned[f.id] = `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
        continue
      }
      case 'number':
        if (!Number.isFinite(Number(v))) { errors[f.id] = 'Enter a number'; continue }
        break
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) { errors[f.id] = 'Enter a valid date'; continue }
        break
      case 'dropdown':
      case 'radio':
        if (!f.options.includes(v)) { errors[f.id] = 'Invalid selection'; continue }
        break
    }
    cleaned[f.id] = v
  }
  return { ok: Object.keys(errors).length === 0, errors, cleaned }
}

// Build a human title for a ticket from its answers: first non-blank short_text
// / long_text value, else the type name. Keeps the inbox readable without
// forcing a dedicated "subject" field.
function deriveTitle(schema, data, fallback) {
  const inputs = (schema || []).filter(f => ['short_text', 'long_text'].includes(f.type))
  for (const f of inputs) {
    const v = data?.[f.id]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 140)
  }
  return (fallback || 'Ticket').slice(0, 140)
}

// A type can define its own title as literal words plus {{field_id}} tokens,
// e.g. "Ticket for {{f_a1b2c3}}". Tokens pull from the submitted answers;
// anything unfilled renders empty and the leftover whitespace is collapsed.
// A template that renders to nothing falls back to the derived title, so a
// half-filled form still lands with a usable title.
const TITLE_TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function renderTitle(template, schema, data, fallback) {
  const tpl = typeof template === 'string' ? template.trim() : ''
  if (!tpl) return deriveTitle(schema, data, fallback)

  let tokens = 0
  let filled = 0
  const rendered = tpl.replace(TITLE_TOKEN_RE, (_, id) => {
    tokens++
    const v = data?.[id]
    if (v === undefined || v === null) return ''
    const text = Array.isArray(v) ? v.join(', ') : String(v)
    if (text.trim()) filled++
    return text
  })

  // A template whose fields are all blank would leave only its scaffolding
  // ("Ticket for"), so fall back to the derived title instead.
  if (tokens > 0 && filled === 0) return deriveTitle(schema, data, fallback)

  // Collapse the gaps left by empty tokens, and trim stray separators.
  const cleaned = rendered
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;:.])/g, '$1')
    .replace(/[\s\-—–,;:]+$/, '')
    .trim()
  if (!cleaned) return deriveTitle(schema, data, fallback)
  return cleaned.slice(0, 140)
}

// Field ids referenced by a title template, so the builder can be told when a
// template points at a field that no longer exists.
function titleTemplateTokens(template) {
  const out = []
  const tpl = typeof template === 'string' ? template : ''
  for (const m of tpl.matchAll(TITLE_TOKEN_RE)) out.push(m[1])
  return [...new Set(out)]
}

function makeSlug(name) {
  const base = String(name || 'ticket').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ticket'
  return base
}

// The submit form writes the ticket row before uploading its attachments, so a
// failed upload leaves a real ticket behind and the user retries. Given the id
// of that first attempt, decide whether the retry may refresh it in place
// rather than inserting a duplicate.
//
// Deliberately narrow: only the submitter's own ticket, only the same type, and
// only while still untouched ('open'). A handler who has already picked the
// ticket up, or a stray/foreign id, falls through to a normal insert — better a
// duplicate than one person's retry silently rewriting another's ticket.
function canReuseTicket(prior, { staffId, typeId } = {}) {
  if (!prior || !staffId || !typeId) return false
  return prior.submitter_id === staffId
    && prior.type_id === typeId
    && prior.status === 'open'
}

module.exports = {
  FIELD_TYPES,
  canReuseTicket,
  INPUT_TYPES,
  DISPLAY_TYPES,
  OPTION_TYPES,
  validateSchema,
  validateSubmission,
  deriveTitle,
  renderTitle,
  titleTemplateTokens,
  makeSlug,
}
