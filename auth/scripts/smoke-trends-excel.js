// Smoke test: feed trends12moExcel with hand-rolled data and write the
// resulting xlsx to disk so we can inspect it without hitting Supabase.
//
// Run from /auth:  node scripts/smoke-trends-excel.js
//
// Output: ./trends-12mo-smoke.xlsx in cwd.

const fs = require('fs')
const path = require('path')
const { buildTrendsWorkbook } = require('../src/services/trends12moExcel')

const CLUBS = [
  { slug: 'salem',       club_number: '30935', name: 'Salem' },
  { slug: 'keizer',      club_number: '31599', name: 'Keizer' },
  { slug: 'eugene',      club_number: '7655',  name: 'Eugene' },
  { slug: 'springfield', club_number: '31598', name: 'Springfield' },
  { slug: 'clackamas',   club_number: '31600', name: 'Clackamas' },
  { slug: 'milwaukie',   club_number: '31601', name: 'Milwaukie' },
  { slug: 'medford',     club_number: '32073', name: 'Medford' },
]

function rand(min, max) { return min + Math.round(Math.random() * (max - min)) }

function fakeData() {
  const months = []
  const flows = []
  const revenue = []
  const demographics = []
  const perClubFlows = CLUBS.map(c => ({ ...c, monthly: [] }))
  const perClubRevenue = CLUBS.map(c => ({ ...c, monthly: [] }))
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const asOf = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10)
    months.push(key)

    // Per-club this month
    const perClubAdded = {}
    const perClubDropped = {}
    const perClubRev = {}
    const perClubActiveMem = {}
    const perClubActiveAg = {}
    let totalAdded = 0
    let totalDropped = 0
    let totalRev = 0
    let totalActive = 0
    let totalActiveAg = 0
    for (let ci = 0; ci < CLUBS.length; ci++) {
      const c = CLUBS[ci]
      const a = rand(60, 150)
      const dr = rand(40, 95)
      const r = rand(20000, 45000)
      const active = rand(380, 620) + (12 - i) * 4
      const activeAg = Math.round(active * 0.95)
      perClubAdded[c.club_number] = a
      perClubDropped[c.club_number] = dr
      perClubRev[c.slug] = r
      perClubActiveMem[c.club_number] = active
      perClubActiveAg[c.club_number] = activeAg
      totalAdded += a
      totalDropped += dr
      totalRev += r
      totalActive += active
      totalActiveAg += activeAg
      perClubFlows[ci].monthly.push({
        month: key,
        added_members: a,
        dropped_members: dr,
        net_members: a - dr,
        added_agreements: Math.max(0, a - 3),
        dropped_agreements: Math.max(0, dr - 1),
        net_agreements: Math.max(0, a - 3) - Math.max(0, dr - 1),
        active_members_eom: active,
        active_agreements_eom: activeAg,
      })
      perClubRevenue[ci].monthly.push({ month: key, total: r })
    }

    flows.push({
      month: key,
      added_members: totalAdded,
      dropped_members: totalDropped,
      net_members: totalAdded - totalDropped,
      added_agreements: totalAdded - 21,
      dropped_agreements: totalDropped - 7,
      net_agreements: (totalAdded - 21) - (totalDropped - 7),
      active_members_eom: totalActive,
      active_agreements_eom: totalActiveAg,
    })
    revenue.push({
      month: key,
      total: totalRev,
      by_profit_center: {
        'Monthly Dues': Math.round(totalRev * 0.55),
        'Personal Training': Math.round(totalRev * 0.25),
        'Annual Fee': Math.round(totalRev * 0.08),
        'Initiation Fee': Math.round(totalRev * 0.07),
        'Pro Shop': Math.round(totalRev * 0.05),
      },
      by_club: perClubRev,
    })

    // build a by_club for demographics keyed by club_number
    const byClub = {}
    const byClubLabeled = {}
    for (const c of CLUBS) {
      byClub[c.club_number] = {
        members: perClubActiveMem[c.club_number],
        agreements: perClubActiveAg[c.club_number],
      }
      byClubLabeled[c.name] = byClub[c.club_number]
    }
    // Fake avg-age per month and per club (drift slightly month-to-month).
    const avgAgeBase = 36 + Math.sin(i / 2) * 0.5
    const avgAgeByClub = {}
    for (const c of CLUBS) {
      avgAgeByClub[c.club_number] = +(avgAgeBase + (Math.random() - 0.5) * 4).toFixed(2)
    }

    demographics.push({
      month: key,
      as_of: asOf,
      total: { members: totalActive, agreements: totalActiveAg },
      avg_age: +avgAgeBase.toFixed(2),
      avg_age_by_club: avgAgeByClub,
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
        'F': { members: Math.round(totalActive * 0.51), agreements: Math.round(totalActiveAg * 0.51) },
        'M': { members: Math.round(totalActive * 0.46), agreements: Math.round(totalActiveAg * 0.46) },
        'Unknown': { members: Math.round(totalActive * 0.03), agreements: Math.round(totalActiveAg * 0.03) },
      },
      by_membership_type: {
        'Gold': { members: Math.round(totalActive * 0.42), agreements: Math.round(totalActiveAg * 0.43) },
        'Silver': { members: Math.round(totalActive * 0.27), agreements: Math.round(totalActiveAg * 0.27) },
        'Platinum': { members: Math.round(totalActive * 0.12), agreements: Math.round(totalActiveAg * 0.12) },
        'Student': { members: Math.round(totalActive * 0.07), agreements: Math.round(totalActiveAg * 0.07) },
        'Family': { members: Math.round(totalActive * 0.05), agreements: Math.round(totalActiveAg * 0.05) },
      },
      by_club: byClub,
      by_club_labeled: byClubLabeled,
    })
  }

  const last = demographics[demographics.length - 1]
  return {
    meta: {
      generated_at: new Date().toISOString(),
      end_month: months[months.length - 1],
      start_month: months[0],
      months,
      club_numbers: null,
      location_slugs: null,
      skip_types: [],
      clubs: CLUBS,
    },
    member_flows: flows,
    per_club_flows: perClubFlows,
    revenue,
    per_club_revenue: perClubRevenue,
    demographics,
    active_today: {
      date: new Date().toISOString().slice(0, 10),
      total: last.total,
      by_age: last.by_age,
      by_gender: last.by_gender,
      by_membership_type: last.by_membership_type,
      by_club: last.by_club,
      by_club_labeled: last.by_club_labeled,
      avg_age: last.avg_age,
      avg_age_by_club: last.avg_age_by_club,
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
