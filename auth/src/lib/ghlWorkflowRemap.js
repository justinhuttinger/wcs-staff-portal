// Remapping a GHL workflow from one sub-account to another.
//
// A workflow definition references location-scoped records by ID: custom
// fields in conditions, users in assign actions, calendars, pipelines and
// stages, forms, surveys, other workflows (add/remove from workflow), tags.
// Those IDs mean nothing in another sub-account, so before a copy is written
// we swap every source ID for the target record with the same identity
// (custom field key, user email, or name).
//
// The walk is schema-agnostic on purpose: GHL's builder JSON has dozens of
// action shapes and changes without notice. Instead of knowing where IDs live,
// we replace any known source ID wherever it appears, in values or object
// keys, whole or embedded in a longer string. Record IDs are 20+ character
// random strings, so an accidental substring hit is not a practical risk.
// Step IDs (UUIDs) are workflow-internal and never in the catalog, so they are
// left alone.

// Category -> how a record is identified across sub-accounts.
const CATEGORIES = {
  customFields: { label: 'Custom field', key: r => r.fieldKey || r.name },
  customValues: { label: 'Custom value', key: r => r.name },
  tags: { label: 'Tag', key: r => r.name },
  users: { label: 'User', key: r => r.email || r.name },
  calendars: { label: 'Calendar', key: r => r.name },
  pipelines: { label: 'Pipeline', key: r => r.name },
  stages: { label: 'Pipeline stage', key: r => r.name },
  forms: { label: 'Form', key: r => r.name },
  surveys: { label: 'Survey', key: r => r.name },
  workflows: { label: 'Workflow', key: r => r.name },
}

const norm = s => String(s || '').trim().toLowerCase()

// Records are often named after their club ("Salem Gym Tour" in Salem is
// "Keizer Gym Tour" in Keizer), so each side's own club names are dropped
// before comparing.
function keyer(aliases) {
  const words = (aliases || []).map(norm).filter(Boolean).sort((a, b) => b.length - a.length)
  return (s) => {
    let k = norm(s)
    for (const w of words) k = k.split(w).join(' ')
    return k.replace(/\s+/g, ' ').trim()
  }
}

// Builds { srcId: { category, label, name, targetId|null } } from two
// catalogs of the shape { [category]: [{ id, name, ... }] | null }. A null
// category means it could not be loaded for that location. `opts` carries
// each side's club names (sourceAliases / targetAliases).
function buildIdMap(source, target, opts = {}) {
  const srcKey = keyer(opts.sourceAliases)
  const tgtKey = keyer(opts.targetAliases)
  const map = new Map()
  const unavailable = []
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    const src = source?.[cat]
    const tgt = target?.[cat]
    if (!Array.isArray(src)) { if (src === null) unavailable.push({ category: cat, side: 'source' }); continue }
    if (!Array.isArray(tgt) && tgt === null) unavailable.push({ category: cat, side: 'target' })
    const byKey = new Map()
    const dupes = new Set()
    for (const r of tgt || []) {
      const k = tgtKey(def.key(r))
      if (!k) continue
      if (byKey.has(k)) dupes.add(k)
      else byKey.set(k, r.id)
    }
    for (const r of src) {
      if (!r?.id || map.has(r.id)) continue
      const k = srcKey(def.key(r))
      map.set(r.id, {
        category: cat,
        label: def.label,
        name: def.key(r) || r.id,
        targetId: (k && byKey.get(k)) || null,
        ambiguous: dupes.has(k),
      })
    }
  }
  return { map, unavailable }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Deep-copies `value`, replacing IDs per `replacements` (Map old -> new).
// Returns { value, hits: Map(oldId -> count) }.
function replaceIds(value, replacements) {
  const hits = new Map()
  const ids = [...replacements.keys()].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!ids.length) return { value: structuredClone(value), hits }
  const re = new RegExp(ids.map(escapeRe).join('|'), 'g')

  const swap = (s) => s.replace(re, (m) => {
    hits.set(m, (hits.get(m) || 0) + 1)
    return replacements.get(m)
  })

  const walk = (v) => {
    if (typeof v === 'string') return swap(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, child] of Object.entries(v)) out[swap(k)] = walk(child)
      return out
    }
    return v
  }
  return { value: walk(value), hits }
}

// Counts which catalog IDs appear anywhere in `value` (without changing it).
function findIds(value, ids) {
  const list = [...ids].filter(Boolean).sort((a, b) => b.length - a.length)
  const found = new Map()
  if (!list.length) return found
  const re = new RegExp(list.map(escapeRe).join('|'), 'g')
  const scan = (s) => { for (const m of s.matchAll(re)) found.set(m[0], (found.get(m[0]) || 0) + 1) }
  const walk = (v) => {
    if (typeof v === 'string') return scan(v)
    if (Array.isArray(v)) return v.forEach(walk)
    if (v && typeof v === 'object') for (const [k, c] of Object.entries(v)) { scan(k); walk(c) }
  }
  walk(value)
  return found
}

// Remaps a payload { workflow, triggers } from sourceLocationId to
// targetLocationId. `extra` adds fixed replacements (e.g. the source workflow's
// own id -> the target workflow id). Unmatched IDs are left as-is and reported.
function remapPayload({ workflow, triggers }, { idMap, sourceLocationId, targetLocationId, extra, overrides }) {
  const subject = { workflow, triggers: triggers || [] }
  const present = findIds(subject, idMap.keys())

  const replacements = new Map()
  const matched = []
  const unmatched = []
  for (const [id, count] of present) {
    const e = idMap.get(id)
    const picked = overrides?.[id]
    const targetId = picked || e.targetId
    if (targetId) {
      if (targetId !== id) replacements.set(id, targetId)
      matched.push({ id, category: e.category, label: e.label, name: e.name, count, targetId, ambiguous: !picked && e.ambiguous, manual: !!picked })
    } else {
      unmatched.push({ id, category: e.category, label: e.label, name: e.name, count })
    }
  }
  if (sourceLocationId && targetLocationId && sourceLocationId !== targetLocationId) {
    replacements.set(sourceLocationId, targetLocationId)
  }
  for (const [from, to] of Object.entries(extra || {})) if (from && to && from !== to) replacements.set(from, to)

  const { value } = replaceIds(subject, replacements)
  const byName = (a, b) => a.label.localeCompare(b.label) || String(a.name).localeCompare(String(b.name))
  return {
    workflow: value.workflow,
    triggers: value.triggers,
    matched: matched.sort(byName),
    unmatched: unmatched.sort(byName),
  }
}

// Accepts our export format, the Chrome extension's format (a workflow object
// with exportedTriggers), or a raw workflow object. Returns
// { workflow, triggers, sourceLocationId } or throws.
function normalizePayload(input) {
  if (!input || typeof input !== 'object') throw new Error('Not a workflow export')
  if (input.workflow && input.workflow.workflowData) {
    return {
      workflow: input.workflow,
      triggers: Array.isArray(input.triggers) ? input.triggers : [],
      sourceLocationId: input.sourceLocationId || input.workflow.locationId || null,
    }
  }
  const wf = input.workflowData ? input : (input.data?.workflowData ? input.data : null)
  if (!wf) throw new Error('Not a workflow export (no workflowData)')
  return {
    workflow: wf,
    triggers: Array.isArray(wf.exportedTriggers) ? wf.exportedTriggers : [],
    sourceLocationId: wf.locationId || null,
  }
}

module.exports = { CATEGORIES, buildIdMap, replaceIds, findIds, remapPayload, normalizePayload }
