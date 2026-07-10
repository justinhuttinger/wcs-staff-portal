// Minimal inline formatting for form intro text: **bold**, *italic*,
// __underline__. Markers are stored as plain text on the form row; both the
// builder preview and the public renderer (wcs-forms-renderer copies this
// parser) turn them into elements. No HTML is ever parsed, so pasted markup
// stays inert.
const INLINE_RE = /\*\*(.+?)\*\*|__(.+?)__|\*([^*\n]+?)\*/

export function renderInline(text, keyPrefix = 'fmt') {
  const nodes = []
  let rest = String(text ?? '')
  let i = 0
  while (rest) {
    const m = INLINE_RE.exec(rest)
    if (!m) { nodes.push(rest); break }
    if (m.index > 0) nodes.push(rest.slice(0, m.index))
    const key = `${keyPrefix}-${i++}`
    if (m[1] !== undefined) nodes.push(<strong key={key}>{renderInline(m[1], key)}</strong>)
    else if (m[2] !== undefined) nodes.push(<u key={key}>{renderInline(m[2], key)}</u>)
    else nodes.push(<em key={key}>{renderInline(m[3], key)}</em>)
    rest = rest.slice(m.index + m[0].length)
  }
  return nodes
}
