/**
 * ABC /members/recurringservices puller for the Payroll report.
 *
 * Filters by saleTimestampRange so we only get services SOLD in the period.
 * Computes a 4% commission on total contract value.
 *
 * Total contract value rules:
 *   - PIF (recurringTypeDesc contains "Paid in Full"): invoiceTotal * 1
 *   - Recurring monthly: invoiceTotal * totalPeriods
 *   - Fallback: invoiceTotal * max(totalPeriods, 1)
 */
const axios = require('axios');
const supabase = require('../db/supabase');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const COMMISSION_RATE = 0.04;
const PAGE_SIZE = 200;

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function periodForDate(saleDate) {
  // saleDate is YYYY-MM-DD or null. Returns first-of-month as YYYY-MM-DD.
  if (!saleDate) return null;
  const m = String(saleDate).match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-01`;
}

function totalContractValue(svc) {
  const invoice = parseFloat(svc.invoiceTotal || '0') || 0;
  const periods = parseInt(svc.totalPeriods || '1', 10) || 1;
  // For PIF the invoiceTotal IS the full amount; totalPeriods is typically 1.
  // For monthly recurring, multiply.
  return Math.round(invoice * Math.max(periods, 1) * 100) / 100;
}

async function fetchRecurringServicesForRange(clubNumber, fromDate, toDate, page = 1) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  const range = `${fmtDate(fromDate)},${fmtDate(toDate)}`;
  // Build query manually so the comma in saleTimestampRange isn't URL-encoded
  // (ABC's gateway treats encoded commas differently).
  const qs = `saleTimestampRange=${range}&size=${PAGE_SIZE}&page=${page}`;
  const url = `${ABC_BASE_URL}/${clubNumber}/members/recurringservices?${qs}`;
  const res = await axios.get(url, {
    headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
    timeout: 60000,
  });
  return res.data?.recurringServices || [];
}

// Pull /{club}/employees once and build an id -> "First Last" map. Used to
// resolve `commissionsEmployeeIds` on recurring service rows. Returns an empty
// Map on failure so callers can still fall back to serviceEmployee* fields.
async function fetchEmployeeMap(clubNumber) {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    throw new Error('ABC_APP_ID and ABC_APP_KEY must be set');
  }
  try {
    const url = `${ABC_BASE_URL}/${clubNumber}/employees`;
    const res = await axios.get(url, {
      headers: { app_id: ABC_APP_ID, app_key: ABC_APP_KEY, Accept: 'application/json' },
      timeout: 30000,
    });
    const map = new Map();
    for (const emp of (res.data?.employees || [])) {
      const id = emp.employeeId || emp.id;
      if (!id) continue;
      const first = (emp.personal?.firstName || '').trim();
      const last = (emp.personal?.lastName || '').trim();
      const name = `${first} ${last}`.trim();
      if (name) map.set(id, name);
    }
    return map;
  } catch (err) {
    console.warn(`[Payroll] /employees fetch failed for ${clubNumber}: ${err.message}`);
    return new Map();
  }
}

// Pick the commission recipient(s) for a recurring service. Source of truth is
// `commissionsEmployeeIds` (array) resolved via the per-club employee map.
// Returns { id, name } where `id` is the first ID (for table grouping) and
// `name` joins all resolved names. Falls back to serviceEmployee* fields if
// the array is missing/unresolved.
function resolveCommissionEmployee(svc, empMap) {
  const ids = Array.isArray(svc.commissionsEmployeeIds) ? svc.commissionsEmployeeIds : [];
  if (ids.length) {
    const names = ids.map((id) => empMap?.get(id)).filter(Boolean);
    if (names.length) {
      return { id: ids[0], name: names.join(', ') };
    }
    // IDs present but none resolved — still record the first ID so future
    // backfills can fix it once /employees is reachable.
    return {
      id: ids[0],
      name: `${(svc.serviceEmployeeFirstName || '').trim()} ${(svc.serviceEmployeeLastName || '').trim()}`.trim() || null,
    };
  }
  return {
    id: svc.serviceEmployeeId || null,
    name: `${(svc.serviceEmployeeFirstName || '').trim()} ${(svc.serviceEmployeeLastName || '').trim()}`.trim() || null,
  };
}

function transformRecurringService(svc, clubNumber, empMap) {
  const saleDate = svc.recurringServiceDates?.saleDate || null;
  const period = periodForDate(saleDate);
  const totalValue = totalContractValue(svc);
  const commission = Math.round(totalValue * COMMISSION_RATE * 100) / 100;

  const memberName = `${(svc.memberFirstName || '').trim()} ${(svc.memberLastName || '').trim()}`.trim() || null;
  const { id: employeeId, name: employeeName } = resolveCommissionEmployee(svc, empMap);

  return {
    recurring_service_id: svc.recurringServiceId,
    club_number: clubNumber,
    period,
    sale_date: saleDate,
    member_id: svc.memberId || null,
    member_name: memberName,
    employee_id: employeeId,
    employee_name: employeeName || null,
    service_item: svc.serviceItem || null,
    recurring_type_desc: svc.recurringTypeDesc || null,
    invoice_total: parseFloat(svc.invoiceTotal || '0') || 0,
    total_periods: parseInt(svc.totalPeriods || '1', 10) || 1,
    total_contract_value: totalValue,
    commission_rate: COMMISSION_RATE,
    commission,
    fetched_at: new Date().toISOString(),
    raw: svc,
  };
}

/**
 * Pull all recurring services SOLD during [fromDate, toDate] for one club,
 * compute commissions, and upsert into payroll_recurring_commissions.
 * Returns the number of rows upserted.
 */
async function syncRecurringCommissionsForClub(clubNumber, fromDate, toDate, sleepMs = 100) {
  const empMap = await fetchEmployeeMap(clubNumber);
  console.log(`[Payroll] ${clubNumber} employee map: ${empMap.size} active employees`);
  let total = 0;
  let page = 1;
  while (true) {
    const services = await fetchRecurringServicesForRange(clubNumber, fromDate, toDate, page);
    if (services.length === 0) break;

    const rows = services
      .filter((s) => s.recurringServiceId)
      .map((s) => transformRecurringService(s, clubNumber, empMap))
      .filter((r) => r.period); // skip rows missing a sale_date / period

    if (rows.length > 0) {
      const { error } = await supabase
        .from('payroll_recurring_commissions')
        .upsert(rows, { onConflict: 'club_number,recurring_service_id' });
      if (error) {
        console.error(`[Payroll] ${clubNumber} p${page} upsert error: ${error.message}`);
      } else {
        total += rows.length;
      }
    }
    console.log(`[Payroll] ${clubNumber} p${page}: ${services.length} fetched, ${rows.length} kept`);
    if (services.length < PAGE_SIZE) break;
    page += 1;
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }
  return total;
}

module.exports = {
  fetchRecurringServicesForRange,
  fetchEmployeeMap,
  syncRecurringCommissionsForClub,
  transformRecurringService,
  resolveCommissionEmployee,
  totalContractValue,
  periodForDate,
  COMMISSION_RATE,
};
