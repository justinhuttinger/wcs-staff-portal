// auth/src/services/kpiDigest/queries.js
// Pulls the week's digest data from the kpi_digest_week RPC (migration 091).
// All aggregation and the ghl_contacts_report gotchas (epoch-ms text dates,
// per-column name-spacing) live in SQL; this just calls it.
'use strict'

const { supabaseAdmin } = require('../supabase')
const { MIN_SALES, MIN_DAYONES } = require('./config')

// Returns { window:{start,end}, totals:{sales,booked,d1_sales},
//           day_one_sales:[{club,trainer,member,pkg}],
//           roster:[{club,person,sales,day_ones}] }.
async function fetchWeek({ start, end }) {
  const { data, error } = await supabaseAdmin.rpc('kpi_digest_week', {
    p_start: start,
    p_end: end,
    p_min_sales: MIN_SALES,
    p_min_dayones: MIN_DAYONES,
  })
  if (error) throw new Error(`kpi_digest_week RPC failed: ${error.message}`)
  if (!data) throw new Error('kpi_digest_week returned no data')
  return data
}

module.exports = { fetchWeek }
