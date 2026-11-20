// Voicemail drop recordings in GHL workflows.
//
// A voicemail step stores its audio as attributes.attachment
// { url, name, size }, where url is a Google Storage file under the club's own
// location and workflow, e.g.
//   https://storage.googleapis.com/<bucket>/location/<locId>/workflow/<wfId>/<file>.mp3?alt=media&token=...
// Two consequences for copying workflows between clubs:
//   1. The ids in that path are part of the file's address. Rewriting them to
//      the target club's ids points at a file that does not exist (404), so the
//      drop plays nothing. File URLs must never be remapped.
//   2. Each club records its own voicemails (club name, staff voice). On an
//      overwrite the club keeps its own recording for the same branch; the
//      source's recording is only used where the club has none that works.

const FILE_URL = /^https:\/\/(storage|firebasestorage)\.googleapis\.com\//i

function isFileUrl(s) {
  return typeof s === 'string' && FILE_URL.test(s)
}

// If/else node names that say nothing about which branch this is.
const GENERIC = new Set(['yes', 'no', 'none', 'else', 'branch', 'no answer', 'answered', ''])

function templatesOf(workflow) {
  const t = workflow?.workflowData?.templates
  return Array.isArray(t) ? t : []
}

// Identifies each voicemail step by the named if/else branches above it,
// e.g. "new lead 2" or "trial expired 3". Steps sharing a path get #2, #3 by
// order. Returns Map(stepId -> key).
function voicemailKeys(templates) {
  const byId = new Map(templates.map(t => [t.id, t]))
  const seen = new Map()
  const keys = new Map()
  const steps = templates.filter(t => t.type === 'voicemail')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const step of steps) {
    const names = []
    let cur = byId.get(step.parentKey)
    for (let guard = 0; cur && guard < 200; guard++) {
      const n = String(cur.name || '').trim().toLowerCase()
      if (cur.type === 'if_else' && !GENERIC.has(n)) names.unshift(n)
      cur = byId.get(cur.parentKey)
    }
    const base = names.join(' > ') || '(top level)'
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    keys.set(step.id, n === 1 ? base : `${base} #${n}`)
  }
  return keys
}

// Map(key -> attachment) of a workflow's voicemail recordings.
function recordingsByKey(workflow) {
  const templates = templatesOf(workflow)
  const keys = voicemailKeys(templates)
  const out = new Map()
  for (const t of templates) {
    const att = t.type === 'voicemail' ? t.attributes?.attachment : null
    if (att?.url && keys.has(t.id)) out.set(keys.get(t.id), att)
  }
  return out
}

// Gives each voicemail step in `workflow` (already remapped for the target)
// the target club's own recording for the same branch. `candidates` are the
// club's versions of this workflow, best first: [{ label, workflow }].
// A candidate recording is used only if `isAlive(url)` resolves true.
// Mutates `workflow`; returns [{ key, step, name, from }] where `from` is the
// candidate label or 'source' when the copied recording was kept.
async function keepClubRecordings(workflow, candidates, isAlive) {
  const templates = templatesOf(workflow)
  const keys = voicemailKeys(templates)
  const pools = candidates.map(c => ({ label: c.label, recs: recordingsByKey(c.workflow) }))
  const report = []
  for (const step of templates) {
    if (step.type !== 'voicemail' || !keys.has(step.id)) continue
    const key = keys.get(step.id)
    let picked = null
    for (const pool of pools) {
      const att = pool.recs.get(key)
      if (att?.url && await isAlive(att.url)) { picked = { att, from: pool.label }; break }
    }
    if (picked) {
      step.attributes = { ...(step.attributes || {}), attachment: { ...picked.att } }
    }
    report.push({
      key,
      step: step.name || 'Voicemail',
      name: (picked ? picked.att.name : step.attributes?.attachment?.name) || '',
      from: picked ? picked.from : 'source',
    })
  }
  return report
}

// True when the file answers 2xx. Cached per URL for the life of the process
// call site (pass a fresh Map per request).
function makeIsAlive(fetchImpl = fetch, cache = new Map(), timeoutMs = 6000) {
  return async (url) => {
    if (!isFileUrl(url)) return false
    if (cache.has(url)) return cache.get(url)
    let ok = false
    try {
      const r = await fetchImpl(url, { headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(timeoutMs) })
      ok = r.status >= 200 && r.status < 300
    } catch { ok = false }
    cache.set(url, ok)
    return ok
  }
}

module.exports = { isFileUrl, voicemailKeys, recordingsByKey, keepClubRecordings, makeIsAlive }
