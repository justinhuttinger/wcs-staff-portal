// auth/src/services/meetingNotes/markdown.js
// Minimal markdown -> HTML for the notetaker's note structure, so Drive can
// import it as a formatted Google Doc. Handles exactly what the notetaker
// emits: ## / ### headings, "- [ ]"/"- [x]" checkbox items, "*"/"-" bullets,
// **bold**, and blank-line-separated paragraphs. Not a general markdown engine.
'use strict'

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Inline: **bold** only (the notetaker doesn't use other inline marks). Escape
// first so content is safe, then unwrap the bold markers.
function inline(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}

// Split a GFM table row into trimmed cells, dropping the empties created by
// leading/trailing pipes ("| a | b |" -> ['a','b']).
function tableCells(line) {
  const parts = line.split('|').map((c) => c.trim())
  if (parts.length && parts[0] === '') parts.shift()
  if (parts.length && parts[parts.length - 1] === '') parts.pop()
  return parts
}

// A GFM separator row: only pipes, dashes, colons, spaces, and at least one dash.
function isTableSeparator(line) {
  return /\|/.test(line) && /-/.test(line) && /^[\s|:-]+$/.test(line)
}

function markdownToHtml(md) {
  const lines = String(md || '').split(/\r?\n/)
  const out = []
  let listType = null // 'ul' | 'checklist' | null

  const closeList = () => { if (listType) { out.push('</ul>'); listType = null } }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '')

    // Table: a row containing "|" immediately followed by a separator row
    // (|---|---|). Renders as a real HTML table (Docs imports it as a table),
    // which is why raw pipes never reach the reader.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeList()
      const header = tableCells(line)
      let j = i + 2
      const rows = []
      for (; j < lines.length; j++) {
        const l = lines[j]
        if (!l.trim() || !l.includes('|')) break
        rows.push(tableCells(l))
      }
      out.push('<table>')
      out.push('<tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>')
      for (const r of rows) {
        out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
      }
      out.push('</table>')
      i = j - 1 // the for-loop's i++ advances past the last data row
      continue
    }

    if (!line.trim()) { closeList(); continue }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = Math.min(heading[1].length, 6)
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`)
      continue
    }

    const checkbox = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (checkbox) {
      if (listType !== 'checklist') { closeList(); out.push('<ul>'); listType = 'checklist' }
      const box = checkbox[1].toLowerCase() === 'x' ? '☑' : '☐' // ☑ / ☐
      out.push(`<li>${box} ${inline(checkbox[2].trim())}</li>`)
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul' }
      out.push(`<li>${inline(bullet[1].trim())}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line.trim())}</p>`)
  }
  closeList()
  return out.join('\n')
}

// Wrap body HTML in a minimal full document for Drive import.
function htmlDocument(title, bodyHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>`
    + `<body>${bodyHtml}</body></html>`
}

module.exports = { markdownToHtml, htmlDocument, escapeHtml }
