// Pure shaping for Analytics > Till. No I/O; the route fetches.
//
// THE OVER/SHORT ARITHMETIC IS NOT REDEFINED HERE. reconcileDay() in
// tillReconcile.js stays the single definition of expected close and of
// over/short, and this module calls it. Two definitions of "short" is how a
// reconciliation report loses the trust it exists to earn.
//
// WHAT THIS ADDS over the day-by-day report is the view across a window: who is
// short and how often, which clubs skip counts, and whether it is drifting.
//
// COVERAGE IS PART OF THE ANSWER. Only five or six clubs submit counts at all
// and the data starts in late June, so a club with no variance may be counting
// perfectly or may not be counting. Those are opposite facts and the report
// separates them: a day with no close is `missing_close`, never a zero.
//
// SHORTAGES AND OVERAGES DO NOT CANCEL. A club $50 short on Monday and $50 over
// on Tuesday is not a club that reconciled. Net and absolute variance are both
// reported, and the ranking uses ABSOLUTE — otherwise the worst drawer in the
// company can average out to looking perfect.

const { reconcileDay, resolveFloatForDate } = require('./tillReconcile')

// A day whose |over/short| exceeds this is called out individually. Small
// change is rounding and coin; this is a drawer that did not balance.
const MATERIAL_VARIANCE = 5

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function r2(v) {
  return Math.round(v * 100) / 100
}

function pct(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

/**
 * @param cash      analytics_till_cash_by_day rows
 * @param counts    analytics_till_counts rows
 * @param opts      { settings: [{club_number, standard_float, drop_upc}],
 *                    floatHistory: [{club_number, effective_date, standard_float}],
 *                    clubs: [slug] }
 */
function buildTill(cash, counts, opts = {}) {
  const settings = opts.settings || []
  const history = opts.floatHistory || []

  const floatByClub = new Map()
  for (const h of history) {
    const k = String(h.club_number).replace(/^0+/, '')
    if (!floatByClub.has(k)) floatByClub.set(k, [])
    floatByClub.get(k).push(h)
  }
  const parByClub = new Map(
    settings.map(s => [String(s.club_number).replace(/^0+/, ''), num(s.standard_float)])
  )

  // Index counts by club/date/type.
  const countKey = (slug, date, type) => `${slug}|${date}|${type}`
  const countMap = new Map()
  for (const c of counts || []) {
    countMap.set(countKey(c.slug, String(c.business_date).slice(0, 10), c.count_type), c)
  }

  // Union of days with cash activity OR a count. A day with a count and no cash
  // still reconciles; a day with cash and no count is a missing count, which is
  // the finding.
  const dayKeys = new Map()
  for (const r of cash || []) {
    const date = String(r.business_date).slice(0, 10)
    dayKeys.set(`${r.slug}|${date}`, { slug: r.slug, clubNumber: r.club_number, date })
  }
  for (const c of counts || []) {
    const date = String(c.business_date).slice(0, 10)
    const k = `${c.slug}|${date}`
    if (!dayKeys.has(k)) dayKeys.set(k, { slug: c.slug, clubNumber: c.club_number, date })
  }

  const cashMap = new Map(
    (cash || []).map(r => [`${r.slug}|${String(r.business_date).slice(0, 10)}`, r])
  )

  const days = [...dayKeys.values()].map(({ slug, clubNumber, date }) => {
    const key = `${slug}|${date}`
    const cashRow = cashMap.get(key)
    const open = countMap.get(countKey(slug, date, 'open'))
    const close = countMap.get(countKey(slug, date, 'close'))
    const clubKey = String(clubNumber || '').replace(/^0+/, '')

    const rec = reconcileDay({
      standardFloat: resolveFloatForDate(
        floatByClub.get(clubKey), date, parByClub.get(clubKey) ?? 100
      ),
      openingCount: open ? num(open.counted_amount) : null,
      closingCount: close ? num(close.counted_amount) : null,
      cashSales: cashRow ? num(cashRow.cash_sales) : 0,
      cashRefunds: cashRow ? num(cashRow.cash_refunds) : 0,
      cashDrops: cashRow ? num(cashRow.cash_drops) : 0,
    })

    return {
      slug, date,
      cashSales: r2(cashRow ? num(cashRow.cash_sales) : 0),
      cashRefunds: r2(cashRow ? num(cashRow.cash_refunds) : 0),
      cashDrops: r2(cashRow ? num(cashRow.cash_drops) : 0),
      ...rec,
      openBy: open ? open.employee_name : null,
      closeBy: close ? close.employee_name : null,
      material: rec.overShort !== null && Math.abs(rec.overShort) >= MATERIAL_VARIANCE,
    }
  }).sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug))

  const reconciled = days.filter(d => d.overShort !== null)

  const agg = (rows) => {
    const net = rows.reduce((a, d) => a + d.overShort, 0)
    // Absolute, because a $50 short and a $50 over is not a balanced drawer.
    const abs = rows.reduce((a, d) => a + Math.abs(d.overShort), 0)
    return { net: r2(net), absolute: r2(abs), days: rows.length }
  }

  // --- per club ------------------------------------------------------------
  const clubMap = new Map()
  for (const d of days) {
    const cur = clubMap.get(d.slug) || {
      slug: d.slug, days: 0, reconciledDays: 0, missingOpen: 0, missingClose: 0,
      missingBoth: 0, net: 0, absolute: 0, material: 0, cashSales: 0,
    }
    cur.days += 1
    cur.cashSales += d.cashSales
    if (d.status === 'missing_open') cur.missingOpen += 1
    else if (d.status === 'missing_close') cur.missingClose += 1
    else if (d.status === 'missing_both') cur.missingBoth += 1
    if (d.overShort !== null) {
      cur.reconciledDays += 1
      cur.net += d.overShort
      cur.absolute += Math.abs(d.overShort)
      if (d.material) cur.material += 1
    }
    clubMap.set(d.slug, cur)
  }

  const byClub = [...clubMap.values()].map(c => ({
    ...c,
    net: r2(c.net),
    absolute: r2(c.absolute),
    cashSales: r2(c.cashSales),
    avgAbsolute: c.reconciledDays ? r2(c.absolute / c.reconciledDays) : null,
    countRate: pct(c.reconciledDays, c.days),
  })).sort((a, b) => b.absolute - a.absolute)

  // --- per person ----------------------------------------------------------
  //
  // Attributed to whoever CLOSED, because the closing count is the one being
  // reconciled. A missing name is left out rather than bucketed as "unknown",
  // which would name a person who does not exist.
  const personMap = new Map()
  for (const d of reconciled) {
    const who = d.closeBy
    if (!who) continue
    const cur = personMap.get(who) || { name: who, days: 0, net: 0, absolute: 0, material: 0, clubs: new Set() }
    cur.days += 1
    cur.net += d.overShort
    cur.absolute += Math.abs(d.overShort)
    if (d.material) cur.material += 1
    cur.clubs.add(d.slug)
    personMap.set(who, cur)
  }
  const byPerson = [...personMap.values()].map(p => ({
    name: p.name,
    days: p.days,
    net: r2(p.net),
    absolute: r2(p.absolute),
    material: p.material,
    avgAbsolute: p.days ? r2(p.absolute / p.days) : null,
    clubs: [...p.clubs].sort(),
  })).sort((a, b) => b.absolute - a.absolute)

  // --- trend ---------------------------------------------------------------
  const monthMap = new Map()
  for (const d of reconciled) {
    const month = `${d.date.slice(0, 7)}-01`
    const cur = monthMap.get(month) || { month, net: 0, absolute: 0, days: 0 }
    cur.net += d.overShort
    cur.absolute += Math.abs(d.overShort)
    cur.days += 1
    monthMap.set(month, cur)
  }
  const months = [...monthMap.values()]
    .map(m => ({ ...m, net: r2(m.net), absolute: r2(m.absolute), avgAbsolute: m.days ? r2(m.absolute / m.days) : null }))
    .sort((a, b) => a.month.localeCompare(b.month))

  const totals = agg(reconciled)
  const missing = days.filter(d => d.status !== 'complete')

  return {
    summary: {
      net: totals.net,
      absolute: totals.absolute,
      reconciledDays: totals.days,
      totalDays: days.length,
      countRate: pct(totals.days, days.length),
      materialDays: reconciled.filter(d => d.material).length,
      avgAbsolute: totals.days ? r2(totals.absolute / totals.days) : null,
      cashSales: r2(days.reduce((a, d) => a + d.cashSales, 0)),
      missingOpen: days.filter(d => d.status === 'missing_open').length,
      missingClose: days.filter(d => d.status === 'missing_close').length,
      missingBoth: days.filter(d => d.status === 'missing_both').length,
    },
    days,
    byClub,
    byPerson,
    months,
    materialDays: reconciled.filter(d => d.material)
      .sort((a, b) => Math.abs(b.overShort) - Math.abs(a.overShort)),
    notes: {
      absolute:
        'Net and absolute variance are both shown. A club $50 short one day and $50 over ' +
        'the next has a net of zero and did not reconcile, so rankings use the absolute figure.',
      coverage: missing.length === 0 ? null
        : `${missing.length} of ${days.length} club-days have no closing count and cannot be ` +
          'reconciled. A club with no variance may be counting perfectly or may not be counting ' +
          'at all, so those days are reported as missing rather than as zero.',
    },
  }
}

module.exports = { buildTill, MATERIAL_VARIANCE }
