// 12-Month Trends Excel workbook builder.
//
// Consumes the structured object from trends12mo.gatherTrends12mo() and
// produces an .xlsx Buffer with multiple sheets + embedded PNG charts.
//
// Dependencies (added lazily so the route module can load even if these
// aren't installed — runtime error surfaces only when generation runs):
//   - exceljs         (workbook + image embedding)
//   - chartjs-node-canvas + chart.js  (PNG chart rendering)
//   - canvas          (peer dep of chartjs-node-canvas; prebuilt binaries)
//
// Chart palette matches the WCS portal accent (red) with neutral fills for
// secondary series.

const WCS_RED = '#c0102f'
const WCS_RED_LIGHT = '#e8516a'
const NEUTRAL_DARK = '#2f3540'
const NEUTRAL_MID = '#7a8492'
const NEUTRAL_LIGHT = '#c4ccd6'
const PALETTE = [
  WCS_RED, NEUTRAL_DARK, '#3b82f6', '#10b981', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', NEUTRAL_MID, '#84cc16',
  '#f97316', '#0ea5e9', NEUTRAL_LIGHT, '#a855f7', '#22c55e',
]

const CHART_W = 900
const CHART_H = 360
const PIE_W = 480
const PIE_H = 360

// ---------------------------------------------------------------------------
// Lazy renderer — initialise chartjs-node-canvas once per builder run.
// ---------------------------------------------------------------------------
function makeRenderer() {
  const { ChartJSNodeCanvas } = require('chartjs-node-canvas')
  const wide = new ChartJSNodeCanvas({
    width: CHART_W, height: CHART_H, backgroundColour: '#ffffff',
  })
  const pie = new ChartJSNodeCanvas({
    width: PIE_W, height: PIE_H, backgroundColour: '#ffffff',
  })
  return { wide, pie }
}

// ---------------------------------------------------------------------------
// Chart config builders.
// ---------------------------------------------------------------------------
function lineConfig({ labels, datasets, title, yLabel }) {
  return {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        borderColor: d.color || PALETTE[i % PALETTE.length],
        backgroundColor: (d.color || PALETTE[i % PALETTE.length]) + '22',
        borderWidth: 2,
        tension: 0.25,
        pointRadius: 3,
        fill: false,
      })),
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: { display: !!title, text: title, font: { size: 14, weight: 'bold' } },
        legend: { position: 'top', labels: { font: { size: 11 } } },
      },
      scales: {
        x: { ticks: { font: { size: 10 } } },
        y: {
          title: { display: !!yLabel, text: yLabel, font: { size: 11 } },
          ticks: { font: { size: 10 } },
        },
      },
    },
  }
}

function barConfig({ labels, datasets, title, yLabel, stacked = false }) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d, i) => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color || PALETTE[i % PALETTE.length],
      })),
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: { display: !!title, text: title, font: { size: 14, weight: 'bold' } },
        legend: { position: 'top', labels: { font: { size: 11 } } },
      },
      scales: {
        x: { stacked, ticks: { font: { size: 10 } } },
        y: {
          stacked,
          title: { display: !!yLabel, text: yLabel, font: { size: 11 } },
          ticks: { font: { size: 10 } },
        },
      },
    },
  }
}

function pieConfig({ labels, data, title }) {
  // Filter zero-value slices and bake percentages directly into the legend
  // labels (e.g. "Salem  18%"). More reliable than chartjs-plugin-datalabels,
  // which crashes on small/empty arc elements.
  const pairs = labels.map((l, i) => ({ label: l, value: Number(data[i]) || 0 }))
                       .filter(p => p.value > 0)
  const total = pairs.reduce((s, p) => s + p.value, 0)
  const labeled = pairs.map(p => {
    const pct = total > 0 ? Math.round((p.value / total) * 100) : 0
    const num = p.value.toLocaleString()
    return `${p.label}  ${pct}% (${num})`
  })
  return {
    type: 'doughnut',
    data: {
      labels: labeled,
      datasets: [{
        data: pairs.map(p => p.value),
        backgroundColor: labeled.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 1,
        borderColor: '#ffffff',
      }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: {
        title: { display: !!title, text: title, font: { size: 14, weight: 'bold' } },
        legend: { position: 'right', labels: { font: { size: 11 }, boxWidth: 14 } },
      },
      cutout: '45%',
    },
  }
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------
function setHeader(row, labels) {
  row.values = labels
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  row.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF2F3540' },
  }
  row.alignment = { horizontal: 'left', vertical: 'middle' }
}

function autoWidth(sheet, mins = {}) {
  sheet.columns.forEach((col, i) => {
    let max = mins[i] || 10
    col.eachCell({ includeEmpty: false }, cell => {
      const len = (cell.value == null ? '' : String(cell.value)).length
      if (len > max) max = len
    })
    col.width = Math.min(40, max + 2)
  })
}

async function addImageBelow(workbook, sheet, png, anchorCellRow, colSpan, rowSpan) {
  const imageId = workbook.addImage({ buffer: png, extension: 'png' })
  sheet.addImage(imageId, {
    tl: { col: 0, row: anchorCellRow - 1 },
    ext: { width: colSpan, height: rowSpan },
  })
}


// Convert an image height in pixels to an approximate row count. Excel rows
// are ~20px each by default; pad a couple to leave breathing room.
function chartRowSpan(heightPx) {
  return Math.ceil(heightPx / 20) + 2
}

// Render a multi-line chart with one series per club. Returns the PNG buffer.
async function renderPerClubLine(renderer, { perClub, metricKey, monthLabels, title, yLabel }) {
  return renderer.renderToBuffer(lineConfig({
    labels: monthLabels,
    datasets: perClub.map((c, i) => ({
      label: c.name,
      data: c.monthly.map(row => row[metricKey] || 0),
      color: PALETTE[i % PALETTE.length],
    })),
    title,
    yLabel,
  }))
}

// Render a stacked bar chart with one series per club (positive contributions).
async function renderPerClubStacked(renderer, { perClub, metricKey, monthLabels, title, yLabel }) {
  return renderer.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: perClub.map((c, i) => ({
      label: c.name,
      data: c.monthly.map(row => row[metricKey] || 0),
      color: PALETTE[i % PALETTE.length],
    })),
    title,
    yLabel,
    stacked: true,
  }))
}

// Build a pivot table on `sheet` starting at row `startRow` with header
// row [Month, ...club names], then one row per month with metricKey value.
// Returns the row index immediately AFTER the last data row.
function writePerClubPivot(sheet, startRow, { perClub, metricKey, months, monthLabels, currency = false }) {
  setHeader(sheet.getRow(startRow), ['Month', ...perClub.map(c => c.name), 'Total'])
  let cursor = startRow + 1
  for (let i = 0; i < months.length; i++) {
    const vals = perClub.map(c => c.monthly[i][metricKey] || 0)
    const total = vals.reduce((s, v) => s + v, 0)
    sheet.getRow(cursor).values = [monthLabels[i], ...vals, total]
    cursor += 1
  }
  if (currency) {
    for (let c = 2; c <= 2 + perClub.length; c++) {
      sheet.getColumn(c).numFmt = '"$"#,##0.00'
    }
  }
  return cursor
}

// Section header used to introduce each per-location block.
function writeSectionHeader(sheet, row, text) {
  sheet.getCell(`A${row}`).value = text
  sheet.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: 'FF2F3540' } }
  return row + 1
}

// ---------------------------------------------------------------------------
// Main entrypoint.
// ---------------------------------------------------------------------------
async function buildTrendsWorkbook(data) {
  const ExcelJS = require('exceljs')
  const { wide, pie } = makeRenderer()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'WCS Staff Portal'
  workbook.created = new Date()
  workbook.title = '12-Month Trends Report'

  const months = data.meta.months // ['YYYY-MM', ...]
  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-')
    const d = new Date(Date.UTC(Number(y), Number(mo) - 1, 1))
    return d.toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  })

  // ===== Summary sheet =====
  const summary = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: 'FFC0102F' } },
  })
  summary.getCell('A1').value = '12-Month Trends Report'
  summary.getCell('A1').font = { size: 18, bold: true, color: { argb: 'FFC0102F' } }
  summary.mergeCells('A1:F1')

  const locLabel = data.meta.location_slugs && data.meta.location_slugs.length
    ? data.meta.location_slugs.map(s => s[0].toUpperCase() + s.slice(1)).join(', ')
    : 'All locations'
  summary.getCell('A2').value = `Locations: ${locLabel}`
  summary.getCell('A3').value = `Range: ${data.meta.start_month} → ${data.meta.end_month}`
  summary.getCell('A4').value = `Generated: ${new Date(data.meta.generated_at).toLocaleString()}`
  for (const cell of ['A2', 'A3', 'A4']) {
    summary.getCell(cell).font = { color: { argb: 'FF7A8492' }, size: 11 }
  }

  // KPI totals
  const totalAdded = data.member_flows.reduce((s, m) => s + m.added_members, 0)
  const totalDropped = data.member_flows.reduce((s, m) => s + m.dropped_members, 0)
  const totalRevenue = data.revenue.reduce((s, m) => s + m.total, 0)
  const activeNow = data.active_today.total.members

  setHeader(summary.getRow(6), ['Metric', 'Value'])
  summary.addRows([
    ['Members added (12 mo)', totalAdded],
    ['Members dropped (12 mo)', totalDropped],
    ['Net member change', totalAdded - totalDropped],
    ['Revenue total (12 mo)', totalRevenue],
    ['Active members (today)', activeNow],
    ['Active agreements (today)', data.active_today.total.agreements],
  ])
  // Currency format on revenue cell
  summary.getCell(`B${6 + 4}`).numFmt = '"$"#,##0.00'
  summary.getColumn(1).width = 32
  summary.getColumn(2).width = 18

  // Chart 1: net members per month (line)
  const netLine = await wide.renderToBuffer(lineConfig({
    labels: monthLabels,
    datasets: [
      { label: 'Added', data: data.member_flows.map(m => m.added_members), color: WCS_RED },
      { label: 'Dropped', data: data.member_flows.map(m => m.dropped_members), color: NEUTRAL_MID },
      { label: 'Net', data: data.member_flows.map(m => m.net_members), color: NEUTRAL_DARK },
    ],
    title: 'Members — Added / Dropped / Net (12 mo)',
    yLabel: 'Members',
  }))
  await addImageBelow(workbook, summary, netLine, 14, CHART_W, CHART_H)

  // Chart 2: revenue line
  const revLine = await wide.renderToBuffer(lineConfig({
    labels: monthLabels,
    datasets: [{ label: 'Total revenue', data: data.revenue.map(m => m.total), color: WCS_RED }],
    title: 'Revenue (12 mo)',
    yLabel: 'USD',
  }))
  await addImageBelow(workbook, summary, revLine, 34, CHART_W, CHART_H)

  // Chart 3: per-location net members (one line per club)
  const summaryPerLocNet = await renderPerClubLine(wide, {
    perClub: data.per_club_flows,
    metricKey: 'net_members',
    monthLabels,
    title: 'Net member change by location',
    yLabel: 'Net members',
  })
  await addImageBelow(workbook, summary, summaryPerLocNet, 54, CHART_W, CHART_H)

  // Chart 4: per-location revenue (one line per club)
  const summaryPerLocRev = await renderPerClubLine(wide, {
    perClub: data.per_club_revenue,
    metricKey: 'total',
    monthLabels,
    title: 'Revenue by location',
    yLabel: 'USD',
  })
  await addImageBelow(workbook, summary, summaryPerLocRev, 74, CHART_W, CHART_H)

  // ===== Members sheet =====
  const ms = workbook.addWorksheet('Members')
  setHeader(ms.getRow(1), ['Month', 'Added', 'Dropped', 'Net', 'Active (EOM)'])
  ms.addRows(data.member_flows.map(m => [
    m.month, m.added_members, m.dropped_members, m.net_members, m.active_members_eom,
  ]))
  autoWidth(ms, { 0: 12, 1: 10, 2: 10, 3: 10, 4: 14 })

  const memberBar = await wide.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: [
      { label: 'Added', data: data.member_flows.map(m => m.added_members), color: WCS_RED },
      { label: 'Dropped', data: data.member_flows.map(m => -m.dropped_members), color: NEUTRAL_MID },
    ],
    title: 'Members added (positive) vs dropped (negative)',
    yLabel: 'Members',
  }))
  await addImageBelow(workbook, ms, memberBar, data.member_flows.length + 3, CHART_W, CHART_H)

  // Per-location pivots + multi-line charts
  let msCursor = data.member_flows.length + 3 + chartRowSpan(CHART_H)
  msCursor = writeSectionHeader(ms, msCursor, 'Members added — by location')
  msCursor = writePerClubPivot(ms, msCursor, {
    perClub: data.per_club_flows, metricKey: 'added_members', months, monthLabels,
  })
  msCursor += 1
  const msAddedByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'added_members', monthLabels,
    title: 'Members added — by location', yLabel: 'Members',
  })
  await addImageBelow(workbook, ms, msAddedByLoc, msCursor, CHART_W, CHART_H)
  msCursor += chartRowSpan(CHART_H)

  msCursor = writeSectionHeader(ms, msCursor, 'Members dropped — by location')
  msCursor = writePerClubPivot(ms, msCursor, {
    perClub: data.per_club_flows, metricKey: 'dropped_members', months, monthLabels,
  })
  msCursor += 1
  const msDroppedByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'dropped_members', monthLabels,
    title: 'Members dropped — by location', yLabel: 'Members',
  })
  await addImageBelow(workbook, ms, msDroppedByLoc, msCursor, CHART_W, CHART_H)
  msCursor += chartRowSpan(CHART_H)

  msCursor = writeSectionHeader(ms, msCursor, 'Active members (end of month) — by location')
  msCursor = writePerClubPivot(ms, msCursor, {
    perClub: data.per_club_flows, metricKey: 'active_members_eom', months, monthLabels,
  })
  msCursor += 1
  const msActiveByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'active_members_eom', monthLabels,
    title: 'Active members (EOM) — by location', yLabel: 'Members',
  })
  await addImageBelow(workbook, ms, msActiveByLoc, msCursor, CHART_W, CHART_H)
  msCursor += chartRowSpan(CHART_H)

  msCursor = writeSectionHeader(ms, msCursor, 'Net change (added − dropped) — by location')
  msCursor = writePerClubPivot(ms, msCursor, {
    perClub: data.per_club_flows, metricKey: 'net_members', months, monthLabels,
  })
  msCursor += 1
  const msNetByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'net_members', monthLabels,
    title: 'Net member change — by location', yLabel: 'Net members',
  })
  await addImageBelow(workbook, ms, msNetByLoc, msCursor, CHART_W, CHART_H)

  // ===== Agreements sheet =====
  const ag = workbook.addWorksheet('Agreements')
  setHeader(ag.getRow(1), ['Month', 'Added', 'Dropped', 'Net', 'Active (EOM)'])
  ag.addRows(data.member_flows.map(m => [
    m.month, m.added_agreements, m.dropped_agreements, m.net_agreements, m.active_agreements_eom,
  ]))
  autoWidth(ag, { 0: 12, 1: 10, 2: 10, 3: 10, 4: 14 })

  const agreementBar = await wide.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: [
      { label: 'Added', data: data.member_flows.map(m => m.added_agreements), color: WCS_RED },
      { label: 'Dropped', data: data.member_flows.map(m => -m.dropped_agreements), color: NEUTRAL_MID },
    ],
    title: 'Agreements added vs dropped',
    yLabel: 'Agreements',
  }))
  await addImageBelow(workbook, ag, agreementBar, data.member_flows.length + 3, CHART_W, CHART_H)

  // Per-location pivots + multi-line charts
  let agCursor = data.member_flows.length + 3 + chartRowSpan(CHART_H)
  agCursor = writeSectionHeader(ag, agCursor, 'Agreements added — by location')
  agCursor = writePerClubPivot(ag, agCursor, {
    perClub: data.per_club_flows, metricKey: 'added_agreements', months, monthLabels,
  })
  agCursor += 1
  const agAddedByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'added_agreements', monthLabels,
    title: 'Agreements added — by location', yLabel: 'Agreements',
  })
  await addImageBelow(workbook, ag, agAddedByLoc, agCursor, CHART_W, CHART_H)
  agCursor += chartRowSpan(CHART_H)

  agCursor = writeSectionHeader(ag, agCursor, 'Agreements dropped — by location')
  agCursor = writePerClubPivot(ag, agCursor, {
    perClub: data.per_club_flows, metricKey: 'dropped_agreements', months, monthLabels,
  })
  agCursor += 1
  const agDroppedByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'dropped_agreements', monthLabels,
    title: 'Agreements dropped — by location', yLabel: 'Agreements',
  })
  await addImageBelow(workbook, ag, agDroppedByLoc, agCursor, CHART_W, CHART_H)
  agCursor += chartRowSpan(CHART_H)

  agCursor = writeSectionHeader(ag, agCursor, 'Active agreements (end of month) — by location')
  agCursor = writePerClubPivot(ag, agCursor, {
    perClub: data.per_club_flows, metricKey: 'active_agreements_eom', months, monthLabels,
  })
  agCursor += 1
  const agActiveByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'active_agreements_eom', monthLabels,
    title: 'Active agreements (EOM) — by location', yLabel: 'Agreements',
  })
  await addImageBelow(workbook, ag, agActiveByLoc, agCursor, CHART_W, CHART_H)
  agCursor += chartRowSpan(CHART_H)

  agCursor = writeSectionHeader(ag, agCursor, 'Net change (added − dropped) — by location')
  agCursor = writePerClubPivot(ag, agCursor, {
    perClub: data.per_club_flows, metricKey: 'net_agreements', months, monthLabels,
  })
  agCursor += 1
  const agNetByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'net_agreements', monthLabels,
    title: 'Net agreement change — by location', yLabel: 'Net agreements',
  })
  await addImageBelow(workbook, ag, agNetByLoc, agCursor, CHART_W, CHART_H)

  // ===== Revenue sheet =====
  const rev = workbook.addWorksheet('Revenue')
  // Top 10 profit centers by 12-mo total
  const pcTotals = {}
  for (const m of data.revenue) {
    for (const [pc, amt] of Object.entries(m.by_profit_center || {})) {
      pcTotals[pc] = (pcTotals[pc] || 0) + amt
    }
  }
  const topPCs = Object.entries(pcTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pc]) => pc)

  setHeader(rev.getRow(1), ['Month', 'Total', ...topPCs])
  data.revenue.forEach(m => {
    rev.addRow([
      m.month,
      m.total,
      ...topPCs.map(pc => m.by_profit_center[pc] || 0),
    ])
  })
  // Currency format on numeric columns
  const lastRow = data.revenue.length + 1
  for (let c = 2; c <= 2 + topPCs.length; c++) {
    rev.getColumn(c).numFmt = '"$"#,##0.00'
  }
  autoWidth(rev, { 0: 12, 1: 14 })

  const revStack = await wide.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: topPCs.map((pc, i) => ({
      label: pc,
      data: data.revenue.map(m => m.by_profit_center[pc] || 0),
      color: PALETTE[i % PALETTE.length],
    })),
    title: 'Revenue by profit center (top 10)',
    yLabel: 'USD',
    stacked: true,
  }))
  await addImageBelow(workbook, rev, revStack, lastRow + 2, CHART_W, CHART_H)

  // Per-location pivot + line chart + stacked bar
  let revCursor = lastRow + 2 + chartRowSpan(CHART_H)
  revCursor = writeSectionHeader(rev, revCursor, 'Revenue — by location')
  revCursor = writePerClubPivot(rev, revCursor, {
    perClub: data.per_club_revenue, metricKey: 'total', months, monthLabels, currency: true,
  })
  revCursor += 1
  const revPerLocLine = await renderPerClubLine(wide, {
    perClub: data.per_club_revenue, metricKey: 'total', monthLabels,
    title: 'Revenue trend by location', yLabel: 'USD',
  })
  await addImageBelow(workbook, rev, revPerLocLine, revCursor, CHART_W, CHART_H)
  revCursor += chartRowSpan(CHART_H)

  const revPerLocStack = await renderPerClubStacked(wide, {
    perClub: data.per_club_revenue, metricKey: 'total', monthLabels,
    title: 'Revenue composition by location (stacked)', yLabel: 'USD',
  })
  await addImageBelow(workbook, rev, revPerLocStack, revCursor, CHART_W, CHART_H)

  // ===== Demographics sheet =====
  const dem = workbook.addWorksheet('Demographics')
  let cursor = 1

  // Collect union of keys across months so the pivot is consistent.
  const collectKeys = (field) => {
    const set = new Set()
    for (const d of data.demographics) {
      for (const k of Object.keys(d[field] || {})) set.add(k)
    }
    return [...set]
  }

  const AGE_ORDER = ['<18', '18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown']
  const ageKeys = AGE_ORDER.filter(a => collectKeys('by_age').includes(a))
  const genderKeysAll = collectKeys('by_gender')
  const typeKeys = collectKeys('by_membership_type')
    .map(k => ({ k, total: data.demographics.reduce((s, d) => s + (d.by_membership_type[k]?.members || 0), 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map(o => o.k)

  // --- Age pivot ---
  dem.getCell(`A${cursor}`).value = 'Active members by age bucket (end of month)'
  dem.getCell(`A${cursor}`).font = { bold: true, size: 13 }
  cursor += 1
  setHeader(dem.getRow(cursor), ['Month', ...ageKeys])
  cursor += 1
  const ageStartRow = cursor
  for (const d of data.demographics) {
    dem.getRow(cursor).values = [d.month, ...ageKeys.map(k => d.by_age[k]?.members || 0)]
    cursor += 1
  }
  cursor += 1

  // Age chart
  const ageChart = await wide.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: ageKeys.map((k, i) => ({
      label: k,
      data: data.demographics.map(d => d.by_age[k]?.members || 0),
      color: PALETTE[i % PALETTE.length],
    })),
    title: 'Age distribution by month',
    yLabel: 'Members',
    stacked: true,
  }))
  await addImageBelow(workbook, dem, ageChart, cursor, CHART_W, CHART_H)
  cursor += 20

  // --- Gender pivot ---
  dem.getCell(`A${cursor}`).value = 'Active members by gender (end of month)'
  dem.getCell(`A${cursor}`).font = { bold: true, size: 13 }
  cursor += 1
  setHeader(dem.getRow(cursor), ['Month', ...genderKeysAll])
  cursor += 1
  for (const d of data.demographics) {
    dem.getRow(cursor).values = [d.month, ...genderKeysAll.map(k => d.by_gender[k]?.members || 0)]
    cursor += 1
  }
  cursor += 1

  const genderDatasets = genderKeysAll.map((k, i) => ({
    label: k,
    data: data.demographics.map(d => d.by_gender[k]?.members || 0),
    color: PALETTE[i % PALETTE.length],
  }))
  const genderChart = await wide.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: genderDatasets,
    title: 'Gender distribution by month (counts)',
    yLabel: 'Members',
    stacked: true,
  }))
  await addImageBelow(workbook, dem, genderChart, cursor, CHART_W, CHART_H)
  cursor += chartRowSpan(CHART_H)

  // Percentage view — separate table so user can read the gender ratio per
  // month easily without scanning a stacked-bar visually.
  cursor = writeSectionHeader(dem, cursor, 'Gender distribution by month (percentages)')
  setHeader(dem.getRow(cursor), ['Month', ...genderKeysAll])
  cursor += 1
  for (let i = 0; i < data.demographics.length; i++) {
    const d = data.demographics[i]
    const total = genderKeysAll.reduce((s, k) => s + (d.by_gender[k]?.members || 0), 0)
    const pctRow = [monthLabels[i]]
    for (const k of genderKeysAll) {
      const v = d.by_gender[k]?.members || 0
      pctRow.push(total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—')
    }
    dem.getRow(cursor).values = pctRow
    cursor += 1
  }
  cursor += 1

  // --- Membership type pivot ---
  dem.getCell(`A${cursor}`).value = 'Active members by membership type (top 10, end of month) — note: type reflects CURRENT value, not as-of date'
  dem.getCell(`A${cursor}`).font = { bold: true, size: 13 }
  cursor += 1
  setHeader(dem.getRow(cursor), ['Month', ...typeKeys])
  cursor += 1
  for (const d of data.demographics) {
    dem.getRow(cursor).values = [d.month, ...typeKeys.map(k => d.by_membership_type[k]?.members || 0)]
    cursor += 1
  }
  cursor += 1

  const typeChart = await wide.renderToBuffer(barConfig({
    labels: monthLabels,
    datasets: typeKeys.map((k, i) => ({
      label: k,
      data: data.demographics.map(d => d.by_membership_type[k]?.members || 0),
      color: PALETTE[i % PALETTE.length],
    })),
    title: 'Membership type distribution by month (top 10)',
    yLabel: 'Members',
    stacked: true,
  }))
  await addImageBelow(workbook, dem, typeChart, cursor, CHART_W, CHART_H)
  cursor += 20

  // --- Active total line ---
  dem.getCell(`A${cursor}`).value = 'Active member total — reconstructed end-of-month roster'
  dem.getCell(`A${cursor}`).font = { bold: true, size: 13 }
  cursor += 1
  const activeLine = await wide.renderToBuffer(lineConfig({
    labels: monthLabels,
    datasets: [
      {
        label: 'Active members (EOM)',
        data: data.demographics.map(d => d.total.members),
        color: WCS_RED,
      },
      {
        label: 'Active agreements (EOM)',
        data: data.demographics.map(d => d.total.agreements),
        color: NEUTRAL_DARK,
      },
    ],
    title: 'Active members / agreements — end of month',
    yLabel: 'Count',
  }))
  await addImageBelow(workbook, dem, activeLine, cursor, CHART_W, CHART_H)
  cursor += chartRowSpan(CHART_H)

  // Per-location active member trend (single chart — full age/gender/type
  // breakdown per club would be 4D and overwhelming; the EOM total per club
  // is the most useful comparison)
  cursor = writeSectionHeader(dem, cursor, 'Active members (end of month) — by location')
  cursor = writePerClubPivot(dem, cursor, {
    perClub: data.per_club_flows, metricKey: 'active_members_eom', months, monthLabels,
  })
  cursor += 1
  const demPerLocLine = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'active_members_eom', monthLabels,
    title: 'Active members (EOM) — by location', yLabel: 'Members',
  })
  await addImageBelow(workbook, dem, demPerLocLine, cursor, CHART_W, CHART_H)
  cursor += chartRowSpan(CHART_H)

  cursor = writeSectionHeader(dem, cursor, 'Net change (added − dropped) — by location')
  cursor = writePerClubPivot(dem, cursor, {
    perClub: data.per_club_flows, metricKey: 'net_members', months, monthLabels,
  })
  cursor += 1
  const demNetByLoc = await renderPerClubLine(wide, {
    perClub: data.per_club_flows, metricKey: 'net_members', monthLabels,
    title: 'Net member change — by location', yLabel: 'Net members',
  })
  await addImageBelow(workbook, dem, demNetByLoc, cursor, CHART_W, CHART_H)
  cursor += chartRowSpan(CHART_H)

  // ----- Average age trend -----
  cursor = writeSectionHeader(dem, cursor, 'Average age of active members (end of month)')
  setHeader(dem.getRow(cursor), ['Month', 'Avg age (all locations)', ...data.meta.clubs.map(c => c.name)])
  cursor += 1
  for (let i = 0; i < data.demographics.length; i++) {
    const d = data.demographics[i]
    dem.getRow(cursor).values = [
      monthLabels[i],
      d.avg_age,
      ...data.meta.clubs.map(c => d.avg_age_by_club?.[c.club_number] ?? null),
    ]
    cursor += 1
  }
  cursor += 1
  const avgAgeAll = await wide.renderToBuffer(lineConfig({
    labels: monthLabels,
    datasets: [{
      label: 'Avg age (all locations)',
      data: data.demographics.map(d => d.avg_age ?? null),
      color: WCS_RED,
    }],
    title: 'Average age of active members — all locations',
    yLabel: 'Years',
  }))
  await addImageBelow(workbook, dem, avgAgeAll, cursor, CHART_W, CHART_H)
  cursor += chartRowSpan(CHART_H)

  const avgAgeByClub = await wide.renderToBuffer(lineConfig({
    labels: monthLabels,
    datasets: data.meta.clubs.map((c, i) => ({
      label: c.name,
      data: data.demographics.map(d => d.avg_age_by_club?.[c.club_number] ?? null),
      color: PALETTE[i % PALETTE.length],
    })),
    title: 'Average age of active members — by location',
    yLabel: 'Years',
  }))
  await addImageBelow(workbook, dem, avgAgeByClub, cursor, CHART_W, CHART_H)

  autoWidth(dem, { 0: 12 })

  // ===== Active Roster (Today) sheet =====
  const at = workbook.addWorksheet('Active Roster (Today)')
  at.getCell('A1').value = `Active roster snapshot — ${data.active_today.date}`
  at.getCell('A1').font = { size: 14, bold: true }
  at.getCell('A2').value = `Total members: ${data.active_today.total.members} • Total agreements: ${data.active_today.total.agreements}`

  // Age pie + table
  const todayAgeKeys = AGE_ORDER.filter(k => data.active_today.by_age?.[k])
  const agePie = await pie.renderToBuffer(pieConfig({
    labels: todayAgeKeys,
    data: todayAgeKeys.map(k => data.active_today.by_age[k].members),
    title: 'Age distribution',
  }))
  await addImageBelow(workbook, at, agePie, 4, PIE_W, PIE_H)

  // Gender pie
  const todayGenderKeys = Object.keys(data.active_today.by_gender || {})
  const genderPie = await pie.renderToBuffer(pieConfig({
    labels: todayGenderKeys,
    data: todayGenderKeys.map(k => data.active_today.by_gender[k].members),
    title: 'Gender distribution',
  }))
  await addImageBelow(workbook, at, genderPie, 24, PIE_W, PIE_H)

  // Membership type pie (top 10)
  const typeEntries = Object.entries(data.active_today.by_membership_type || {})
    .sort((a, b) => b[1].members - a[1].members)
    .slice(0, 10)
  const typePie = await pie.renderToBuffer(pieConfig({
    labels: typeEntries.map(([k]) => k),
    data: typeEntries.map(([, v]) => v.members),
    title: 'Membership type (top 10)',
  }))
  await addImageBelow(workbook, at, typePie, 44, PIE_W, PIE_H)

  // Club distribution table (lower-right)
  const clubRowStart = 64
  setHeader(at.getRow(clubRowStart), ['Club', 'Members', 'Agreements'])
  let cr = clubRowStart + 1
  for (const [club, v] of Object.entries(data.active_today.by_club_labeled || {})) {
    at.getRow(cr).values = [club, v.members, v.agreements]
    cr += 1
  }
  cr += 1
  cr = writeSectionHeader(at, cr, 'Comparison across locations — today')
  const clubBars = await wide.renderToBuffer(barConfig({
    labels: data.meta.clubs.map(c => c.name),
    datasets: [
      {
        label: 'Active members',
        data: data.meta.clubs.map(c => data.active_today.by_club?.[c.club_number]?.members || 0),
        color: WCS_RED,
      },
      {
        label: 'Active agreements',
        data: data.meta.clubs.map(c => data.active_today.by_club?.[c.club_number]?.agreements || 0),
        color: NEUTRAL_DARK,
      },
    ],
    title: 'Active members & agreements per club (today)',
    yLabel: 'Count',
  }))
  await addImageBelow(workbook, at, clubBars, cr, CHART_W, CHART_H)
  autoWidth(at, { 0: 14 })

  // ===== Raw Data sheet =====
  const raw = workbook.addWorksheet('Raw Data', { state: 'hidden' })
  raw.getCell('A1').value = 'Raw rollup data backing every chart in this workbook.'
  raw.getCell('A1').font = { italic: true, color: { argb: 'FF7A8492' } }
  raw.addRow([])
  raw.addRow(['member_flows'])
  setHeader(raw.getRow(raw.rowCount + 1), [
    'month', 'added_members', 'dropped_members', 'net_members',
    'added_agreements', 'dropped_agreements', 'net_agreements',
    'active_members_eom', 'active_agreements_eom',
  ])
  for (const m of data.member_flows) {
    raw.addRow([
      m.month, m.added_members, m.dropped_members, m.net_members,
      m.added_agreements, m.dropped_agreements, m.net_agreements,
      m.active_members_eom, m.active_agreements_eom,
    ])
  }
  raw.addRow([])
  raw.addRow(['revenue (totals only — see Revenue sheet for profit center breakdown)'])
  setHeader(raw.getRow(raw.rowCount + 1), ['month', 'total'])
  for (const m of data.revenue) raw.addRow([m.month, m.total])

  raw.addRow([])
  raw.addRow(['demographics (counts shown — type/gender/club reflect current row values)'])
  setHeader(raw.getRow(raw.rowCount + 1), ['month', 'total_members', 'total_agreements'])
  for (const d of data.demographics) raw.addRow([d.month, d.total.members, d.total.agreements])

  // ===== Generate buffer =====
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
}

module.exports = { buildTrendsWorkbook }
