// Shared constants for the ticketing admin UI.

export const STATUSES = [
  { key: 'open', label: 'Open', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'in_progress', label: 'In Progress', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'complete', label: 'Complete', dot: 'bg-green-500', chip: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'closed', label: 'Closed', dot: 'bg-gray-400', chip: 'bg-gray-100 text-gray-600 border-gray-200' },
]

export const STATUS_BY_KEY = Object.fromEntries(STATUSES.map(s => [s.key, s]))

export const PRIORITIES = [
  { key: 'low', label: 'Low', chip: 'bg-gray-100 text-gray-600 border-gray-200' },
  { key: 'normal', label: 'Normal', chip: 'bg-slate-100 text-slate-700 border-slate-200' },
  { key: 'high', label: 'High', chip: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'urgent', label: 'Urgent', chip: 'bg-red-50 text-red-700 border-red-200' },
]

export const PRIORITY_BY_KEY = Object.fromEntries(PRIORITIES.map(p => [p.key, p]))

// Field palette for the type builder. `input` marks fields that collect an
// answer (vs. display-only header/description).
export const FIELD_PALETTE = [
  { type: 'short_text', label: 'Short Text', input: true },
  { type: 'long_text', label: 'Long Text', input: true },
  { type: 'email', label: 'Email', input: true },
  { type: 'phone', label: 'Phone', input: true },
  { type: 'number', label: 'Number', input: true },
  { type: 'date', label: 'Date', input: true },
  { type: 'dropdown', label: 'Dropdown', input: true },
  { type: 'radio', label: 'Multiple Choice', input: true },
  { type: 'checkbox', label: 'Checkboxes', input: true },
  { type: 'file', label: 'File Upload', input: true },
  { type: 'header', label: 'Section Header', input: false },
  { type: 'description', label: 'Description Text', input: false },
  { type: 'link', label: 'Link / Download', input: false },
]

// Display-only field types collect no answer (skipped on submit + in answers).
export const DISPLAY_TYPES = ['header', 'description', 'link']

export const FIELD_LABEL = Object.fromEntries(FIELD_PALETTE.map(f => [f.type, f.label]))
export const INPUT_TYPES = FIELD_PALETTE.filter(f => f.input).map(f => f.type)
export const OPTION_TYPES = ['dropdown', 'radio', 'checkbox']

export function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' })
}

export function fmtBytes(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / (1024 * 1024)).toFixed(1) + ' MB'
}

// Generate a schema field id compatible with the backend validator (^f_[a-z0-9]{1,12}$).
export function newFieldId() {
  return 'f_' + Math.random().toString(36).slice(2, 10)
}

// Normalize a file field's value to an array — the field holds a File[], but
// tolerate a bare File from older state.
export function asFileList(v) {
  if (Array.isArray(v)) return v.filter(f => f instanceof File)
  return v instanceof File ? [v] : []
}

// Split a submit form's `values` into the JSON `data` payload and the list of
// File objects to upload after the ticket is created. File fields store their
// filenames in `data` (for the record) and their bytes go up as attachments.
export function buildSubmission(schema = [], values = {}) {
  const data = {}
  const files = []
  for (const f of schema) {
    if (DISPLAY_TYPES.includes(f.type)) continue
    const v = values[f.id]
    if (f.type === 'file') {
      const picked = asFileList(v)
      if (picked.length > 0) {
        data[f.id] = picked.map(file => file.name).join(', ')
        files.push(...picked)
      }
    } else if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)) {
      data[f.id] = v
    }
  }
  return { data, files }
}

// Turn the server's { field_id: message } validation map into one sentence that
// names the fields, so a submitter isn't left hunting for what "Validation
// failed" meant. Falls back to the raw id for fields not in the schema.
export function summarizeErrors(schema = [], errors = {}) {
  const labelById = Object.fromEntries((schema || []).map(f => [f.id, f.label || FIELD_LABEL[f.type] || f.id]))
  const parts = Object.entries(errors || {}).map(([id, msg]) => {
    const label = labelById[id] || id
    return `${label} (${String(msg || '').toLowerCase()})`
  })
  if (parts.length === 0) return ''
  return `Please fix ${parts.length === 1 ? 'this field' : `these ${parts.length} fields`}: ${parts.join(', ')}.`
}

// Client-side required check so an incomplete form names its gaps immediately,
// without a round trip. Mirrors the server's blank rule.
export function findMissingRequired(schema = [], values = {}) {
  const missing = {}
  for (const f of schema) {
    if (DISPLAY_TYPES.includes(f.type) || !f.required) continue
    const v = values[f.id]
    const blank = f.type === 'file'
      ? asFileList(v).length === 0
      : v === undefined || v === null || String(v).trim() === '' || (Array.isArray(v) && v.length === 0)
    if (blank) missing[f.id] = 'This field is required'
  }
  return missing
}
