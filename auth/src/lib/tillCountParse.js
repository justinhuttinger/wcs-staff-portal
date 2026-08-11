// auth/src/lib/tillCountParse.js
// Parse an Operandio "Drawer Open/Close Count" submission into a till_counts row.
//
// The drawer-count job is a DENOMINATION BREAKDOWN: one numeric task per
// denomination ("# of $100s", "# of $20s", ... "# of Quarters (25c)",
// "# of Pennies (1c)"). The counted cash total is therefore
//   sum over rows of (count entered) * (denomination in dollars).
//
// parseSubmissionItems already extracts each row's task name + the numeric answer
// (it.value, captured from the <span>N</span> status cell). We map each row's task
// to its denomination value and weight-sum. Subject form:
//   "Drawer <Open|Close> Count (Jun 29) submitted at <Location>"
const { parseSubmissionSubject, parseSubmissionItems, pacificDate } = require('./operandioJobs')

// Map an Operandio denomination task name to its value in DOLLARS, or null if the
// row is not a recognizable denomination. Handles three forms:
//   - dollar bills:  "# of $100s", "# of $20 Bills", "$5s"   -> 100 / 20 / 5
//   - coins w/ cents: "# of Quarters (25c)", "Dimes (10c)"   -> 0.25 / 0.10
//   - coins by word:  "Quarters", "Dimes", "Nickels", "Pennies" (fallback)
function denominationValue(taskName) {
  const t = String(taskName || '').toLowerCase()
  // Cents in parentheses, e.g. "(25c)" / "(5 c)" / "25¢" -- check before dollars
  // so a "$0.25"-style label can't be misread, and coins win over any stray "$".
  const cents = t.match(/\(\s*(\d+)\s*c\s*\)/) || t.match(/(\d+)\s*¢/)
  if (cents) return parseInt(cents[1], 10) / 100
  // Dollar amount, e.g. "$100", "$20 bills", "$5s".
  const dollars = t.match(/\$\s*(\d+)/)
  if (dollars) return parseInt(dollars[1], 10)
  // Word fallbacks (only if a club renames a coin row without the (Nc) hint).
  if (/\bpenn(y|ies)\b/.test(t)) return 0.01
  if (/\bnick(le|el)s?\b/.test(t)) return 0.05
  if (/\bdimes?\b/.test(t)) return 0.10
  if (/\bquarters?\b/.test(t)) return 0.25
  if (/\bhalf[\s-]?dollars?\b/.test(t)) return 0.50
  if (/\b(dollar coins?|sacagawea|susan b)\b/.test(t)) return 1
  return null
}

// Classify a webhook email as a drawer count, or return null. Pure: no I/O.
function classifyTillCount({ subject, html, receivedAt }) {
  const sub = parseSubmissionSubject(subject)
  if (!sub) return null
  const name = sub.jobName.toLowerCase()
  if (!/drawer/.test(name) || !/count/.test(name)) return null
  // Match on the word stems so both name orderings work: "Drawer Close Count"
  // AND "Closing Drawer Count" (likewise "Open"/"Opening"). The literal "close"
  // substring is absent from "closing", so stem matching is required here.
  const count_type = /clos/.test(name) ? 'close' : (/open/.test(name) ? 'open' : null)
  if (!count_type) return null

  const items = parseSubmissionItems(html) || []
  let counted_amount = 0
  let matched = 0
  const denominations = {}
  for (const it of items) {
    if (it.value == null) continue                 // skipped / non-numeric rows
    const denom = denominationValue(it.task)
    if (denom == null) continue                    // not a denomination row
    matched++
    counted_amount += denom * it.value
    denominations[String(denom)] = it.value
  }
  if (matched === 0) return null                   // a drawer count with no parsable denominations
  counted_amount = Math.round(counted_amount * 100) / 100

  // Primary completer = whoever filled the most rows; counted_at = latest stamp.
  const latest = items.map(i => i.at_iso).filter(Boolean).sort().pop()
  const byCount = {}
  let primary = null, primaryN = 0
  for (const it of items) {
    if (!it.by) continue
    byCount[it.by] = (byCount[it.by] || 0) + 1
    if (byCount[it.by] > primaryN) { primaryN = byCount[it.by]; primary = it.by }
  }

  return {
    location_slug: sub.locationSlug,
    count_type,
    counted_amount,
    denominations: Object.keys(denominations).length ? denominations : null,
    employee_name: primary,
    counted_at: latest || (receivedAt ? new Date(receivedAt).toISOString() : null),
    business_date: pacificDate(latest || receivedAt),
  }
}

module.exports = { classifyTillCount, denominationValue }
