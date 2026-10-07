// Helpers for reading ABC payment plans (GET /clubs/plans and
// /clubs/plans/{id}) into the numbers the Online Join admin needs.
// ABC returns money as strings like "$1,234.50".

export function abcMoney(v) {
  if (v == null || v === '') return null
  const n = Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function fmtMoney(n) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '—'
  const v = Number(n)
  return `$${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`
}

// Unwrap the admin proxy's merged detail response to ABC's paymentPlan object.
export function unwrapAbcDetail(r) {
  return r?.paymentPlan || r?._plan?.paymentPlan || r?.plan || r?.result || r || null
}

// Guess term + payment method from the plan name (works on list rows, which
// only carry planName/planId). Names look like WEB-HALFOFF-1YR-CC.
export function guessFromName(name = '') {
  const n = String(name).toUpperCase()
  const term = /\b(1\s*YR|1YEAR|12\s*MO|ANNUAL|YEAR)\b|1YR/.test(n) ? '1yr'
    : /M2M|MONTH\s*TO\s*MONTH|\bOPEN\b/.test(n) ? 'm2m' : null
  const method = /\b(ACH|EFT|BANK)\b|-ACH|ACH-/.test(n) ? 'ach'
    : /\b(CC|CARD|CREDIT)\b|-CC|CC-/.test(n) ? 'cc' : null
  return { term, method }
}

// The "twin" of a plan name on the other payment method: WEB-X-1YR-CC <-> WEB-X-1YR-ACH.
export function twinName(name = '') {
  const n = String(name)
  if (/CC/i.test(n)) return n.replace(/CC/i, 'ACH')
  if (/ACH/i.test(n)) return n.replace(/ACH/i, 'CC')
  return null
}

// Summarize a detail object into the fields an Online Join plan stores.
export function summarizeAbcPlan(pp) {
  if (!pp) return null
  const downs = Array.isArray(pp.downPayments) ? pp.downPayments : []
  // Only schedules that actually bill: the base ones, plus add-ons ABC marks
  // defaultChecked (Online Join echoes exactly those into the agreement).
  // Optional add-ons (extra family members, an unchecked card fee) don't.
  const scheds = (Array.isArray(pp.schedules) ? pp.schedules : [])
    .filter(s => s.addon !== true || s.defaultChecked === true)
  const enrollment = downs
    .filter(d => /enroll/i.test(d.name || ''))
    .reduce((a, d) => a + (abcMoney(d.total) || 0), 0)
  const dues = scheds
    .filter(s => /dues/i.test(s.profitCenter || ''))
    .reduce((a, s) => a + (abcMoney(s.scheduleAmount) || 0), 0)
  const fees = scheds
    .filter(s => !/dues/i.test(s.profitCenter || ''))
    .reduce((a, s) => a + (abcMoney(s.scheduleAmount) || 0), 0)
  const fromName = guessFromName(pp.planName)
  const months = Number(pp.termInMonths) || 0
  const term = fromName.term || (months >= 12 ? '1yr' : (pp.agreementTerm ? 'm2m' : null))
  const pref = String(pp.preferredPaymentMethod || '').toLowerCase()
  const method = fromName.method
    || (/credit|card/.test(pref) ? 'cc' : /eft|ach|bank|check/.test(pref) ? 'ach' : null)
  const validation = pp.planValidation == null ? '' : String(
    typeof pp.planValidation === 'object' ? (pp.planValidation.hash ?? pp.planValidation.value ?? '') : pp.planValidation,
  )
  return {
    planId: pp.planId || '',
    name: pp.planName || '',
    membershipType: pp.membershipType || '',
    today: abcMoney(pp.downPaymentTotalAmount),
    enrollment,
    dues,
    fees,
    monthly: dues + fees,
    firstDue: pp.firstDueDate || null,
    term,
    method,
    validation,
    active: pp.active !== false,
  }
}

export function termLabel(t) {
  return t === '1yr' ? '1-Year' : t === 'm2m' ? 'Month-to-Month' : 'No term'
}

// Slug for a plan key from a type key + term (+ household size).
export function suggestPlanKey(typeKey, term, maxMembers) {
  const base = String(typeKey || 'plan').toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const size = maxMembers && Number(maxMembers) > 1 ? `-${maxMembers}` : ''
  return `${base}-${term || 'plan'}${size}`
}

const sameMoney = (a, b) => a != null && b != null && a !== '' && Math.abs(Number(a) - Number(b)) < 0.005

// Everything about an Online Join plan that disagrees with its linked ABC
// plans. `plan` uses the online_join_plans column names; `abc` is
// { cc, ach } of summarizeAbcPlan results. Returns plain-English strings.
export function abcIssues(plan, abc, prorated) {
  const out = []
  const c = abc?.cc, a = abc?.ach
  const blank = v => v === '' || v == null
  const achToday = blank(plan.today_amount_ach) ? plan.today_amount : plan.today_amount_ach
  const achMonthly = blank(plan.monthly_amount_ach) ? plan.monthly_amount : plan.monthly_amount_ach
  if (c && !prorated && c.today != null && !sameMoney(plan.today_amount, c.today)) out.push(`Card due today is ${fmtMoney(plan.today_amount)}, ABC charges ${fmtMoney(c.today)}.`)
  if (c && c.monthly && !sameMoney(plan.monthly_amount, c.monthly)) out.push(`Card monthly is ${fmtMoney(plan.monthly_amount)}, ABC bills ${fmtMoney(c.monthly)}.`)
  if (a && !prorated && a.today != null && !sameMoney(achToday, a.today)) out.push(`Bank due today is ${fmtMoney(achToday)}, ABC charges ${fmtMoney(a.today)}.`)
  if (a && a.monthly && !sameMoney(achMonthly, a.monthly)) out.push(`Bank monthly is ${fmtMoney(achMonthly)}, ABC bills ${fmtMoney(a.monthly)}.`)
  if (c && plan.term && c.term && c.term !== plan.term) out.push(`This is a ${termLabel(plan.term)} plan, but the card plan in ABC looks ${termLabel(c.term)}.`)
  if (a && plan.term && a.term && a.term !== plan.term) out.push(`This is a ${termLabel(plan.term)} plan, but the bank plan in ABC looks ${termLabel(a.term)}.`)
  if (c && c.method === 'ach') out.push(`${c.name} looks like a bank plan, but it's linked as the card plan.`)
  if (a && a.method === 'cc') out.push(`${a.name} looks like a card plan, but it's linked as the bank plan.`)
  if (plan.payment_plan_id && plan.payment_plan_id === plan.payment_plan_id_ach) out.push('Card and bank are linked to the same ABC plan.')
  if (prorated && !(Number(plan.today_amount) > 0)) out.push("Prorated club: due today must be more than $0, or bank members never get asked for a card for today's charge.")
  return out
}
