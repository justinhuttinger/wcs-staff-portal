/**
 * Export table data to CSV and trigger download
 * @param {string[][]} rows - Array of rows, first row is headers
 * @param {string} filename - Download filename (without extension)
 */
export function exportCSV(rows, filename) {
  const csv = rows
    .map(row => row.map(cell => {
      const str = String(cell ?? '')
      // Escape quotes and wrap in quotes if contains comma/quote/newline
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    }).join(','))
    .join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename + '.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Print the current page (for PDF export via browser print dialog)
 */
export function exportPDF(reportName) {
  const prev = document.title
  if (reportName) document.title = reportName
  window.print()
  document.title = prev
}
