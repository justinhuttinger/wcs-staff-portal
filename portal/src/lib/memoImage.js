// Draws a club's memo as an iPad lock screen image, in the browser, so the server
// never has to hold an image in memory. Portrait, one size: every enrolled iPad is
// a 7th, 8th or 9th generation at 1620x2160.
//
// The lock screen clock is white and sits at the top, so the top stays black.
import { arrangeMemo, arrangeNotes, fitMemo } from './memoLayout'

export const IMAGE_WIDTH = 1620
export const IMAGE_HEIGHT = 2160

const RED = '#ff0000'
const INK = '#111111'
const MARGIN = 80
const CLOCK_BAND = 620
const BOTTOM_CLEAR = 130
const DISPLAY = 'WCSDisplay, Impact, sans-serif'
const BODY = 'Inter, Arial, sans-serif'

function setBody(ctx, font, bold) {
  ctx.font = `${bold ? 700 : 400} ${font.body}px ${BODY}`
}

function drawTextLine(ctx, words, x, y, font, color) {
  let cursor = x
  ctx.fillStyle = color
  for (const word of words) {
    setBody(ctx, font, word.bold)
    ctx.fillText(word.text, cursor, y)
    cursor += ctx.measureText(word.text + ' ').width
  }
}

function drawCell(ctx, cell, x, top, font, colors, rule) {
  let y = top
  ctx.textBaseline = 'alphabetic'
  ctx.font = `${font.title}px ${DISPLAY}`
  ctx.fillStyle = colors.title
  for (const line of cell.titleLines) {
    y += font.titleLine
    ctx.fillText(line.map(w => w.text).join(' '), x, y - font.titleLine * 0.22)
  }
  if (rule) {
    ctx.fillStyle = colors.rule
    ctx.fillRect(x, y + font.gap * 0.15, rule, Math.max(3, font.body * 0.12))
  }
  y += font.gap
  for (const block of cell.blocks) {
    block.forEach((words, i) => {
      y += font.bodyLine
      const textX = cell.bullets ? x + font.body * 1.1 : x
      if (cell.bullets && i === 0) {
        ctx.fillStyle = colors.body
        ctx.beginPath()
        ctx.arc(x + font.body * 0.35, y - font.body * 0.42, font.body * 0.14, 0, Math.PI * 2)
        ctx.fill()
      }
      drawTextLine(ctx, words, textX, y - font.bodyLine * 0.25, font, colors.body)
    })
    y += font.body * 0.3
  }
}

function drawRow(ctx, row, x, top, width, height, font) {
  const dark = row.style === 'band'
  if (dark) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(x, top, width, height)
  } else if (row.style === 'feature') {
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.max(4, font.body * 0.14)
    ctx.strokeRect(x, top, width, height)
  }
  const colors = dark
    ? { title: '#ffffff', body: '#ffffff', rule: RED }
    : { title: INK, body: INK, rule: RED }
  row.cells.forEach((cell, i) => {
    const cellX = x + row.pad + i * (row.cellWidth + font.rowGap)
    drawCell(ctx, cell, cellX, top + row.pad, font, colors, row.style === 'plain' ? row.cellWidth : 0)
  })
}

function monthTitle(month) {
  return new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Returns { canvas, small }. `small` means it all fit but the text is tiny.
export async function drawMemoImage({ month, clubName, mainItems, clubItems }) {
  // The canvas silently falls back to a system font until these are loaded.
  if (document.fonts) {
    await Promise.all([
      document.fonts.load(`64px WCSDisplay`),
      document.fonts.load(`400 26px Inter`),
      document.fonts.load(`700 26px Inter`),
    ]).catch(() => {})
  }

  const canvas = document.createElement('canvas')
  canvas.width = IMAGE_WIDTH
  canvas.height = IMAGE_HEIGHT
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, IMAGE_WIDTH, CLOCK_BAND)

  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = RED
  ctx.font = `700 34px ${BODY}`
  ctx.fillText(`/ MEMO · ${monthTitle(month).toUpperCase()}${clubName ? ` · ${clubName.toUpperCase()}` : ''}`, MARGIN, CLOCK_BAND - 120)
  ctx.fillStyle = '#ffffff'
  ctx.font = `76px ${DISPLAY}`
  const name = new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' }).toUpperCase()
  ctx.fillText(`${name} GAME PLAN`, MARGIN, CLOCK_BAND - 40)

  const top = CLOCK_BAND + 50
  const width = IMAGE_WIDTH - MARGIN * 2
  const height = IMAGE_HEIGHT - top - BOTTOM_CLEAR

  const measure = (text, opts) => {
    ctx.font = opts.display ? `${opts.size}px ${DISPLAY}` : `${opts.bold ? 700 : 400} ${opts.size}px ${BODY}`
    return ctx.measureText(text).width
  }
  const layout = fitMemo({
    mainRows: arrangeMemo(mainItems),
    noteRows: arrangeNotes(clubItems),
    width, height, measure,
  })
  const { font, main, notes, notesHeight } = layout

  // Share leftover height between the blocks so the page reads as full.
  const blocks = main.length + (notes.length ? 1 : 0)
  const extra = blocks > 1 ? Math.min(layout.spare / (blocks - 1), font.rowGap * 2) : 0

  let y = top
  for (const row of main) {
    drawRow(ctx, row, MARGIN, y, width, row.height, font)
    y += row.height + font.rowGap + extra
  }

  if (notes.length) {
    ctx.strokeStyle = INK
    ctx.lineWidth = Math.max(3, font.body * 0.1)
    ctx.strokeRect(MARGIN, y, width, notesHeight)
    let inner = y + font.pad
    ctx.fillStyle = INK
    ctx.font = `${font.title}px ${DISPLAY}`
    ctx.fillText(`${(clubName || 'CLUB').toUpperCase()} NOTES`, MARGIN + font.pad, inner + font.titleLine * 0.78)
    inner += font.titleLine
    ctx.fillStyle = RED
    ctx.fillRect(MARGIN + font.pad, inner, width - font.pad * 2, Math.max(3, font.body * 0.12))
    inner += font.gap
    for (const row of notes) {
      drawRow(ctx, row, MARGIN + font.pad, inner, width - font.pad * 2, row.height, font)
      inner += row.height + font.rowGap
    }
  }

  return { canvas, small: layout.small }
}

export function downloadCanvas(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
