// Recombine per-membership-type rows from membership_audit_summary into overall
// totals. Averages must be member-weighted (not an average of per-type averages):
// avg dues = sum(total_monthly_dues) / sum(paying); avg tenure = sum(tenure) /
// count(members with begin_date).
function recombineTotals(byType) {
  let active = 0, paying = 0, nonDues = 0, totalDues = 0, tenSum = 0, tenCnt = 0, leaks = 0
  for (const r of byType || []) {
    active    += Number(r.members) || 0
    paying    += Number(r.paying) || 0
    nonDues   += Number(r.non_dues) || 0
    totalDues += Number(r.total_monthly_dues) || 0
    tenSum    += Number(r.tenure_sum_months) || 0
    tenCnt    += Number(r.tenure_count) || 0
    leaks     += Number(r.leaks) || 0
  }
  return {
    active_members:     active,
    paying_members:     paying,
    non_dues_members:   nonDues,
    avg_monthly_dues:   paying ? Math.round((totalDues / paying) * 100) / 100 : 0,
    total_monthly_dues: Math.round(totalDues * 100) / 100,
    avg_tenure_months:  tenCnt ? Math.round((tenSum / tenCnt) * 10) / 10 : 0,
    leak_count:         leaks,
  }
}

module.exports = { recombineTotals }
