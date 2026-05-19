// Smoke test: feed trends12moExcel with hand-rolled data and write the
// resulting xlsx to disk so we can inspect it without hitting Supabase.
//
// Run from /auth:  node scripts/smoke-trends-excel.js
//
// Output: ./trends-12mo-smoke.xlsx in cwd.

const fs = require('fs')
const path = require('path')
const { buildTrendsWorkbook } = require('../src/services/trends12moExcel')

function fakeData() {
  const months = []
  const flows = []
  const revenue = []
  const demographics = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const asOf = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10)
    months.push(key)
    const added = 80 + Math.round(Math.random() * 40)
    const dropped = 50 + Math.round(Math.random() * 30)
    flows.push({
      month: key,
      added_members: added,
      dropped_members: dropped,
      net_members: added - dropped,
      added_agreements: added - 5,
      dropped_agreements: dropped - 2,
      net_agreements: (added - 5) - (dropped - 2),
      active_members_eom: 3000 + (12 - i) * 30,
      active_agreements_eom: 2800 + (12 - i) * 28,
    })
    revenue.push({
      month: key,
      total: 180000 + Math.random() * 60000,
      by_profit_center: {
        'Monthly Dues': 95000 + Math.random() * 15000,
        'Personal Training': 45000 + Math.random() * 12000,
        'Pro Shop': 8000 + Math.random() * 3000,
        'Annual Fee': 12000 + Math.random() * 5000,
        'Initiation Fee': 18000 + Math.random() * 6000,
      },
      by_club: {},
    })
    demographics.push({
      month: key,
      as_of: asOf,
      total: { members: 3000 + (12 - i) * 30, agreements: 2800 + (12 - i) * 28 },
      by_age: {
        '<18': { members: 40, agreements: 38 },
        '18-24': { members: 320, agreements: 310 },
        '25-34': { members: 880, agreements: 850 },
        '35-44': { members: 740, agreements: 710 },
        '45-54': { members: 580, agreements: 560 },
        '55-64': { members: 320, agreements: 310 },
        '65+': { members: 120, agreements: 115 },
      },
      by_gender: {
        'F': { members: 1700, agreements: 1620 },
        'M': { members: 1400, agreements: 1340 },
        'Unknown': { members: 50, agreements: 48 },
      },
      by_membership_type: {
        'Gold': { members: 1400, agreements: 1380 },
        'Silver': { members: 900, agreements: 880 },
        'Platinum': { members: 400, agreements: 390 },
        'Student': { members: 250, agreements: 240 },
        'Family': { members: 180, agreements: 60 }, // multi-member agreements
      },
      by_club: {
        '30935': { members: 600, agreements: 580 },
        '7655': { members: 700, agreements: 680 },
      },
      by_club_labeled: {
        'Salem': { members: 600, agreements: 580 },
        'Eugene': { members: 700, agreements: 680 },
      },
    })
  }
  return {
    meta: {
      generated_at: new Date().toISOString(),
      end_month: months[months.length - 1],
      start_month: months[0],
      months,
      club_numbers: null,
      location_slugs: null,
      skip_types: [],
    },
    member_flows: flows,
    revenue,
    demographics,
    active_today: {
      date: new Date().toISOString().slice(0, 10),
      total: { members: 3360, agreements: 3220 },
      by_age: demographics[demographics.length - 1].by_age,
      by_gender: demographics[demographics.length - 1].by_gender,
      by_membership_type: demographics[demographics.length - 1].by_membership_type,
      by_club: demographics[demographics.length - 1].by_club,
      by_club_labeled: demographics[demographics.length - 1].by_club_labeled,
    },
  }
}

;(async () => {
  const t0 = Date.now()
  const buf = await buildTrendsWorkbook(fakeData())
  const ms = Date.now() - t0
  const out = path.resolve(process.cwd(), 'trends-12mo-smoke.xlsx')
  fs.writeFileSync(out, buf)
  console.log(`wrote ${out} (${buf.length.toLocaleString()} bytes, ${ms}ms)`)
})().catch(err => {
  console.error('SMOKE FAILED:', err.message)
  console.error(err.stack)
  process.exit(1)
})
