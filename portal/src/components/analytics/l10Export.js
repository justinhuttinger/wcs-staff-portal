// L10 PDF export: the By Club table, captured from the page.
//
// Loaded on demand from L10, so html-to-image and jsPDF only download when
// somebody actually exports (the same arrangement as memberMapExport).
//
// A CAPTURE, NOT A REDRAWING. The table is rendered to a canvas exactly as it
// sits on screen — fonts, zebra rows, coloured changes, the Total rule — and
// placed on a landscape page under a title. Redrawing it with jsPDF's own text
// calls would be a second layout that could only ever approximate the first.

import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

/**
 * @param el    the By Club table's card element
 * @param opts  { title, subtitle, filename }
 */
export async function exportTablePdf(el, { title, subtitle, filename }) {
  // The card scrolls sideways on a narrow window; capture all of it, not the
  // visible slice.
  // offset* includes the card's border; scroll* does not, and clipped it.
  const width = Math.max(el.scrollWidth, el.offsetWidth)
  const height = Math.max(el.scrollHeight, el.offsetHeight)
  const canvas = await toCanvas(el, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    width,
    height,
    style: { overflow: 'visible', width: `${width}px`, maxWidth: 'none' },
  })

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 32

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(26, 26, 46)
  doc.text(title, M, M + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 107, 122)
  doc.text(subtitle || '', M, M + 18)

  const top = M + 32
  const maxW = W - 2 * M
  const maxH = H - top - M
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height)
  // PNG keeps the small change text sharp; FAST compression keeps the file
  // a few hundred KB instead of several MB.
  doc.addImage(canvas, 'PNG', M, top, canvas.width * scale, canvas.height * scale, undefined, 'FAST')

  doc.setFontSize(7); doc.setTextColor(150, 150, 150)
  doc.text('West Coast Strength · L10', M, H - 14)

  doc.save(filename || 'l10-by-club.pdf')
}
