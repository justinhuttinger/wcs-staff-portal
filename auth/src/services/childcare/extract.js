// auth/src/services/childcare/extract.js
// Pure transforms from synced job/step rows to one headcount per club/day/block.
// No I/O, so every rule below is directly testable.
'use strict'

const { METRICS } = require('./config')

// Normalize a step name for matching: lowercase, collapse whitespace, and drop
// a trailing "(copy)" / "(copy 2)". Operandio appends that when a step is
// duplicated in the UI, which is how both of these questions were created.
function normalizeStepName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s*\(copy(?:\s*\d+)?\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// A count, or null if the response is not a plain non-negative integer.
//
// null means UNKNOWN, never zero. A blank, a dash or "n/a" must not be counted
// as "no children present" — this report advises staffing, and a phantom zero
// drags an average down in exactly the direction that causes understaffing.
function parseCount(response) {
  if (typeof response !== 'string') return null
  const trimmed = response.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

// The two headcounts from one job's step rows: { over1, under1 }, each possibly
// null. Steps that aren't one of the two metrics are ignored.
function countsFromSteps(steps) {
  const out = { over1: null, under1: null }
  for (const s of steps || []) {
    const metric = METRICS[normalizeStepName(s.name)]
    if (!metric) continue
    const value = parseCount(s.response)
    if (value !== null) out[metric] = value
  }
  return out
}

// One entry per club/day/block, newest submission winning.
//
// A second submission for the same block is a CORRECTION, not additional
// children (confirmed 2026-08-24: a block cannot legitimately run twice).
// Summing would double-count the same kids and inflate every average. The
// superseded count is kept so a genuine double-entry stays visible.
function buildEntries(jobs, stepsByJob, blockByProcessId) {
  const byKey = new Map()

  for (const job of jobs || []) {
    const block = blockByProcessId.get(job.process_id)
    if (!block || !job.submitted || !job.job_date) continue

    const counts = countsFromSteps(stepsByJob.get(job.id) || [])
    // Nothing numeric on a submitted childcare job means the questions were
    // missing or renamed. Skip it rather than record a zero-filled day.
    if (counts.over1 === null && counts.under1 === null) continue

    const key = `${job.location_slug}|${job.job_date}|${block}`
    const existing = byKey.get(key)
    const stamp = job.submitted_at || ''

    if (!existing) {
      byKey.set(key, {
        location_slug: job.location_slug,
        date: job.job_date,
        block,
        over1: counts.over1,
        under1: counts.under1,
        submitted_at: job.submitted_at || null,
        submitted_by: job.submitted_by || null,
        job_id: job.id,
        submissions: 1,
      })
      continue
    }

    existing.submissions += 1
    if (stamp >= (existing.submitted_at || '')) {
      existing.over1 = counts.over1
      existing.under1 = counts.under1
      existing.submitted_at = job.submitted_at || null
      existing.submitted_by = job.submitted_by || null
      existing.job_id = job.id
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.date.localeCompare(b.date) || a.location_slug.localeCompare(b.location_slug)
      || a.block.localeCompare(b.block))
}

module.exports = { normalizeStepName, parseCount, countsFromSteps, buildEntries }
