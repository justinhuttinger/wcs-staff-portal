// Pure helpers for the client profile's Logs and Progress tabs.

/** A session's sets grouped by exercise, in the order they were logged. */
export function groupSets(sets) {
  const groups = []
  const at = new Map()
  for (const s of sets || []) {
    const key = s.exercise_id || s.exercise_name
    if (!at.has(key)) {
      at.set(key, groups.length)
      groups.push({ exercise_id: s.exercise_id, name: s.exercise_name, sets: [] })
    }
    groups[at.get(key)].sets.push(s)
  }
  for (const g of groups) g.sets.sort((a, b) => (a.set_number || 0) - (b.set_number || 0))
  return groups
}

const num = (v) => (v == null || v === '' ? null : Number(v))

/** The heaviest set (most reps on a tie); sets without a weight fall back to most reps. */
export function topSet(sets) {
  let best = null
  for (const s of sets || []) {
    const w = num(s.weight)
    const r = num(s.reps)
    if (best == null) { best = { weight: w, reps: r }; continue }
    const bw = best.weight
    if (w != null && (bw == null || w > bw || (w === bw && (r || 0) > (best.reps || 0)))) best = { weight: w, reps: r }
    else if (w == null && bw == null && (r || 0) > (best.reps || 0)) best = { weight: w, reps: r }
  }
  return best
}

/**
 * "vs last time" for every exercise in every session. `sessions` newest first
 * (as /coaching/sessions returns them). Returns Map(sessionId -> Map(exerciseId
 * -> { performed_on, weight, reps, dWeight, dReps })) comparing each top set
 * with the top set of the next older session that has the same exercise.
 */
export function compareToLast(sessions) {
  const list = sessions || []
  const tops = list.map(s => {
    const m = new Map()
    for (const g of groupSets(s.sets)) if (g.exercise_id) m.set(g.exercise_id, topSet(g.sets))
    return m
  })
  const out = new Map()
  list.forEach((s, i) => {
    const row = new Map()
    for (const [exerciseId, top] of tops[i]) {
      for (let j = i + 1; j < list.length; j++) {
        const prev = tops[j].get(exerciseId)
        if (!prev) continue
        row.set(exerciseId, {
          performed_on: list[j].performed_on,
          weight: prev.weight,
          reps: prev.reps,
          dWeight: top?.weight != null && prev.weight != null ? Math.round((top.weight - prev.weight) * 10) / 10 : null,
          dReps: top?.reps != null && prev.reps != null ? top.reps - prev.reps : null,
        })
        break
      }
    }
    out.set(s.id, row)
  })
  return out
}

/**
 * Geometry for a small SVG line chart. points: [{ x: label, y: number|null }].
 * Returns { path, dots: [{ cx, cy, x, y }], min, max } inside width x height
 * with `pad` on every side. Nulls are skipped (the line joins across them).
 */
export function chartGeometry(points, { width = 600, height = 220, pad = 28 } = {}) {
  const valued = (points || []).map((p, i) => ({ ...p, i })).filter(p => p.y != null && Number.isFinite(Number(p.y)))
  if (!valued.length) return { path: '', dots: [], min: null, max: null }
  const ys = valued.map(p => Number(p.y))
  let min = Math.min(...ys)
  let max = Math.max(...ys)
  if (min === max) { min -= 1; max += 1 }
  const n = (points || []).length
  const xAt = (i) => (n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1))
  const yAt = (v) => height - pad - ((v - min) * (height - pad * 2)) / (max - min)
  const dots = valued.map(p => ({ cx: Math.round(xAt(p.i) * 10) / 10, cy: Math.round(yAt(Number(p.y)) * 10) / 10, x: p.x, y: Number(p.y) }))
  const path = dots.map((d, k) => `${k ? 'L' : 'M'}${d.cx},${d.cy}`).join(' ')
  return { path, dots, min, max }
}

/** "+5", "-2.5", "0" with a unit; null -> ''. */
export function signed(n, unit = '') {
  if (n == null) return ''
  return `${n > 0 ? '+' : ''}${n}${unit}`
}
