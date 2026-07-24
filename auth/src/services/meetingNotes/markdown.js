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

function markdownToHtml(md) {
  const lines = String(md || '').split(/\r?\n/)
  const out = []
  let listType = null // 'ul' | 'checklist' | null

  const closeList = () => { if (listType) { out.push('</ul>'); listType = null } }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
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
