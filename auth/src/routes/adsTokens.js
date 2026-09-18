// {{token}} substitution for multi-club ad launches.
//
// One ad is written once and published to every club, so the text has to carry
// the parts that differ: "Join West Coast Strength {{club}}" becomes Keizer's
// ad and Eugene's ad from the same line. Values come from each club's preset.
//
// Two rules make this safe to point at a live ad account:
//   * a token no club can fill is an ERROR, not an empty string — an ad that
//     reads "{{club}}" in front of customers is the outcome worth preventing
//   * a value is never itself scanned for tokens, so one club's value can
//     never expand into another's
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

// Token names are matched case-insensitively so {{CLUB}} and {{club}} agree.
function lookup(values, name) {
  if (!values) return undefined
  if (Object.prototype.hasOwnProperty.call(values, name)) return values[name]
  const hit = Object.keys(values).find(k => k.toLowerCase() === name.toLowerCase())
  return hit === undefined ? undefined : values[hit]
}

function renderTokens(text, values) {
  if (text === null || text === undefined) return ''
  return String(text).replace(TOKEN_RE, (whole, name) => {
    const val = lookup(values, name)
    // Unknown token: leave it visible. Callers validate with missingTokens()
    // before writing anything, so this only ever shows up in a preview.
    return val === undefined ? whole : String(val)
  })
}

function findTokens(text) {
  const out = new Set()
  for (const m of String(text ?? '').matchAll(TOKEN_RE)) out.add(m[1].toLowerCase())
  return [...out]
}

// Which tokens across a set of strings this club cannot fill. Empty string is a
// legitimate value (someone blanked a promo line); undefined is not.
function missingTokens(texts, values) {
  const missing = new Set()
  for (const text of [].concat(texts || [])) {
    for (const name of findTokens(text)) {
      if (lookup(values, name) === undefined) missing.add(name)
    }
  }
  return [...missing]
}

// Render every string inside an object/array, leaving other types alone. Lets a
// whole ad set or variant be rendered in one call without listing its fields.
function renderFields(shape, values) {
  if (typeof shape === 'string') return renderTokens(shape, values)
  if (Array.isArray(shape)) return shape.map(v => renderFields(v, values))
  if (shape && typeof shape === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(shape)) out[k] = renderFields(v, values)
    return out
  }
  return shape
}

// Every string inside a shape, for validation before a launch.
function collectStrings(shape, acc = []) {
  if (typeof shape === 'string') acc.push(shape)
  else if (Array.isArray(shape)) shape.forEach(v => collectStrings(v, acc))
  else if (shape && typeof shape === 'object') Object.values(shape).forEach(v => collectStrings(v, acc))
  return acc
}

module.exports = { renderTokens, findTokens, missingTokens, renderFields, collectStrings }
