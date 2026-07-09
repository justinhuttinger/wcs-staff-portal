const { INPUT_TYPES } = require('./formsSchema')

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files'
const TAB = 'Submissions'

// Lazy-require: services/supabase creates the client at import time and throws
// without env vars, so pull it in only when a function actually needs it
// (matches middleware/role.js). Keeps `node --test` running on the pure funcs.
function db() {
  return require('./supabase').supabaseAdmin
}

async function googleJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { _raw: text } }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${body.error?.message || body._raw || res.status}`)
  return body
}

function inputFields(schema) {
  return (schema || []).filter(f => INPUT_TYPES.includes(f.type))
}

// Column 1 is always Submitted At. Existing field->column mappings are never
// changed or reused; new fields append after the current max. This is what
// keeps historical Sheet rows aligned when the form changes.
function computeColumns(schema, existing = {}) {
  const cols = { ...existing }
  let max = Math.max(1, ...Object.values(cols))
  for (const f of inputFields(schema)) {
    if (!cols[f.id]) { max += 1; cols[f.id] = max }
  }
  return cols
}

function buildHeaderRow(schema, columns) {
  const labels = {}
  for (const f of inputFields(schema)) labels[f.id] = f.label
  const max = Math.max(1, ...Object.values(columns))
  const row = new Array(max).fill('')
  row[0] = 'Submitted At'
  for (const [fieldId, col] of Object.entries(columns)) {
    row[col - 1] = labels[fieldId] || row[col - 1] || ''
  }
  return row
}

function buildRowValues(columns, cleaned, submittedAtPacific) {
  const max = Math.max(1, ...Object.values(columns))
  const row = new Array(max).fill('')
  row[0] = submittedAtPacific
  for (const [fieldId, col] of Object.entries(columns)) {
    const v = cleaned[fieldId]
    if (v == null) continue
    row[col - 1] = Array.isArray(v) ? v.join(', ') : v
  }
  return row
}

function pacificTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((m, p) => (m[p.type] = p.value, m), {})
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`
}

async function getFolderId() {
  const { data } = await db().from('app_config').select('value').eq('key', 'forms_drive_folder_id').maybeSingle()
  return data?.value || null
}

async function getToken() {
  // Lazy require: routes/googleBusiness exports getAccessToken (Business
  // account OAuth, refresh token in app_config.google_business_tokens).
  const { getAccessToken } = require('../routes/googleBusiness')
  return getAccessToken()
}

function colLetter(n) {
  let s = ''
  while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) }
  return s
}

// First publish: create the spreadsheet, move it into the configured shared
// drive folder (supportsAllDrives is REQUIRED for shared drives), write the
// header row. Republish after schema changes: append headers for new columns
// only. Persists sheet_id / sheet_tab / sheet_columns on the form row.
async function ensureSheet(form) {
  const token = await getToken()
  let { sheet_id, sheet_tab } = form
  const columns = computeColumns(form.schema, form.sheet_columns || {})

  if (!sheet_id) {
    const create = await googleJson(SHEETS_BASE, token, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: form.title },
        sheets: [{ properties: { sheetId: 0, title: TAB, gridProperties: { frozenRowCount: 1 } } }],
      }),
    })
    sheet_id = create.spreadsheetId
    sheet_tab = TAB
    const folderId = await getFolderId()
    if (folderId) {
      const meta = await googleJson(`${DRIVE_BASE}/${sheet_id}?fields=parents&supportsAllDrives=true`, token)
      const params = new URLSearchParams({ addParents: folderId, supportsAllDrives: 'true' })
      const removeParents = (meta.parents || []).join(',')
      if (removeParents) params.set('removeParents', removeParents)
      await googleJson(`${DRIVE_BASE}/${sheet_id}?${params}`, token, { method: 'PATCH', body: JSON.stringify({}) })
    }
    const header = buildHeaderRow(form.schema, columns)
    await googleJson(
      `${SHEETS_BASE}/${sheet_id}/values/${encodeURIComponent(`${sheet_tab}!A1:${colLetter(header.length)}1`)}?valueInputOption=RAW`,
      token,
      { method: 'PUT', body: JSON.stringify({ values: [header] }) }
    )
  } else {
    // Write headers for any newly appended columns (label edits also land here).
    const header = buildHeaderRow(form.schema, columns)
    const prevMax = Math.max(1, ...Object.values(form.sheet_columns || {}))
    const newMax = header.length
    if (newMax >= prevMax) {
      await googleJson(
        `${SHEETS_BASE}/${sheet_id}/values/${encodeURIComponent(`${sheet_tab}!A1:${colLetter(newMax)}1`)}?valueInputOption=RAW`,
        token,
        { method: 'PUT', body: JSON.stringify({ values: [header] }) }
      )
    }
  }

  const { error } = await db().from('forms')
    .update({ sheet_id, sheet_tab, sheet_columns: columns })
    .eq('id', form.id)
  if (error) throw error
  return { sheet_id, sheet_tab, sheet_columns: columns }
}

async function appendSubmission(form, submission) {
  try {
    const token = await getToken()
    // Column-drift guard: if this submission carries a field id that isn't yet
    // in the sheet's column map (schema changed after the last ensureSheet),
    // create/extend the sheet now and use its fresh column map for the row.
    let columns = form.sheet_columns || {}
    const missing = Object.keys(submission.data || {}).some(fieldId => !columns[fieldId])
    if (missing) {
      const ensured = await ensureSheet(form)
      columns = ensured.sheet_columns
    }
    const row = buildRowValues(columns, submission.data, pacificTimestamp(new Date(submission.submitted_at)))
    await googleJson(
      `${SHEETS_BASE}/${form.sheet_id}/values/${encodeURIComponent(`${form.sheet_tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      token,
      { method: 'POST', body: JSON.stringify({ values: [row] }) }
    )
    await db().from('form_submissions')
      .update({ synced_to_sheet: true, sync_error: null }).eq('id', submission.id)
  } catch (err) {
    await db().from('form_submissions')
      .update({ sync_error: String(err.message).slice(0, 500) }).eq('id', submission.id)
    throw err
  }
}

// Re-append every unsynced submission for one form, oldest first.
async function retryFormSync(formId) {
  let { data: form } = await db().from('forms').select('*').eq('id', formId).single()
  if (!form) return { retried: 0, failed: 0 }
  // Self-heal: a published form whose sheet creation failed at publish time has
  // sheet_id=null. Create the sheet now, then re-read the fresh row so the
  // re-append loop below uses the new sheet_id and sheet_columns.
  if (!form.sheet_id) {
    if (form.status !== 'published') return { retried: 0, failed: 0 }
    await ensureSheet(form)
    const { data: fresh } = await db().from('forms').select('*').eq('id', formId).single()
    if (!fresh || !fresh.sheet_id) return { retried: 0, failed: 0 }
    form = fresh
  }
  const { data: rows } = await db().from('form_submissions')
    .select('*').eq('form_id', formId).eq('synced_to_sheet', false)
    .order('submitted_at', { ascending: true }).limit(200)
  let retried = 0, failed = 0
  for (const sub of rows || []) {
    try { await appendSubmission(form, sub); retried++ } catch { failed++; break }
  }
  return { retried, failed }
}

// Background sweep: every 10 minutes retry all forms with unsynced rows.
function start() {
  if (process.env.FORMS_SHEETS_DISABLED === '1') return
  const sweep = async () => {
    try {
      const { data } = await db().from('form_submissions')
        .select('form_id').eq('synced_to_sheet', false).limit(500)
      const formIds = [...new Set((data || []).map(r => r.form_id))]
      for (const id of formIds) {
        const { retried, failed } = await retryFormSync(id)
        if (retried || failed) {
          console.log(`[formsSheets] retry form ${id}: ${retried} synced, ${failed} failed`)
          const formsAudit = require('./formsAudit')
          formsAudit.record(id, null, 'sheet_retry', { retried, failed })
        }
      }
    } catch (err) {
      console.error('[formsSheets] sweep failed:', err.message)
    }
  }
  setInterval(sweep, 10 * 60 * 1000).unref()
}

module.exports = {
  computeColumns, buildHeaderRow, buildRowValues, pacificTimestamp,
  ensureSheet, appendSubmission, retryFormSync, start,
}
