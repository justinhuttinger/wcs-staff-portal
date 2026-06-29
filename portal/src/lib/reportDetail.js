// Per-report "See Detail" adapters.
//
// Several reports already carry row-level records in the response their summary
// view fetches (e.g. the Membership report's per-salesperson `members` arrays).
// This registry teaches a single generic detail grid how to flatten each of
// those responses into one flat, line-by-line, Excel-style table — a name plus
// the facts that matter for that report.
//
// Each adapter reuses the SAME api function and param shape the summary view
// uses, so the detail tab is served from the client cache with no extra
// network round-trip when the summary has already loaded.
//
// Adapter shape, keyed by the report `key` from ReportingView:
//   {
//     fetch:       (params, options) => Promise<data>   // same endpoint as summary
//     buildParams: ({ startDate, endDate, locationSlug }) => params
//     columns:     [{ key, label, type? }]              // type: text|number|decimal|money|date|bool
//     flatten:     (data) => row[]                      // row keys match column keys
//     filename:    ({ startDate, endDate, locationSlug }) => string  // CSV name, no extension
//   }
//
// Column types drive alignment, sorting, and cell/CSV formatting:
//   text (default) — left,  string sort
//   number         — right, numeric sort
//   decimal        — right, numeric sort, 2 decimals
//   money          — right, numeric sort, "$" + 2 decimals
//   date           — left,  string sort (ISO/Y-M-D sorts naturally)
//   bool           — center, "Yes" / "—", boolean sort

import {
  getMembershipReport,
  getPTReport,
  getPTRoster,
  getPTNewClients,
  getSessionFrequency,
  getDeactivatedPT,
  getPTProjections,
} from './api'

// Title-case a loose name string ("jane SMITH" -> "Jane Smith"). Names arrive
// in mixed casing across sources; the summary views capitalize on render, so we
// match that here for a clean spreadsheet.
function titleCase(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim()
}

// Matches the summary views that OMIT location_slug entirely for "all" so the
// cache key lines up (Membership, Day One).
function dateLocOmitAll({ startDate, endDate, locationSlug }) {
  const params = {}
  if (startDate) params.start_date = startDate
  if (endDate) params.end_date = endDate
  if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
  return params
}

// Matches the PT-family summaries that always send location_slug ("all" included).
function dateLocAlwaysAll({ startDate, endDate, locationSlug }) {
  return { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' }
}

const span = ({ startDate, endDate }) => `${startDate || 'start'}_${endDate || 'end'}`
const loc = ({ locationSlug }) => (locationSlug && locationSlug !== 'all' ? locationSlug : 'all')

export const REPORT_DETAIL = {
  membership: {
    fetch: getMembershipReport,
    buildParams: dateLocOmitAll,
    filename: a => `membership-detail-${loc(a)}-${span(a)}`,
    columns: [
      { key: 'salesperson', label: 'Salesperson' },
      { key: 'name', label: 'Member' },
      { key: 'membership_type', label: 'Membership Type' },
      { key: 'since_date', label: 'Sign Date', type: 'date' },
      { key: 'day_one_booked', label: 'Day One', type: 'bool' },
      { key: 'vips', label: 'VIPs', type: 'number' },
      { key: 'same_day', label: 'Same Day', type: 'bool' },
    ],
    flatten: data => {
      const out = []
      for (const [sp, stats] of Object.entries(data?.by_salesperson || {})) {
        const salesperson = sp === 'Unassigned' ? 'Online' : sp
        for (const m of stats?.members || []) {
          out.push({
            salesperson,
            name: m.name || '',
            membership_type: m.membership_type || '',
            since_date: m.since_date || '',
            day_one_booked: !!m.day_one_booked,
            vips: m.vip_count || 0,
            same_day: !!m.same_day_sale,
          })
        }
      }
      return out
    },
  },

  pt: {
    fetch: getPTReport,
    buildParams: dateLocOmitAll,
    filename: a => `day-one-detail-${loc(a)}-${span(a)}`,
    columns: [
      { key: 'name', label: 'Name' },
      { key: 'booked_by', label: 'Booked By' },
      { key: 'booking_date', label: 'Booking Date', type: 'date' },
      { key: 'day_one_date', label: 'Day One Date', type: 'date' },
      { key: 'trainer', label: 'Trainer' },
      { key: 'status', label: 'Status' },
      { key: 'sale', label: 'Sale' },
      { key: 'pt_sale_type', label: 'PT Sale Type' },
      { key: 'why_no_sale', label: 'Why No Sale' },
    ],
    flatten: data => (data?.contacts || []).map(c => ({
      name: titleCase(`${c.first_name || ''} ${c.last_name || ''}`),
      booked_by: c.day_one_booking_team_member || '',
      booking_date: c.day_one_booking_date || '',
      day_one_date: c.day_one_date || '',
      trainer: c.day_one_trainer || '',
      status: c.day_one_status || '',
      sale: c.day_one_sale || '',
      pt_sale_type: c.pt_sale_type || '',
      why_no_sale: c.why_no_sale || '',
    })),
  },

  'pt-roster': {
    fetch: getPTRoster,
    buildParams: ({ locationSlug }) => ({ location_slug: locationSlug || 'all' }),
    filename: a => `pt-roster-detail-${loc(a)}`,
    columns: [
      { key: 'trainer', label: 'Trainer' },
      { key: 'name', label: 'Member' },
      { key: 'type', label: 'Type' },
      { key: 'club', label: 'Club' },
      { key: 'monthly_revenue', label: 'Monthly Revenue', type: 'money' },
      { key: 'sessions_left', label: 'Sessions Left', type: 'number' },
      { key: 'total_bought', label: 'Total Bought', type: 'number' },
      { key: 'plan', label: 'Plan' },
    ],
    flatten: data => (data?.clients || []).map(c => {
      const isRS = c.clientType === 'recurring'
      return {
        trainer: titleCase(c.trainer || 'Unassigned'),
        name: titleCase(c.name || ''),
        type: isRS ? 'Recurring' : (c.clientType === 'pif' ? 'PIF' : (c.clientType || '')),
        club: c.clubName || '',
        monthly_revenue: isRS ? (c.monthlyRevenue || 0) : null,
        sessions_left: c.service?.sessionsLeft ?? null,
        total_bought: c.service?.totalBought ?? null,
        plan: c.service?.planName || c.service?.serviceItem || '',
      }
    }),
  },

  'pt-new-clients': {
    fetch: getPTNewClients,
    buildParams: dateLocAlwaysAll,
    filename: a => `pt-new-clients-detail-${loc(a)}-${span(a)}`,
    columns: [
      { key: 'sale_date', label: 'Sale Date', type: 'date' },
      { key: 'classification', label: 'Classification' },
      { key: 'type', label: 'Type' },
      { key: 'name', label: 'Member' },
      { key: 'package', label: 'Package' },
      { key: 'price', label: 'Price', type: 'money' },
      { key: 'commission_emp', label: 'Commission Emp' },
      { key: 'service_emp', label: 'Service Emp' },
      { key: 'club', label: 'Club' },
    ],
    flatten: data => (data?.rows || []).map(r => ({
      sale_date: r.saleDate || '',
      classification: r.classification || '',
      type: r.type || '',
      name: r.memberName || '',
      package: r.package || '',
      price: r.price || 0,
      commission_emp: r.commissionEmployee || '',
      service_emp: r.serviceEmployee || '',
      club: r.clubName || '',
    })),
  },

  'session-frequency': {
    fetch: getSessionFrequency,
    buildParams: dateLocAlwaysAll,
    filename: a => `session-frequency-detail-${loc(a)}-${span(a)}`,
    columns: [
      { key: 'club', label: 'Club' },
      { key: 'name', label: 'Member' },
      { key: 'trainer', label: 'Trainer' },
      { key: 'current_sessions', label: 'Current Sessions', type: 'number' },
      { key: 'current_per_week', label: 'Current / Wk', type: 'decimal' },
      { key: 'prior_sessions', label: 'Prior Sessions', type: 'number' },
      { key: 'prior_per_week', label: 'Prior / Wk', type: 'decimal' },
    ],
    flatten: data => (data?.rows || []).map(r => ({
      club: r.clubName || '',
      name: r.memberName || '',
      trainer: r.serviceEmployee || '',
      current_sessions: r.currentSessions ?? 0,
      current_per_week: r.currentPerWeek ?? 0,
      prior_sessions: r.priorSessions ?? 0,
      prior_per_week: r.priorPerWeek ?? 0,
    })),
  },

  'deactivated-pt': {
    fetch: getDeactivatedPT,
    buildParams: dateLocAlwaysAll,
    filename: a => `deactivated-pt-detail-${loc(a)}-${span(a)}`,
    columns: [
      { key: 'cancel_date', label: 'Cancel Date', type: 'date' },
      { key: 'type', label: 'Type' },
      { key: 'name', label: 'Member' },
      { key: 'package', label: 'Package' },
      { key: 'value', label: 'Value', type: 'money' },
      { key: 'sale_date', label: 'Sale Date', type: 'date' },
      { key: 'trainer', label: 'Trainer' },
      { key: 'club', label: 'Club' },
    ],
    flatten: data => (data?.rows || []).map(r => ({
      cancel_date: r.cancelDate || '',
      type: r.type || '',
      name: r.memberName || '',
      package: r.package || '',
      value: r.value || 0,
      sale_date: r.saleDate || '',
      trainer: r.serviceEmployee || '',
      club: r.clubName || '',
    })),
  },

  'pt-projections': {
    fetch: getPTProjections,
    buildParams: dateLocAlwaysAll,
    filename: a => `pt-projections-detail-${loc(a)}-${span(a)}`,
    columns: [
      { key: 'name', label: 'Member' },
      { key: 'trainer', label: 'Trainer' },
      { key: 'location', label: 'Location' },
      { key: 'next_billing', label: 'Next Billing', type: 'date' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'status', label: 'Status' },
    ],
    flatten: data => (data?.members || []).map(r => ({
      name: r.name || '',
      trainer: r.trainer || '',
      location: r.location || '',
      next_billing: r.nextBillingDate || '',
      amount: r.amount || 0,
      status: r.status || '',
    })),
  },
}

// Reports that expose a "See Detail" tab, in no particular order.
export function hasReportDetail(reportKey) {
  return !!reportKey && Object.prototype.hasOwnProperty.call(REPORT_DETAIL, reportKey)
}

export function getReportDetail(reportKey) {
  if (!reportKey) return null
  return REPORT_DETAIL[reportKey] || null
}
