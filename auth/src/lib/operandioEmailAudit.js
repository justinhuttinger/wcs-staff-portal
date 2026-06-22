// Pure parser: Operandio "audit submitted" email (HTML part) -> per-item rows.
// Used by the SendGrid webhook and by the email re-parse backfill. Kept as its
// own module so it can be unit-tested against captured email fixtures.
//
// Each item row in the email looks like:
//   <td><div>N</div></td>
//   <td> <name> <div><scorer> - <when></div>
//        [ <div>&ldquo;<em><note></em>&rdquo;</div> ]   <-- present only when the
//   </td>                                                    auditor left a note
//   <td><span><score></span></td>
//
// The note <div> is optional. The previous regex required the name cell to close
// immediately after the scorer/when <div>, so any item WITH a note failed to
// match and was dropped entirely (losing both the item and its note). We now
// allow an optional trailing block before </td> and extract the note from it.

const ITEM_RE = new RegExp(
  '<div[^>]*>(\\d{1,3})<\\/div><\\/td>' +            // 1: item number
  '\\s*<td[^>]*>\\s*([^<]+?)\\s*' +                  // 2: item name
  '<div[^>]*>([^<]*?)\\s*-\\s*' +                    // 3: scorer
  '([A-Z][a-z]{2} \\d{1,2}, \\d{4} \\d{1,2}:\\d{2}[AP]M [A-Z]{2,4})' + // 4: when
  '\\s*<\\/div>' +
  '([\\s\\S]*?)' +                                   // 5: remainder of name cell (note div, or empty)
  '<\\/td>\\s*<td[^>]*>\\s*<span[^>]*>(\\d{1,3})<\\/span>', // 6: score
  'g'
)

function decodeEntities(s) {
  return String(s)
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&lsquo;|&rsquo;|&#8217;|&#8216;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&') // last: don't double-decode
}

// Pull the auditor note out of the name cell's trailing block. The note text
// lives inside <div>&ldquo;<em>...</em>&rdquo;</div>. Multiple notes (rare) are
// joined with " / ". Returns null when there is no note.
function extractNote(block) {
  if (!block) return null
  const notes = []
  const divRe = /<div[^>]*>([\s\S]*?)<\/div>/g
  let dm
  while ((dm = divRe.exec(block)) !== null) {
    const text = decodeEntities(dm[1].replace(/<[^>]+>/g, '')) // strip inner tags (<em>), then decode
      .replace(/^[\s"']+|[\s"']+$/g, '')                       // trim wrapping quotes/space
      .trim()
    if (text) notes.push(text)
  }
  return notes.length ? notes.join(' / ') : null
}

// Per-item breakdown from the HTML part. Returns null when no rows match (so the
// caller stores null, matching the prior contract).
function parseQaItems(html) {
  if (!html) return null
  const items = []
  let m
  ITEM_RE.lastIndex = 0
  while ((m = ITEM_RE.exec(html)) !== null) {
    items.push({
      n: parseInt(m[1], 10),
      name: decodeEntities(m[2].trim()),
      by: m[3].trim(),
      at: m[4].trim(),
      score: parseInt(m[6], 10),
      note: extractNote(m[5]),
    })
  }
  return items.length ? items : null
}

module.exports = { parseQaItems }
