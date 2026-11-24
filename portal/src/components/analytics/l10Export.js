// L10 PDF export: the By Club table, captured from the page.
//
// Loaded on demand from L10, so html-to-image and jsPDF only download when
// somebody actually exports (the same arrangement as memberMapExport).
//
// A CAPTURE, NOT A REDRAWING. The table is rendered to a canvas exactly as it
// sits on screen — fonts, zebra rows, coloured changes, the Total rule — and
// placed on the page under a title. Redrawing it with jsPDF's own text calls
// would be a second layout that could only ever approximate the first.
//
// Landscape: the whole table on one page.
// Portrait: the table is too wide for a portrait page at a readable size, so
// its metric columns are split across two pages, each repeating the Club
// column. Both pages are slices of the same capture.

import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

/**
 * Left/right edges (CSS px, relative to the card's outer edge) of each header
 * cell, measured with the card scrolled fully left so the sticky Club column
 * sits where it does in the capture.
 */
function columnEdges(el) {
  const prev = el.scrollLeft
  el.scrollLeft = 0
  const origin = el.getBoundingClientRect().left
  const edges = [...el.querySelectorAll('thead th')].map(th => {
    const r = th.getBoundingClientRect()
    return [r.left - origin, r.right - origin]
  })
  el.scrollLeft = prev
  return edges
}

/** Split metric columns into two runs of roughly equal width. */
function splitColumns(edges) {
  const metrics = edges.slice(1)
  if (metrics.length < 2) return [metrics]
  const widths = metrics.map(([l, r]) => r - l)
  const total = widths.reduce((a, b) => a + b, 0)
  let best = 1, bestDiff = Infinity, run = 0
  for (let k = 1; k < metrics.length; k++) {
    run += widths[k - 1]
    const diff = Math.abs(total - 2 * run)
    if (diff < bestDiff) { bestDiff = diff; best = k }
  }
  return [metrics.slice(0, best), metrics.slice(best)]
}

/**
 * A new canvas holding the Club column, one run of metric columns, and the
 * card's right border, side by side. Each part is a separate horizontal strip
 * of the full capture.
 */
function sliceCanvas(canvas, ratio, clubRight, run, borderPx) {
  const parts = [
    [0, clubRight],
    [run[0][0], run[run.length - 1][1]],
    [canvas.width / ratio - borderPx, canvas.width / ratio],
  ].map(([l, r]) => [Math.round(l * ratio), Math.round(r * ratio)])
  const out = document.createElement('canvas')
  out.width = parts.reduce((w, [l, r]) => w + (r - l), 0)
  out.height = canvas.height
  const ctx = out.getContext('2d')
  let x = 0
  for (const [l, r] of parts) {
    ctx.drawImage(canvas, l, 0, r - l, canvas.height, x, 0, r - l, canvas.height)
    x += r - l
  }
  return out
}

/**
 * @param el    the By Club table's card element
 * @param opts  { title, subtitle, filename, orientation: 'landscape' | 'portrait' }
 */
export async function exportTablePdf(el, { title, subtitle, filename, orientation = 'landscape' }) {
  // The card scrolls sideways on a narrow window; capture all of it, not the
  // visible slice.
  // offset* includes the card's border; scroll* does not, and clipped it.
  const width = Math.max(el.scrollWidth, el.offsetWidth)
  const height = Math.max(el.scrollHeight, el.offsetHeight)
  const edges = orientation === 'portrait' ? columnEdges(el) : null
  const canvas = await toCanvas(el, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    width,
    height,
    style: { overflow: 'visible', width: `${width}px`, maxWidth: 'none' },
  })

  let images = [canvas]
  if (edges && edges.length > 2) {
    const ratio = canvas.width / width
    const border = parseFloat(getComputedStyle(el).borderRightWidth) || 0
    images = splitColumns(edges).map(run => sliceCanvas(canvas, ratio, edges[0][1], run, border))
  }

  const doc = new jsPDF({ orientation, unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 32

  images.forEach((img, i) => {
    if (i > 0) doc.addPage()
    const pageNote = images.length > 1 ? `  ·  Page ${i + 1} of ${images.length}` : ''

    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(26, 26, 46)
    doc.text(title, M, M + 4)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 107, 122)
    doc.text((subtitle || '') + pageNote, M, M + 18)

    const top = M + 32
    const maxW = W - 2 * M
    const maxH = H - top - M
    const scale = Math.min(maxW / img.width, maxH / img.height)
    // PNG keeps the small change text sharp; FAST compression keeps the file
    // a few hundred KB instead of several MB.
    doc.addImage(img, 'PNG', M, top, img.width * scale, img.height * scale, undefined, 'FAST')

    doc.setFontSize(7); doc.setTextColor(150, 150, 150)
    doc.text('West Coast Strength · L10', M, H - 14)
  })

  doc.save(filename || 'l10-by-club.pdf')
}
