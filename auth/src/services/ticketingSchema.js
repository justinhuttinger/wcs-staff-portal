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

function makeSlug(name) {
  const base = String(name || 'ticket').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'ticket'
  return base
}

module.exports = {
  FIELD_TYPES,
  INPUT_TYPES,
  DISPLAY_TYPES,
  OPTION_TYPES,
  validateSchema,
  validateSubmission,
  deriveTitle,
  makeSlug,
}
