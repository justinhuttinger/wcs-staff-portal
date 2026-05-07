/**
 * Google Sheets export helper. Designed to be reused across reports.
 *
 * Auth model: the caller passes in an `accessToken` for the Google
 * account that should *own* the resulting Sheet. With per-user OAuth
 * (see services/googleUserToken.js), each staff member's exports land
 * in their own Drive.
 *
 * Public API:
 *   exportToGoogleSheet({
 *     accessToken,      // required — Google OAuth access_token
 *     title,            // spreadsheet name
 *     rows,             // 2D array of cell values (numbers/strings)
 *     boldRowIndices,   // optional zero-based row indices to bold
 *     folderId,         // optional Drive folder ID to move the file into
 *     shareWith,        // optional array of emails to grant writer access
 *   }) -> { id, url }
 */

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files'

async function googleJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = { _raw: text }
  }
  if (!res.ok) {
    const msg = body.error?.message || body._raw || `HTTP ${res.status}`
    throw new Error(`Google API ${res.status}: ${msg}`)
  }
  return body
}

function toCellValue(v) {
  if (v == null || v === '') return { userEnteredValue: { stringValue: '' } }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return { userEnteredValue: { numberValue: v } }
  }
  if (typeof v === 'boolean') {
    return { userEnteredValue: { boolValue: v } }
  }
  return { userEnteredValue: { stringValue: String(v) } }
}

async function exportToGoogleSheet({
  accessToken,
  title,
  rows,
  boldRowIndices = [],
  folderId = null,
  shareWith = [],
}) {
  if (!accessToken) throw new Error('accessToken required')
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('rows must be a non-empty 2D array')
  }

  // 1. Create the spreadsheet (single tab, sized to fit our data).
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const create = await googleJson(SHEETS_BASE, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [
        {
          properties: {
            sheetId: 0,
            title: 'Report',
            gridProperties: { rowCount: rows.length + 10, columnCount: Math.max(colCount, 1) },
          },
        },
      ],
    }),
  })
  const spreadsheetId = create.spreadsheetId
  const url = create.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`

  // 2. Write all rows in a single batchUpdate (updateCells). This handles
  //    typed values better than the values.update text endpoint and lets
  //    us apply bold formatting in the same request.
  const cellRows = rows.map((row) => ({
    values: row.map(toCellValue),
  }))

  const requests = [
    {
      updateCells: {
        rows: cellRows,
        fields: 'userEnteredValue',
        start: { sheetId: 0, rowIndex: 0, columnIndex: 0 },
      },
    },
    {
      updateSheetProperties: {
        properties: { sheetId: 0, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ]

  // Apply bold to caller-specified rows + the very first row.
  const boldRows = new Set([0, ...boldRowIndices.filter((i) => Number.isInteger(i) && i >= 0)])
  for (const rowIdx of boldRows) {
    if (rowIdx >= rows.length) continue
    requests.push({
      repeatCell: {
        range: {
          sheetId: 0,
          startRowIndex: rowIdx,
          endRowIndex: rowIdx + 1,
          startColumnIndex: 0,
          endColumnIndex: Math.max(colCount, 1),
        },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    })
  }

  // Auto-resize columns at the end so widths fit content.
  requests.push({
    autoResizeDimensions: {
      dimensions: {
        sheetId: 0,
        dimension: 'COLUMNS',
        startIndex: 0,
        endIndex: Math.max(colCount, 1),
      },
    },
  })

  await googleJson(`${SHEETS_BASE}/${spreadsheetId}:batchUpdate`, accessToken, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  })

  // 3. Optionally move the file into a Drive folder. New Sheets land in
  //    My Drive root; Drive's parents API lets us add the target folder
  //    and remove root in one PATCH.
  if (folderId) {
    try {
      const meta = await googleJson(
        `${DRIVE_BASE}/${spreadsheetId}?fields=parents`,
        accessToken
      )
      const removeParents = (meta.parents || []).join(',')
      const params = new URLSearchParams({ addParents: folderId })
      if (removeParents) params.set('removeParents', removeParents)
      await googleJson(`${DRIVE_BASE}/${spreadsheetId}?${params.toString()}`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify({}),
      })
    } catch (err) {
      // Move is best-effort; the file still exists at the returned URL.
      console.warn('[googleSheets] Drive folder move failed:', err.message)
    }
  }

  // 4. Optionally share. Each permission call is independent; soft-fail
  //    one without breaking the export.
  for (const email of shareWith) {
    if (!email) continue
    try {
      await googleJson(`${DRIVE_BASE}/${spreadsheetId}/permissions?sendNotificationEmail=false`, accessToken, {
        method: 'POST',
        body: JSON.stringify({
          type: 'user',
          role: 'writer',
          emailAddress: email,
        }),
      })
    } catch (err) {
      console.warn(`[googleSheets] Share with ${email} failed:`, err.message)
    }
  }

  return { id: spreadsheetId, url }
}

module.exports = { exportToGoogleSheet }
