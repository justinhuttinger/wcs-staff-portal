// Builds a standalone, print-friendly HTML document for a QA-Cleaning audit
// (Cleanliness - Quality Assessment KPI). Rendered into a new window via a
// Blob URL so managers can read or Save-as-PDF the scored report without an
// Operandio login. Item names/scorers come from parsed email content, so
// everything is escaped before it touches the document.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtDateMDY(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${m}-${d}-${y}`
}

// Score chip color: green when >= 80% of the item max, amber >= 50%, red below.
function chipColor(score, max) {
  if (max <= 0) return '#6b7280'
  const r = score / max
  if (r >= 0.8) return '#16a34a'
  if (r >= 0.5) return '#d97706'
  return '#dc2626'
}

export function buildQaReportHtml(report, clubLabel) {
  const items = report.items || []
  // Per-item max isn't in the email; derive it when the overall possible
  // divides evenly across items (it does today: 370 / 37 = 10), else fall
  // back to 10.
  const perItemMax = items.length && report.score_possible && report.score_possible % items.length === 0
    ? report.score_possible / items.length
    : 10

  // Group "Lobby-Windows" style names into sections by the prefix before the
  // first hyphen; names without a hyphen land in "General".
  const sections = []
  const byName = {}
  for (const it of items) {
    const idx = (it.name || '').indexOf('-')
    const section = idx > 0 ? it.name.slice(0, idx).trim() : 'General'
    const label = idx > 0 ? it.name.slice(idx + 1).trim() : (it.name || '').trim()
    if (!byName[section]) {
      byName[section] = { section, items: [] }
      sections.push(byName[section])
    }
    byName[section].items.push({ ...it, label })
  }

  const submittedBy = items[0]?.by || ''
  const pct = report.score_pct
  const pctColor = chipColor(pct ?? 0, 100)

  const sectionHtml = sections.map(sec => {
    const achieved = sec.items.reduce((s, it) => s + (it.score || 0), 0)
    const possible = sec.items.length * perItemMax
    const secPct = possible > 0 ? Math.round((achieved / possible) * 100) : 0
    const rows = sec.items.map(it => `
      <tr>
        <td class="idx">${esc(it.n)}</td>
        <td class="name">${esc(it.label)}</td>
        <td class="by">${esc(it.by)}</td>
        <td class="score"><span class="chip" style="background:${chipColor(it.score, perItemMax)}">${esc(it.score)}/${perItemMax}</span></td>
      </tr>`).join('')
    return `
    <section>
      <div class="sec-head">
        <h2>${esc(sec.section)}</h2>
        <span class="sec-score" style="color:${chipColor(secPct, 100)}">${achieved}/${possible} &middot; ${secPct}%</span>
      </div>
      <table>
        <thead><tr><th class="idx">#</th><th class="name">Item</th><th class="by">Scored By</th><th class="score">Score</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.job_name)} &mdash; ${esc(clubLabel)} &mdash; ${esc(fmtDateMDY(report.submitted_date))}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1d1d1f; background: #f5f5f4; padding: 32px 16px; }
  .page { max-width: 860px; margin: 0 auto; background: #fff; border-radius: 16px; box-shadow: 0 8px 32px rgba(0,0,0,.08); overflow: hidden; }
  header { background: #1d1d1f; color: #fff; padding: 28px 32px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  header .brand { font-size: 12px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: #e53e3e; }
  header h1 { font-size: 22px; font-weight: 800; margin-top: 6px; }
  header .meta { font-size: 13px; color: #d4d4d8; margin-top: 6px; }
  .overall { text-align: right; }
  .overall .pct { font-size: 44px; font-weight: 800; line-height: 1; }
  .overall .frac { font-size: 13px; color: #d4d4d8; margin-top: 4px; }
  main { padding: 24px 32px 8px; }
  section { margin-bottom: 24px; }
  .sec-head { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 2px solid #e53e3e; padding-bottom: 6px; margin-bottom: 8px; }
  .sec-head h2 { font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
  .sec-score { font-size: 13px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; padding: 6px 8px; }
  td { padding: 7px 8px; border-top: 1px solid #f0f0ef; }
  .idx { width: 36px; color: #9ca3af; }
  .by { width: 220px; color: #6b7280; font-size: 12px; }
  .score { width: 80px; text-align: right; }
  th.score { text-align: right; }
  .chip { display: inline-block; color: #fff; font-weight: 700; font-size: 12px; border-radius: 999px; padding: 2px 10px; }
  footer { padding: 16px 32px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 12px; color: #9ca3af; }
  footer .actions { display: flex; gap: 10px; }
  footer button, footer a { font: inherit; font-weight: 700; padding: 8px 16px; border-radius: 10px; border: 1px solid #d4d4d8; background: #fff; color: #1d1d1f; cursor: pointer; text-decoration: none; }
  footer button:hover, footer a:hover { border-color: #e53e3e; color: #e53e3e; }
  @media print {
    body { background: #fff; padding: 0; }
    .page { box-shadow: none; border-radius: 0; }
    footer .actions { display: none; }
  }
</style>
</head>
<body>
<div class="page">
  <header>
    <div>
      <div class="brand">West Coast Strength</div>
      <h1>${esc(report.job_name)}</h1>
      <div class="meta">${esc(clubLabel)} &middot; Submitted ${esc(fmtDateMDY(report.submitted_date))}${submittedBy ? ` &middot; ${esc(submittedBy)}` : ''}</div>
    </div>
    <div class="overall">
      <div class="pct" style="color:${pctColor}">${pct != null ? `${esc(pct)}%` : 'n/a'}</div>
      ${report.score_achieved != null && report.score_possible != null ? `<div class="frac">${esc(report.score_achieved)} of ${esc(report.score_possible)} points</div>` : ''}
    </div>
  </header>
  <main>
    ${sectionHtml || '<p style="color:#9ca3af;padding:16px 0">No item breakdown available for this audit.</p>'}
  </main>
  <footer>
    <span>Generated from Operandio audit data by the WCS Staff Portal</span>
    <span class="actions">
      <button onclick="window.print()">Print / Save as PDF</button>
      ${report.report_url ? `<a href="${esc(report.report_url)}" target="_blank" rel="noopener">Open in Operandio</a>` : ''}
    </span>
  </footer>
</div>
</body>
</html>`
}
