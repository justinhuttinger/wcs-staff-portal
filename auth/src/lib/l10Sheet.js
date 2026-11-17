// The L10 By Club table, laid out in Google Sheets to look like the report.
//
// Pure: takes the table as the page drew it and returns the sheet definitions
// and batchUpdate requests. The route sends them (services/googleSheets).
//
// THE PAGE SENDS FORMATTED TEXT, NOT NUMBERS, for the styled tab. "+$12,973
// (+4.6%)" and which way is better (Lost Members going up is red) are decided
// once, in the component, and the sheet prints what the screen printed rather
// than re-deriving it and risking a second answer.
//
// Each cell is the value with its change underneath, in one cell, as on screen:
// one text with two runs — the value at body size, the change smaller and
// coloured. That makes the styled tab text, so a second tab carries the raw
// numbers for anyone who wants to sum or sort.

const hex = h => {
  const v = h.replace('#', '')
  return {
    red: parseInt(v.slice(0, 2), 16) / 255,
    green: parseInt(v.slice(2, 4), 16) / 255,
    blue: parseInt(v.slice(4, 6), 16) / 255,
  }
}

// The portal's default theme (portal/src/index.css) and the Tailwind colours
// the report uses.
const C = {
  ink: hex('#1a1a2e'),
  muted: hex('#6b6b7a'),
  border: hex('#e2e4e8'),
  zebra: hex('#f0f0f1'), // text-primary at 6% over white, as tableTints.ZEBRA_TINT
  white: hex('#ffffff'),
  good: hex('#059669'), // emerald-600
  bad: hex('#e53e3e'), // wcs-red
}
const TONE = { good: C.good, bad: C.bad, neutral: C.muted }
const FONT = 'Inter'

const STYLED = 0
const DATA = 1

// Rows above the table: title, subtitle, a spacer.
const TOP = 3

const LIMITS = { columns: 30, rows: 50, text: 80 }

const str = (v, max = LIMITS.text) => typeof v === 'string' && v.length <= max

/** Is this the shape the page sends? A bad body is a 400, never half a sheet. */
function validSpec(spec) {
  if (!spec || typeof spec !== 'object') return false
  if (!str(spec.heading) || (spec.subheading !== undefined && !str(spec.subheading, 300))) return false
  const cols = spec.columns
  if (!Array.isArray(cols) || cols.length < 2 || cols.length > LIMITS.columns || !cols.every(c => str(c))) return false
  const rows = spec.rows
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > LIMITS.rows) return false
  return rows.every(r => r && str(r.label) && Array.isArray(r.cells) && r.cells.length === cols.length - 1
    && r.cells.every(c => c && str(c.main) && (c.sub === undefined || str(c.sub))
      && (c.tone === undefined || Object.prototype.hasOwnProperty.call(TONE, c.tone))))
}

function text(value, format, align = 'LEFT') {
  return {
    userEnteredValue: { stringValue: value },
    userEnteredFormat: {
      textFormat: { fontFamily: FONT, ...format },
      horizontalAlignment: align,
      verticalAlignment: 'MIDDLE',
      padding: { left: 10, right: 10, top: 4, bottom: 4 },
    },
  }
}

function headerCell(label, i, bg) {
  const c = text(label.toUpperCase(), { fontSize: 8, bold: true, foregroundColor: C.muted }, i === 0 ? 'LEFT' : 'RIGHT')
  c.userEnteredFormat.backgroundColor = bg
  return c
}

function clubCell(label, bg) {
  const c = text(label, { fontSize: 10, bold: true, foregroundColor: C.ink })
  c.userEnteredFormat.backgroundColor = bg
  return c
}

function valueCell(cell, bold, bg) {
  const main = cell.main
  const sub = cell.sub || ''
  const value = sub ? `${main}\n${sub}` : main
  return {
    userEnteredValue: { stringValue: value },
    userEnteredFormat: {
      backgroundColor: bg,
      textFormat: { fontFamily: FONT, fontSize: 10, bold, foregroundColor: C.ink },
      horizontalAlignment: 'RIGHT',
      verticalAlignment: 'MIDDLE',
      wrapStrategy: 'WRAP',
      padding: { left: 10, right: 10, top: 4, bottom: 4 },
    },
    textFormatRuns: sub
      ? [
          { startIndex: 0, format: { fontFamily: FONT, fontSize: 10, bold, foregroundColor: C.ink } },
          { startIndex: main.length + 1, format: { fontFamily: FONT, fontSize: 8, bold: false, foregroundColor: TONE[cell.tone] || C.muted } },
        ]
      : undefined,
  }
}

const solid = (color, style = 'SOLID') => ({ style, color })

/**
 * @param spec  { heading, subheading, columns, rows: [{ label, total, cells: [{ main, sub, tone }] }] }
 * @param data  raw rows for the Data tab, header first
 */
function buildL10Sheet(spec, data) {
  const nCols = spec.columns.length
  const nRows = spec.rows.length
  const tableStart = TOP
  const tableEnd = TOP + 1 + nRows // exclusive

  const cellRows = [
    { values: [text(spec.heading, { fontSize: 14, bold: true, foregroundColor: C.ink })] },
    { values: [text(spec.subheading || '', { fontSize: 9, foregroundColor: C.muted })] },
    { values: [] },
    { values: spec.columns.map((c, i) => headerCell(c, i, C.white)) },
    ...spec.rows.map((r, i) => {
      // Zebra exactly as the page: the first body row is tinted.
      const bg = i % 2 === 0 ? C.zebra : C.white
      return { values: [clubCell(r.total ? 'Total' : r.label, bg), ...r.cells.map(c => valueCell(c, !!r.total, bg))] }
    }),
  ]

  const requests = [
    { updateCells: { rows: cellRows, fields: 'userEnteredValue,userEnteredFormat,textFormatRuns', start: { sheetId: STYLED, rowIndex: 0, columnIndex: 0 } } },
    // Widths: the club column a little wider, every metric column the same,
    // as the table on screen.
    { updateDimensionProperties: { range: { sheetId: STYLED, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: STYLED, dimension: 'COLUMNS', startIndex: 1, endIndex: nCols }, properties: { pixelSize: 140 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: STYLED, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 30 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: STYLED, dimension: 'ROWS', startIndex: 2, endIndex: 3 }, properties: { pixelSize: 10 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: STYLED, dimension: 'ROWS', startIndex: tableStart, endIndex: tableStart + 1 }, properties: { pixelSize: 32 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId: STYLED, dimension: 'ROWS', startIndex: tableStart + 1, endIndex: tableEnd }, properties: { pixelSize: 46 }, fields: 'pixelSize' } },
    // The card outline and the row rules.
    {
      updateBorders: {
        range: { sheetId: STYLED, startRowIndex: tableStart, endRowIndex: tableEnd, startColumnIndex: 0, endColumnIndex: nCols },
        top: solid(C.border), bottom: solid(C.border), left: solid(C.border), right: solid(C.border),
        innerHorizontal: solid(C.border),
      },
    },
  ]

  // The Total row is set off by a heavier rule above it, as on screen.
  const totalIdx = spec.rows.findIndex(r => r.total)
  if (totalIdx >= 0) {
    const row = tableStart + 1 + totalIdx
    requests.push({
      updateBorders: {
        range: { sheetId: STYLED, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: nCols },
        top: solid(C.border, 'SOLID_MEDIUM'),
      },
    })
  }

  // The raw numbers, plain, for summing and sorting.
  const dataRows = Array.isArray(data) ? data : []
  const dataCols = dataRows.reduce((m, r) => Math.max(m, r.length), 1)
  if (dataRows.length) {
    requests.push(
      {
        updateCells: {
          rows: dataRows.map((r, i) => ({
            values: r.map(v => ({
              userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: v == null ? '' : String(v) },
              userEnteredFormat: { textFormat: { fontFamily: FONT, fontSize: 10, bold: i === 0 || i === dataRows.length - 1 } },
            })),
          })),
          fields: 'userEnteredValue,userEnteredFormat',
          start: { sheetId: DATA, rowIndex: 0, columnIndex: 0 },
        },
      },
      { updateSheetProperties: { properties: { sheetId: DATA, gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 } }, fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount' } },
      { autoResizeDimensions: { dimensions: { sheetId: DATA, dimension: 'COLUMNS', startIndex: 0, endIndex: dataCols } } },
    )
  }

  const sheets = [
    { sheetId: STYLED, title: 'By Club', rowCount: tableEnd + 2, columnCount: nCols, hideGridlines: true },
  ]
  if (dataRows.length) {
    sheets.push({ sheetId: DATA, title: 'Data', rowCount: dataRows.length + 2, columnCount: dataCols })
  }
  return { sheets, requests }
}

module.exports = { buildL10Sheet, validSpec, LIMITS }
