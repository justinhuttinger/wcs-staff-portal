const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('manager'))

const SLUG_CLUB_MAP = {
  salem: '30935',
  keizer: '31599',
  eugene: '7655',
  springfield: '31598',
  clackamas: '31600',
  milwaukie: '31601',
  medford: '32073',
}
const CLUB_SLUG_MAP = Object.fromEntries(
  Object.entries(SLUG_CLUB_MAP).map(([slug, club]) => [club, slug])
)

const SESSION_STATUSES = ['Completed', 'Canceled-Charge']

function normalizeEventType(name) {
  if (!name) return 'Other'
  const n = String(name).toLowerCase()
  if (n.includes('train with your trainer')) return 'MISC'
  if (/small\s*group|\bsgt\b/i.test(name)) return 'Small Group'
  if (n.includes('consult')) return 'Consult'
  if (n.includes('stretch')) {
    if (/\b30\b|30\s*min/i.test(name)) return 'Stretch 30'
    if (/\b60\b|60\s*min/i.test(name)) return 'Stretch 60'
    return 'Stretch 60'
  }
  if (n.includes('swim')) return 'Swim'
  if (/(^|\s|-)pt\s*-?\s*60(?!\d)/i.test(name)) return 'PT60'
  if (/(^|\s|-)pt\s*-?\s*30(?!\d)/i.test(name)) return 'PT30'
  if (n.includes('partner')) {
    if (/\b30\b|30\s*min/i.test(name)) return 'Partner30'
    return 'Partner60'
  }
  if (/workshop|floor\s*hour|^admin\b|orientation|meeting|huddle/i.test(name)) return 'Floor Hour'
  return 'MISC'
}

const EVENT_COLUMN_ORDER = [
  'PT60', 'PT30', 'Partner60', 'Partner30', 'Consult',
  'Floor Hour', 'Stretch 30', 'Stretch 60', 'Swim', 'Small Group', 'MISC',
]

function locSlugFromName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Period like "2026-04" -> { period: '2026-04-01', from: '2026-04-01', to: '2026-04-30' }.
function parsePeriod(periodStr) {
  const m = String(periodStr || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const pad = (n) => String(n).padStart(2, '0')
  return {
    period: `${m[1]}-${m[2]}-01`,
    from: `${m[1]}-${m[2]}-01`,
    to: `${m[1]}-${m[2]}-${pad(lastDay)}`,
  }
}

// Build a UTC ISO string that, when interpreted by our TZ-mislabeled
// abc_calendar_events rows (where the UTC components actually represent
// Pacific local clock values), corresponds to the Pacific-day boundary.
function pacificDayBoundsToUtc(dateStr, endOfDay = false) {
  if (!dateStr) return null
  const noonUtc = new Date(dateStr + 'T12:00:00Z')
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  })
  const pacificHourAtNoonUtc = parseInt(fmt.format(noonUtc), 10)
  const offsetHours = 12 - pacificHourAtNoonUtc
  const baseMs = endOfDay
    ? new Date(dateStr + 'T23:59:59.999Z').getTime()
    : new Date(dateStr + 'T00:00:00.000Z').getTime()
  return new Date(baseMs + offsetHours * 3600000).toISOString()
}

async function authorizeAndResolveClubs(req, location_slug) {
  const allLocations = canSeeAllLocations(req.staff.role)
  if (!allLocations) {
    if (!location_slug || location_slug === 'all') {
      const err = new Error('Specify a location_slug; you do not have access to all locations.')
      err.status = 403
      throw err
    }
    const allowedIds = req.staff.report_location_ids || []
    let allowedSlugs = []
    if (allowedIds.length > 0) {
      const { data: allowedLocs } = await supabaseAdmin
        .from('locations')
        .select('name')
        .in('id', allowedIds)
      allowedSlugs = (allowedLocs || []).map((l) => locSlugFromName(l.name))
    }
    if (!allowedSlugs.includes(location_slug)) {
      const err = new Error('Not authorized to view this location')
      err.status = 403
      throw err
    }
  }
  if (location_slug && location_slug !== 'all' && !SLUG_CLUB_MAP[location_slug]) {
    const err = new Error(`Unknown location_slug: ${location_slug}`)
    err.status = 400
    throw err
  }
  if (!location_slug || location_slug === 'all') return null
  return [SLUG_CLUB_MAP[location_slug]]
}

async function fetchAll(query, pageSize = 1000) {
  const out = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

// Build the report payload from a request. Shared between GET / and the
// export endpoint so they're guaranteed to see the same data.
async function buildPayrollData(req) {
  const period = parsePeriod(req.query.period)
  if (!period) {
    const err = new Error('period is required, format YYYY-MM (e.g. 2026-04)')
    err.status = 400
    throw err
  }
  const clubs = await authorizeAndResolveClubs(req, req.query.location_slug)

  // ---- Sales commissions (CSV-loaded) ----
  let salesQ = supabaseAdmin
    .from('payroll_sales_commissions')
    .select('club_number, employee_name, profit_center, commission')
    .eq('period', period.period)
  if (clubs) salesQ = salesQ.in('club_number', clubs)
  const salesRows = await fetchAll(salesQ)

  const salesByEmployee = new Map() // key: club|name -> {...}
  let totalSalesCommission = 0
  for (const r of salesRows) {
    const key = `${r.club_number}|${r.employee_name}`
    let row = salesByEmployee.get(key)
    if (!row) {
      row = {
        club_number: r.club_number,
        location_slug: CLUB_SLUG_MAP[r.club_number] || r.club_number,
        employee_name: r.employee_name,
        total_commission: 0,
        by_profit_center: {},
      }
      salesByEmployee.set(key, row)
    }
    const c = Number(r.commission) || 0
    row.total_commission += c
    row.by_profit_center[r.profit_center] = (row.by_profit_center[r.profit_center] || 0) + c
    totalSalesCommission += c
  }

  // ---- Recurring service commissions (ABC API-loaded) ----
  let recQ = supabaseAdmin
    .from('payroll_recurring_commissions')
    .select('recurring_service_id, club_number, sale_date, member_name, employee_id, employee_name, service_item, recurring_type_desc, invoice_total, total_periods, total_contract_value, commission')
    .eq('period', period.period)
  if (clubs) recQ = recQ.in('club_number', clubs)
  const recRows = await fetchAll(recQ)

  const recurringByEmployee = new Map() // key: club|employeeId|name
  let totalRecurringCommission = 0
  for (const r of recRows) {
    const key = `${r.club_number}|${r.employee_id || ''}|${r.employee_name || 'Unknown'}`
    let row = recurringByEmployee.get(key)
    if (!row) {
      row = {
        club_number: r.club_number,
        location_slug: CLUB_SLUG_MAP[r.club_number] || r.club_number,
        employee_id: r.employee_id || null,
        employee_name: r.employee_name || 'Unknown',
        services_count: 0,
        total_commission: 0,
        total_contract_value: 0,
        services: [],
      }
      recurringByEmployee.set(key, row)
    }
    row.services_count += 1
    row.total_commission += Number(r.commission) || 0
    row.total_contract_value += Number(r.total_contract_value) || 0
    row.services.push({
      recurring_service_id: r.recurring_service_id,
      sale_date: r.sale_date,
      member_name: r.member_name,
      service_item: r.service_item,
      recurring_type_desc: r.recurring_type_desc,
      invoice_total: Number(r.invoice_total) || 0,
      total_periods: r.total_periods,
      total_contract_value: Number(r.total_contract_value) || 0,
      commission: Number(r.commission) || 0,
    })
    totalRecurringCommission += Number(r.commission) || 0
  }

  // ---- Trainer sessions (abc_calendar_events) ----
  const startUtcIso = pacificDayBoundsToUtc(period.from, false)
  const endUtcIso = pacificDayBoundsToUtc(period.to, true)
  let sessQ = supabaseAdmin
    .from('abc_calendar_events')
    .select('club_number, employee_id, employee_first_name, employee_last_name, event_name, status')
    .gte('event_timestamp', startUtcIso)
    .lte('event_timestamp', endUtcIso)
    .in('status', SESSION_STATUSES)
  if (clubs) sessQ = sessQ.in('club_number', clubs)
  const sessRows = await fetchAll(sessQ)

  const sessionsByEmployee = new Map() // key: club|employeeId
  const sessionEventTypes = new Set()
  let totalSessions = 0
  let totalSessionsCompleted = 0
  let totalSessionsCanceled = 0
  for (const r of sessRows) {
    const tid = r.employee_id || 'unassigned'
    const key = `${r.club_number}|${tid}`
    const tname = `${r.employee_first_name || ''} ${r.employee_last_name || ''}`.trim() || 'Unbooked'
    const ev = normalizeEventType(r.event_name)
    sessionEventTypes.add(ev)
    let row = sessionsByEmployee.get(key)
    if (!row) {
      row = {
        club_number: r.club_number,
        location_slug: CLUB_SLUG_MAP[r.club_number] || r.club_number,
        employee_id: tid,
        employee_name: tname,
        total: 0,
        completed: 0,
        canceled_charge: 0,
        by_event_type: {},
      }
      sessionsByEmployee.set(key, row)
    }
    row.total += 1
    totalSessions += 1
    if (r.status === 'Completed') {
      row.completed += 1
      totalSessionsCompleted += 1
    } else if (r.status === 'Canceled-Charge') {
      row.canceled_charge += 1
      totalSessionsCanceled += 1
    }
    const cell = row.by_event_type[ev] || { completed: 0, canceled_charge: 0 }
    if (r.status === 'Completed') cell.completed += 1
    else if (r.status === 'Canceled-Charge') cell.canceled_charge += 1
    row.by_event_type[ev] = cell
  }

  const presentEvents = new Set(sessionEventTypes)
  const orderedEventTypes = [
    ...EVENT_COLUMN_ORDER.filter((t) => presentEvents.has(t)),
    ...[...sessionEventTypes].filter((t) => !EVENT_COLUMN_ORDER.includes(t)).sort(),
  ]

  const roundMoney = (n) => Math.round(n * 100) / 100
  const sales = [...salesByEmployee.values()]
    .map((r) => ({
      ...r,
      total_commission: roundMoney(r.total_commission),
      by_profit_center: Object.fromEntries(
        Object.entries(r.by_profit_center).map(([k, v]) => [k, roundMoney(v)])
      ),
    }))
    .sort((a, b) => b.total_commission - a.total_commission)

  const recurring = [...recurringByEmployee.values()]
    .map((r) => ({
      ...r,
      total_commission: roundMoney(r.total_commission),
      total_contract_value: roundMoney(r.total_contract_value),
    }))
    .sort((a, b) => b.total_commission - a.total_commission)

  const sessions = [...sessionsByEmployee.values()].sort((a, b) => b.total - a.total)

  return {
    period: period.period,
    location_slug: req.query.location_slug || 'all',
    summary: {
      sales_commission: roundMoney(totalSalesCommission),
      recurring_commission: roundMoney(totalRecurringCommission),
      recurring_services_count: recRows.length,
      sessions_total: totalSessions,
      sessions_completed: totalSessionsCompleted,
      sessions_canceled_charge: totalSessionsCanceled,
      grand_total_commission: roundMoney(totalSalesCommission + totalRecurringCommission),
    },
    sales,
    recurring,
    sessions,
    session_event_types: orderedEventTypes,
  }
}

// GET /reports/payroll?period=YYYY-MM&location_slug=xxx
router.get('/', async (req, res) => {
  try {
    const data = await buildPayrollData(req)
    res.json(data)
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /reports/payroll/export-sheet?period=YYYY-MM&location_slug=xxx
// Builds a one-tab Google Sheet that mirrors the CSV export and returns
// the share URL. Sections are stacked vertically (single tab — the user
// explicitly wants one file, not separate tabs).
router.post('/export-sheet', async (req, res) => {
  try {
    const { exportToGoogleSheet } = require('../services/googleSheets')
    const POS_EXCLUDED = new Set(['TRAINING'])
    const data = await buildPayrollData(req)

    const lastNameKey = (n) => {
      if (!n) return ''
      const parts = String(n).trim().split(/\s+/)
      return parts[parts.length - 1].toLowerCase()
    }
    const sortByLastName = (rows) => [...rows].sort((a, b) => {
      const ln = lastNameKey(a.employee_name).localeCompare(lastNameKey(b.employee_name))
      if (ln !== 0) return ln
      return (a.employee_name || '').localeCompare(b.employee_name || '')
    })

    const rows = []
    const boldRowIndices = []
    const pushBold = (r) => { boldRowIndices.push(rows.length); rows.push(r) }

    pushBold([`Payroll Report — ${data.period}`])
    rows.push([`Location: ${data.location_slug}`])
    rows.push([])

    pushBold(['Summary'])
    rows.push(['POS Sales Commission', data.summary.sales_commission])
    rows.push(['PT Sales Commission', data.summary.recurring_commission])
    rows.push(['PT Sales Services Count', data.summary.recurring_services_count])
    rows.push(['Trainer Sessions Total', data.summary.sessions_total])
    rows.push(['Sessions Completed', data.summary.sessions_completed])
    rows.push(['Sessions Canceled-Charge', data.summary.sessions_canceled_charge])
    rows.push(['Grand Total Commission', data.summary.grand_total_commission])
    rows.push([])

    // POS Sale Commissions (drop TRAINING and rows with no remaining commission)
    const sales = sortByLastName(data.sales || [])
    const posCenters = new Set()
    for (const r of sales) {
      for (const k of Object.keys(r.by_profit_center || {})) {
        if (!POS_EXCLUDED.has(k)) posCenters.add(k)
      }
    }
    const posCols = [...posCenters].sort()
    pushBold(['POS Sale Commissions'])
    pushBold(['Employee', 'Club', ...posCols, 'Total'])
    for (const r of sales) {
      let total = 0
      const cells = posCols.map((c) => {
        const v = Number(r.by_profit_center?.[c] || 0)
        total += v
        return v
      })
      if (total === 0 && !posCols.some((c) => c in (r.by_profit_center || {}))) continue
      rows.push([r.employee_name, r.location_slug, ...cells, Math.round(total * 100) / 100])
    }
    rows.push([])

    // PT Sales Commissions summary
    const recurring = sortByLastName(data.recurring || [])
    pushBold(['PT Sales Commissions'])
    pushBold(['Employee', 'Club', 'Services', 'Contract Value', 'Commission (4%)'])
    for (const r of recurring) {
      rows.push([r.employee_name, r.location_slug, r.services_count, r.total_contract_value, r.total_commission])
    }
    rows.push([])

    // PT Sales detail (per-service)
    pushBold(['PT Sales Detail'])
    pushBold(['Employee', 'Club', 'Sale Date', 'Member', 'Service', 'Type', 'Invoice', 'Periods', 'Contract Value', 'Commission'])
    for (const r of recurring) {
      for (const s of r.services || []) {
        rows.push([
          r.employee_name,
          r.location_slug,
          s.sale_date || '',
          s.member_name || '',
          s.service_item || '',
          s.recurring_type_desc || '',
          s.invoice_total,
          s.total_periods,
          s.total_contract_value,
          s.commission,
        ])
      }
    }
    rows.push([])

    // Trainer Sessions
    const sessions = sortByLastName(data.sessions || [])
    const eventTypes = data.session_event_types || []
    pushBold(['Trainer Sessions'])
    const sessionHeader = ['Trainer', 'Club']
    for (const t of eventTypes) {
      sessionHeader.push(`${t} Completed`)
      sessionHeader.push(`${t} CxlCharge`)
    }
    sessionHeader.push('Total Completed', 'Total CxlCharge', 'Total')
    pushBold(sessionHeader)
    for (const r of sessions) {
      const cells = []
      for (const t of eventTypes) {
        const cell = r.by_event_type[t] || { completed: 0, canceled_charge: 0 }
        cells.push(cell.completed || 0, cell.canceled_charge || 0)
      }
      rows.push([r.employee_name, r.location_slug, ...cells, r.completed || 0, r.canceled_charge || 0, r.total || 0])
    }

    const title = `WCS Payroll — ${data.period}${data.location_slug && data.location_slug !== 'all' ? ' — ' + data.location_slug : ''}`
    const shareWith = []
    if (req.staff?.email) shareWith.push(req.staff.email)
    const result = await exportToGoogleSheet({ title, rows, boldRowIndices, shareWith })
    res.json({ url: result.url, id: result.id })
  } catch (err) {
    const msg = err.message || 'Export failed'
    if (/not authorized|authorize/i.test(msg)) {
      return res.status(503).json({
        error: msg,
        action: 'visit /google-business/authorize to (re-)connect Google with Sheets + Drive scopes',
      })
    }
    res.status(err.status || 500).json({ error: msg })
  }
})

module.exports = router
