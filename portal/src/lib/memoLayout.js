// Arranges a memo's items automatically, for the portal page, print and the iPad
// lock screen. Nobody picks a layout: the number of items and how long they are
// decide it. Pure, so it can be tested without a browser.
//
// The look follows the November 2026 memo: the longest item gets a boxed feature
// row, the next longest a black band at the bottom when a row would otherwise hold
// one item alone, and everything else sits in rows of up to three.

function itemLength(item) {
  return (item.title || '').length + (item.description || '').length
}

// Longest first; ties keep the order they were written in.
export function sortItems(items) {
  return (items || [])
    .map((item, i) => ({ item, i }))
    .sort((a, b) => itemLength(b.item) - itemLength(a.item) || a.i - b.i)
    .map(x => x.item)
}

// rows = [{ style: 'feature' | 'band' | 'plain', items: [...] }]
export function arrangeMemo(items) {
  const sorted = sortItems(items)
  if (sorted.length === 0) return []
  if (sorted.length === 2) return [{ style: 'plain', items: sorted }]

  const [feature, ...rest] = sorted
  const rows = [{ style: 'feature', items: [feature] }]
  // A lone leftover becomes the band, and it should be the next longest item, so
  // take it out before filling the rows of three.
  let band = null
  if (rest.length % 3 === 1) band = rest.shift()
  for (let i = 0; i < rest.length; i += 3) rows.push({ style: 'plain', items: rest.slice(i, i + 3) })
  if (band) rows.push({ style: 'band', items: [band] })
  return rows
}

// Club items are notes: shortest row-count layout, no feature treatment.
export function arrangeNotes(items) {
  const sorted = sortItems(items)
  const rows = []
  const perRow = sorted.length === 2 || sorted.length === 4 ? 2 : sorted.length === 1 ? 1 : 3
  for (let i = 0; i < sorted.length; i += perRow) rows.push({ style: 'note', items: sorted.slice(i, i + perRow) })
  return rows
}

// "Label: rest" gets a bold label when the label is short, as in "12-month: ...".
export function splitLabel(line) {
  const at = line.indexOf(':')
  if (at <= 0 || at > 24) return { label: '', text: line }
  return { label: line.slice(0, at + 1), text: line.slice(at + 1).trim() }
}

// A description's lines. More than one line reads as bullets.
export function descriptionLines(description) {
  return (description || '').split('\n').map(l => l.trim()).filter(Boolean)
}

// Portal and print text size, from how much there is to fit on the page.
export function textTier(items) {
  const total = (items || []).reduce((sum, item) => sum + itemLength(item), 0)
  if (total < 900) return 'large'
  if (total < 2000) return 'medium'
  return 'small'
}

// Wrap words carrying a bold flag into lines no wider than maxWidth. A word wider
// than a whole line is broken, so nothing can run off the edge.
export function wrapWords(words, maxWidth, measure) {
  const lines = []
  let line = []
  let width = 0
  const space = measure(' ', false)
  const pushWord = (word) => {
    const w = measure(word.text, word.bold)
    const extra = line.length ? space + w : w
    if (width + extra > maxWidth && line.length) {
      lines.push(line)
      line = []
      width = 0
    }
    if (w > maxWidth) {
      let chunk = ''
      for (const ch of word.text) {
        if (measure(chunk + ch, word.bold) > maxWidth && chunk) {
          lines.push([{ text: chunk, bold: word.bold }])
          chunk = ''
        }
        chunk += ch
      }
      line = [{ text: chunk, bold: word.bold }]
      width = measure(chunk, word.bold)
      return
    }
    width += line.length ? space + w : w
    line.push(word)
  }
  words.forEach(pushWord)
  if (line.length) lines.push(line)
  return lines
}

function wordsOf(text, bold) {
  return text.split(/\s+/).filter(Boolean).map(t => ({ text: t, bold }))
}

// One item's lines at a font size. measure(text, { size, bold, display }) -> px.
function layoutItem(item, width, font, measure) {
  const titleMeasure = (t) => measure(t, { size: font.title, display: true })
  const bodyMeasure = (t, bold) => measure(t, { size: font.body, bold })
  const titleLines = wrapWords(wordsOf((item.title || '').toUpperCase(), false), width, titleMeasure)
  const source = descriptionLines(item.description)
  const bullets = source.length > 1
  const textWidth = bullets ? width - font.body * 1.1 : width
  const blocks = source.map((line) => {
    const { label, text } = splitLabel(line)
    return wrapWords([...wordsOf(label, true), ...wordsOf(text, false)], textWidth, bodyMeasure)
  })
  const bodyLineCount = blocks.reduce((n, b) => n + b.length, 0)
  const height = titleLines.length * font.titleLine + font.gap
    + bodyLineCount * font.bodyLine + Math.max(0, blocks.length - 1) * font.body * 0.3
  return { item, titleLines, blocks, bullets, height }
}

function fontAt(body) {
  return {
    body,
    bodyLine: body * 1.32,
    title: body * 1.5,
    titleLine: body * 1.65,
    gap: body * 0.7,
    pad: body * 0.95,
    rowGap: body * 1.1,
  }
}

function layoutRows(rows, width, font, measure) {
  return rows.map((row) => {
    const gap = font.rowGap
    const pad = row.style === 'plain' || row.style === 'note' ? 0 : font.pad
    const cellWidth = (width - gap * (row.items.length - 1)) / row.items.length
    const cells = row.items.map(item => layoutItem(item, cellWidth - pad * 2, font, measure))
    return {
      style: row.style,
      cellWidth,
      cells,
      pad,
      height: Math.max(...cells.map(c => c.height)) + pad * 2,
    }
  })
}

// The biggest text at which everything fits in width x height. Always returns a
// layout with every item on it; `small` flags text too small to read comfortably.
export function fitMemo({ mainRows, noteRows, width, height, measure, maxBody = 64, minBody = 8, readableBody = 26 }) {
  let best = null
  for (let body = maxBody; body >= minBody; body -= 1) {
    const font = fontAt(body)
    const main = layoutRows(mainRows, width, font, measure)
    const notesWidth = width - font.pad * 2
    const notes = layoutRows(noteRows, notesWidth, font, measure)
    const notesHeading = noteRows.length ? font.titleLine + font.gap + font.pad * 2 : 0
    const notesHeight = notes.length
      ? notesHeading + notes.reduce((sum, r) => sum + r.height, 0) + font.rowGap * (notes.length - 1)
      : 0
    const blocks = main.length + (notes.length ? 1 : 0)
    const used = main.reduce((sum, r) => sum + r.height, 0) + notesHeight + font.rowGap * Math.max(0, blocks - 1)
    best = { font, main, notes, notesHeight, used, spare: Math.max(0, height - used), small: body < readableBody, fits: used <= height }
    if (used <= height) return best
  }
  return best
}
