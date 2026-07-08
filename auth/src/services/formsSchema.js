const crypto = require('crypto')

// Single-point registry: adding file-upload/signature later means adding a
// type here plus a renderer case. Do not add them now.
const DISPLAY_TYPES = ['header', 'description']
const INPUT_TYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'dropdown', 'radio', 'checkbox', 'date']
const FIELD_TYPES = [...INPUT_TYPES, ...DISPLAY_TYPES]
const OPTION_TYPES = ['dropdown', 'radio', 'checkbox']

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

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
  }
  return { ok: true }
}

function isBlank(v) {
  return v == null || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && v.length === 0)
}

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
        const digits = v.replace(/\D/g, '')
        if (digits.length < 7 || digits.length > 15) { errors[f.id] = 'Enter a valid phone number'; continue }
        break
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

function makeSlug(title) {
  const base = String(title || 'form').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'form'
  const suffix = crypto.randomBytes(3).readUIntBE(0, 3).toString(36).padStart(4, '0').slice(-4)
  return `${base}-${suffix}`
}

module.exports = { FIELD_TYPES, INPUT_TYPES, OPTION_TYPES, DISPLAY_TYPES, validateSchema, validateSubmission, makeSlug }
