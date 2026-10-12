// Member Map export: the map as a PNG, or a one-file PDF (map + legend on page
// one, the per-club distance table on page two).
//
// Loaded on demand from MemberMap, so html-to-image and jsPDF only download
// when somebody actually exports. The tile layer is created with crossOrigin
// so the street map can be drawn onto a canvas (Esri sends CORS headers).

import { toCanvas } from 'html-to-image'
import { jsPDF } from 'jspdf'

// Zoom buttons and the attribution bar are UI, not map. Attribution is
// re-printed as text in the PDF footer instead.
const SKIP = ['leaflet-control-zoom', 'leaflet-control-attribution']

export async function captureMap(el) {
  return toCanvas(el, {
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    filter: node => !(node.classList && SKIP.some(c => node.classList.contains(c))),
  })
}

function download(href, filename) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export async function exportMapPng(el, filename) {
  const canvas = await captureMap(el)
  download(canvas.toDataURL('image/png'), filename)
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
}

/**
 * @param el        the Leaflet map container
 * @param opts.title / opts.subtitle   header lines
 * @param opts.legend   [{ label, color }]
 * @param opts.tiles    [{ label, value }] headline numbers
 * @param opts.columns  table header labels
 * @param opts.rows     table rows (arrays of strings, same length as columns)
 * @param opts.notes    footnote lines
 */
export async function exportMapPdf(el, { title, subtitle, legend = [], tiles = [], columns = [], rows = [], notes = [], filename }) {
  const canvas = await captureMap(el)
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 32

  const header = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(17, 17, 17)
    doc.text(title, M, M + 4)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110, 110, 110)
    doc.text(subtitle, M, M + 18)
  }
  const footer = () => {
    doc.setFontSize(7); doc.setTextColor(150, 150, 150)
    doc.text('West Coast Strength · Member Map · Basemap © Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS', M, H - 14)
  }

  // ---- Page 1: headline numbers, map, legend ----
  header()
  let y = M + 32
  if (tiles.length) {
    const tw = (W - 2 * M - (tiles.length - 1) * 8) / tiles.length
    tiles.forEach((t, i) => {
      const x = M + i * (tw + 8)
      doc.setDrawColor(220, 220, 220); doc.roundedRect(x, y, tw, 34, 4, 4)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(17, 17, 17)
      doc.text(String(t.value), x + tw / 2, y + 15, { align: 'center' })
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(110, 110, 110)
      doc.text(t.label, x + tw / 2, y + 27, { align: 'center' })
    })
    y += 44
  }

  const legendH = legend.length ? 18 : 0
  const maxW = W - 2 * M
  const maxH = H - y - legendH - 30
  const scale = Math.min(maxW / canvas.width, maxH / canvas.height)
  const iw = canvas.width * scale
  const ih = canvas.height * scale
  doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', M + (maxW - iw) / 2, y, iw, ih)
  doc.setDrawColor(200, 200, 200); doc.rect(M + (maxW - iw) / 2, y, iw, ih)
  y += ih + 12

  let lx = M
  doc.setFontSize(8)
  for (const item of legend) {
    doc.setFillColor(...hexToRgb(item.color)); doc.circle(lx + 4, y - 3, 3.5, 'F')
    doc.setTextColor(60, 60, 60); doc.text(item.label, lx + 11, y)
    lx += 11 + doc.getTextWidth(item.label) + 14
  }
  footer()

  // ---- Page 2: per-club table + notes ----
  if (rows.length) {
    doc.addPage()
    header()
    let ty = M + 40
    const colW = [(W - 2 * M) * 0.2, ...columns.slice(1).map(() => ((W - 2 * M) * 0.8) / (columns.length - 1))]
    const cell = (text, ci, yy, bold) => {
      const x = M + colW.slice(0, ci).reduce((a, b) => a + b, 0)
      doc.setFont('helvetica', bold ? 'bold' : 'normal')
      if (ci === 0) doc.text(String(text), x + 4, yy)
      else doc.text(String(text), x + colW[ci] - 4, yy, { align: 'right' })
    }
    doc.setFontSize(7.5); doc.setTextColor(110, 110, 110)
    columns.forEach((c, ci) => cell(c.toUpperCase(), ci, ty, true))
    ty += 6
    doc.setDrawColor(200, 200, 200); doc.line(M, ty, W - M, ty)
    doc.setFontSize(9); doc.setTextColor(17, 17, 17)
    rows.forEach((r, ri) => {
      ty += 16
      if (ri % 2 === 0) { doc.setFillColor(245, 245, 245); doc.rect(M, ty - 11, W - 2 * M, 16, 'F') }
      r.forEach((v, ci) => cell(v, ci, ty, ci === 0))
    })
    ty += 24
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 110, 110)
    for (const n of notes) {
      const lines = doc.splitTextToSize(n, W - 2 * M)
      doc.text(lines, M, ty)
      ty += lines.length * 11
    }
    footer()
  }

  doc.save(filename)
}
