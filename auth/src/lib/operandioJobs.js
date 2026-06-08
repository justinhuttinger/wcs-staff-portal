// ---------------------------------------------------------------------------
// Operandio per-job parsers (Phase 2).
//
// The /operandio/webhook already handles two email shapes:
//   - Daily/Weekly Activity summaries  -> operandio_location_reports
//   - Scored audits ("Overall score N M P%") -> operandio_qa_reports
//
// This module parses the two REMAINING shapes that previously fell through to
// the operandio_raw_emails staging table:
//
//   - Checklist SUBMISSION: "<Job> submitted at <Location>"
//       HTML body carries a per-task table: step #, task name,
//       "<Person> - <timestamp>", and a status cell (✓ done / Skipped / score).
//       The "Overall score" line is "0 0 %" (no possible points), which is how
//       it is distinguished from a scored audit ("370 215 58%").
//
//   - OVERDUE notice: "Overdue: <Job> at <Location>"
//       Body carries "Due by <ts>", "<X> / <Y> steps completed",
//       "Assigned to <area>", and a percent. No individual is named.
//
// "Late" is not stored — it is derived at query time: a submission whose
// (location, job_name, job_date) also has an overdue event is late.
// ---------------------------------------------------------------------------

const KNOWN_LOCATIONS = ['salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford']

// Pacific calendar date (YYYY-MM-DD) for a Date / ISO string. Clubs operate on
// Pacific local time, consistent with the rest of the app.
function pacificDate(d) {
  const date = d ? new Date(d) : new Date()
  if (isNaN(date)) return null
  return date.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// Operandio stamps look like "Jun 07, 2026 2:11PM PDT". JS needs a space before
// AM/PM to parse reliably. Returns an ISO string or null.
function parseStamp(s) {
  if (!s) return null
  const norm = s.replace(/(\d)([AP]M)\b/i, '$1 $2').trim()
  const d = new Date(norm)
  return isNaN(d) ? null : d.toISOString()
}

// "<Job> submitted at <Location>" (but NOT "Overdue: ... at ...").
function parseSubmissionSubject(subject) {
  const s = (subject || '').trim()
  if (/^overdue:/i.test(s)) return null
  const m = s.match(/^(.+?)\s+submitted at\s+(.+?)\.?$/i)
  if (!m) return null
  const slug = m[2].trim().toLowerCase()
  if (!KNOWN_LOCATIONS.includes(slug)) return null
  return { jobName: m[1].trim(), locationSlug: slug }
}

// "Overdue: <Job> at <Location>"
function parseOverdueSubject(subject) {
  const s = (subject || '').trim()
  const m = s.match(/^overdue:\s*(.+?)\s+at\s+(.+?)\.?$/i)
  if (!m) return null
  const slug = m[2].trim().toLowerCase()
  if (!KNOWN_LOCATIONS.includes(slug)) return null
  return { jobName: m[1].trim(), locationSlug: slug }
}

// Distinguishes a checklist (no possible points) from a scored audit.
// Audit: "Overall score 370 215 58%". Checklist: "Overall score 0 0 %".
function hasRealAuditScore(text) {
  return /Overall score\s+\d+\s+\d+\s+\d+%/i.test(text || '')
}

// Parse the per-task table out of a submission's HTML body.
// Returns [{ n, task, by, at, at_iso, status }] or null.
//   status: 'done' | 'skipped' | 'value'
function parseSubmissionItems(html) {
  if (!html) return null
  // Each row begins with the numbered circle div. Split on it so each block
  // holds exactly one row's task cell + status cell (status can't bleed across).
  const NUM = /<div style="background-color:#f3f3f3;[^"]*">(\d{1,3})<\/div>/
  const blocks = html.split(/(?=<div style="background-color:#f3f3f3;[^"]*">\d{1,3}<\/div>)/)
  const items = []
  for (const block of blocks) {
    const num = block.match(NUM)
    if (!num) continue
    // Task name + "<Person> - <timestamp>" in the #999 sub-div.
    const cell = block.match(
      /font-weight:500;[^>]*>\s*([\s\S]*?)<div[^>]*color:#999[^>]*>\s*([\s\S]*?)\s*-\s*([A-Z][a-z]{2} \d{1,2}, \d{4}[^<]*?)\s*<\/div>/
    )
    if (!cell) continue
    const task = cell[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    const by = cell[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
    const at = cell[3].trim()
    // Status cell follows the task cell.
    const after = block.slice(cell.index + cell[0].length)
    let status = 'done'
    if (/Skipped/i.test(after)) status = 'skipped'
    else if (/✓|&#10003;|&#x2713;|#18CE99/.test(after)) status = 'done'
    else if (/<span[^>]*>\s*\d{1,3}\s*<\/span>/.test(after)) status = 'value'
    items.push({ n: parseInt(num[1], 10), task, by: by || null, at, at_iso: parseStamp(at), status })
  }
  return items.length ? items : null
}

// Parse overdue details from the email. Prefers plain text, falls back to a
// stripped HTML rendering. Returns { due_by, due_by_iso, steps_completed,
// steps_total, percent, assigned_area } (any field may be null).
function stripHtml(html) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseOverdueDetails(text, html) {
  const body = ((text && text.trim()) ? text : '') + ' ' + stripHtml(html)
  const flat = body.replace(/\s+/g, ' ')
  const due = flat.match(/Due by\s+([A-Z][a-z]{2} \d{1,2}, \d{4} \d{1,2}:\d{2}\s*[AP]M [A-Z]{2,4})/i)
  const steps = flat.match(/(\d+)\s*\/\s*(\d+)\s*steps completed/i)
  const pct = flat.match(/(\d{1,3})%/)
  const area = flat.match(/Assigned to\s+([A-Za-z0-9 &/.'-]+?)\s*[.<]/i)
  const dueRaw = due ? due[1].trim() : null
  return {
    due_by: dueRaw,
    due_by_iso: parseStamp(dueRaw),
    steps_completed: steps ? parseInt(steps[1], 10) : null,
    steps_total: steps ? parseInt(steps[2], 10) : null,
    percent: pct ? parseInt(pct[1], 10) : null,
    assigned_area: area ? area[1].trim().replace(/\s+/g, ' ') : null,
  }
}

// Classify an email into a job event (or null if it's neither shape / is a
// scored audit, which is handled elsewhere). `receivedAt` anchors job_date.
function classifyJobEmail({ subject, text, html, receivedAt }) {
  const overdue = parseOverdueSubject(subject)
  if (overdue) {
    const d = parseOverdueDetails(text, html)
    const jobDate = pacificDate(d.due_by_iso || receivedAt)
    return {
      kind: 'overdue',
      event: {
        location_slug: overdue.locationSlug,
        job_name: overdue.jobName,
        event_type: 'overdue',
        occurred_at: receivedAt ? new Date(receivedAt).toISOString() : null,
        job_date: jobDate,
        due_by: d.due_by_iso,
        steps_completed: d.steps_completed,
        steps_total: d.steps_total,
        percent: d.percent,
        assigned_area: d.assigned_area,
        submitted_by: null,
      },
      items: null,
    }
  }

  const submission = parseSubmissionSubject(subject)
  if (submission && !hasRealAuditScore(text)) {
    const items = parseSubmissionItems(html) || []
    const done = items.filter(i => i.status !== 'skipped').length
    // Primary completer = whoever did the most rows (single-person checklists
    // are the norm; multi-person ones still get a sensible headline name).
    const byCount = {}
    let primary = null, primaryN = 0
    for (const it of items) {
      if (!it.by) continue
      byCount[it.by] = (byCount[it.by] || 0) + 1
      if (byCount[it.by] > primaryN) { primaryN = byCount[it.by]; primary = it.by }
    }
    const latest = items.map(i => i.at_iso).filter(Boolean).sort().pop()
    return {
      kind: 'submitted',
      event: {
        location_slug: submission.locationSlug,
        job_name: submission.jobName,
        event_type: 'submitted',
        occurred_at: receivedAt ? new Date(receivedAt).toISOString() : null,
        job_date: pacificDate(latest || receivedAt),
        due_by: null,
        steps_completed: done,
        steps_total: items.length || null,
        percent: items.length ? Math.round((done / items.length) * 100) : null,
        assigned_area: null,
        submitted_by: primary,
      },
      items,
    }
  }

  return null
}

// Persist a classified job email into operandio_job_events (+ its task
// completions for submissions). Upserts the event on its natural key so
// retries / repeat overdue reminders collapse to one row, then replaces the
// child task rows. Returns { kind, event_id } or null if nothing to store.
async function persistJobEmail(supabaseAdmin, classified, rawEmailId) {
  if (!classified) return null
  const ev = { ...classified.event, raw_email_id: rawEmailId || null }

  const { data: row, error } = await supabaseAdmin
    .from('operandio_job_events')
    .upsert(ev, { onConflict: 'location_slug,job_name,job_date,event_type' })
    .select('id')
    .single()
  if (error) throw error
  const eventId = row.id

  if (classified.kind === 'submitted') {
    // Replace task rows for this event so re-sends don't duplicate.
    await supabaseAdmin.from('operandio_task_completions').delete().eq('job_event_id', eventId)
    const rows = (classified.items || []).map(it => ({
      job_event_id: eventId,
      location_slug: ev.location_slug,
      job_name: ev.job_name,
      job_date: ev.job_date,
      step_n: it.n,
      task_name: it.task,
      completed_by: it.by,
      completed_at: it.at_iso,
      status: it.status,
    }))
    if (rows.length) {
      const { error: tErr } = await supabaseAdmin.from('operandio_task_completions').insert(rows)
      if (tErr) throw tErr
    }
  }

  return { kind: classified.kind, event_id: eventId }
}

module.exports = {
  KNOWN_LOCATIONS,
  pacificDate,
  parseStamp,
  parseSubmissionSubject,
  parseOverdueSubject,
  hasRealAuditScore,
  parseSubmissionItems,
  parseOverdueDetails,
  classifyJobEmail,
  persistJobEmail,
}
