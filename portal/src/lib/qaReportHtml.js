// Builds a standalone, print-friendly HTML document for an Operandio audit
// (QA-Cleaning and the other monthly department audits). Rendered into a new
// window so managers can read or Save-as-PDF the scored report without an
// Operandio login.
//
// Styling matches the Day One program template
// (wcs-brain/services/dayone/templates/program-template.html): Bebas Neue
// display headings, WCS red #E31E24, black-bordered tables on white.
//
// Item names/scorers come from parsed email content, so everything is escaped
// before it touches the document.

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

export function buildQaReportHtml(report, clubLabel) {
  const items = report.items || []
  // Per-item max isn't in the email; derive it when the overall possible
  // divides evenly across items (370 / 37 = 10 today), else fall back to 10.
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
  // Day One palette is strictly red/black — low scores go red for attention.
  const lowScore = (score, max) => max > 0 && score / max < 0.5

  const logoUrl = typeof window !== 'undefined' ? `${window.location.origin}/wcs-logo.png` : '/wcs-logo.png'

  const sectionHtml = sections.map(sec => {
    const achieved = sec.items.reduce((s, it) => s + (it.score || 0), 0)
    const possible = sec.items.length * perItemMax
    const secPct = possible > 0 ? Math.round((achieved / possible) * 100) : 0
    const rows = sec.items.map(it => `
      <tr>
        <td class="item-cell">
          ${esc(it.label)}
          <div class="scored-by">${esc(it.by)}${it.at ? ` &middot; ${esc(it.at)}` : ''}</div>
          ${it.note ? `<div class="item-note">&ldquo;${esc(it.note)}&rdquo;</div>` : ''}
        </td>
        <td class="score-cell${lowScore(it.score, perItemMax) ? ' low' : ''}">${esc(it.score)} / ${perItemMax}</td>
      </tr>`).join('')
    return `
    <section>
      <div class="sec-head">
        <h3>${esc(sec.section)}</h3>
        <span class="sec-score${lowScore(achieved, possible) ? ' low' : ''}">${achieved} / ${possible} &middot; ${secPct}%</span>
      </div>
      <table class="audit-table">
        <tbody>${rows}</tbody>
      </table>
    </section>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(report.job_name)} &mdash; ${esc(clubLabel)} &mdash; ${esc(fmtDateMDY(report.submitted_date))}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap');

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Arial', 'Helvetica', sans-serif;
    color: #000;
    background: #fff;
  }

  .page {
    position: relative;
    max-width: 860px;
    margin: 0 auto;
    padding: 40px 32px;
  }

  /* Logo aligned with header on left */
  .logo-image {
    position: absolute;
    top: 40px;
    left: 32px;
    width: 70px;
    height: 70px;
  }

  /* Header moved right to accommodate logo */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 20px;
    margin-left: 90px;
    padding-bottom: 15px;
    border-bottom: 4px solid #E31E24;
    position: relative;
  }
  .page-header::before {
    content: '';
    position: absolute;
    bottom: -4px;
    left: -90px;
    width: 90px;
    height: 4px;
    background-color: #E31E24;
  }

  .header-left h1 {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 14px;
    font-weight: normal;
    color: #E31E24;
    letter-spacing: 2px;
  }
  .header-left h2 {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 42px;
    font-weight: 900;
    color: #000;
    margin-top: 5px;
    line-height: 1;
    text-transform: uppercase;
    letter-spacing: -1px;
  }

  .header-right {
    text-align: right;
    padding-top: 10px;
  }
  .header-right p {
    font-size: 13px;
    color: #E31E24;
    margin: 2px 0;
    font-weight: bold;
  }

  /* Overall score banner */
  .overall {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 30px 0 10px;
  }
  .overall .label {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 36px;
    font-weight: 900;
    text-transform: uppercase;
    color: #000;
  }
  .overall .value {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 56px;
    line-height: 1;
    color: #000;
  }
  .overall .value small {
    font-family: 'Arial', sans-serif;
    font-size: 14px;
    font-weight: bold;
    color: #E31E24;
    margin-left: 10px;
    letter-spacing: 1px;
  }
  .overall .value.low { color: #E31E24; }

  section { margin-top: 30px; }
  .sec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 12px;
  }
  .sec-head h3 {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 28px;
    font-weight: 900;
    color: #000;
    text-transform: uppercase;
  }
  .sec-score {
    font-size: 13px;
    font-weight: bold;
    color: #000;
  }
  .sec-score.low { color: #E31E24; }

  .audit-table {
    width: 100%;
    border-collapse: collapse;
  }
  .audit-table td {
    border: 2px solid #000;
    padding: 12px 15px;
    font-size: 13px;
    vertical-align: top;
  }
  .item-cell { width: 70%; }
  .scored-by {
    margin-top: 4px;
    font-size: 11px;
    font-weight: normal;
    color: #777;
  }
  /* Auditor's free-text note for the item — the "why" behind a low score. */
  .item-note {
    margin-top: 6px;
    font-size: 12px;
    font-style: italic;
    color: #000;
    border-left: 3px solid #E31E24;
    padding-left: 10px;
  }
  .score-cell {
    width: 30%;
    font-weight: bold;
    font-size: 15px;
  }
  .score-cell.low { color: #E31E24; }

  footer {
    margin-top: 36px;
    padding-top: 14px;
    border-top: 2px solid #000;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    font-size: 11px;
    color: #777;
  }
  footer .actions { display: flex; gap: 10px; }
  footer button, footer a {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 15px;
    letter-spacing: 1px;
    padding: 8px 18px;
    border: 2px solid #000;
    background: #fff;
    color: #000;
    cursor: pointer;
    text-decoration: none;
  }
  footer button:hover, footer a:hover {
    border-color: #E31E24;
    color: #E31E24;
  }

  /* Sticky back bar — the report opens in its own window/tab, so on mobile
     (PWA / no browser chrome) this is the only way back to the app. */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    background: #fff;
    border-bottom: 1px solid #e5e5e5;
    padding: 10px 16px;
  }
  .topbar .back-btn {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 16px;
    letter-spacing: 1px;
    padding: 8px 18px;
    border: 2px solid #000;
    background: #fff;
    color: #000;
    cursor: pointer;
    border-radius: 4px;
  }
  .topbar .back-btn:active { background: #000; color: #fff; }

  @media print {
    .topbar { display: none; }
    .page { padding: 0; max-width: none; }
    .logo-image { top: 0; left: 0; }
    footer .actions { display: none; }
  }
</style>
</head>
<body>
<div class="topbar">
  <button type="button" class="back-btn" onclick="window.close();setTimeout(function(){if(!window.closed&&window.history.length>1)window.history.back()},120)">&lsaquo; Back</button>
</div>
<div class="page">
  <img class="logo-image" src="${esc(logoUrl)}" alt="WCS" onerror="this.style.display='none'">
  <div class="page-header">
    <div class="header-left">
      <h1>WEST COAST STRENGTH</h1>
      <h2>${esc(report.job_name)}</h2>
    </div>
    <div class="header-right">
      <p>${esc(clubLabel)}</p>
      <p>Submitted ${esc(fmtDateMDY(report.submitted_date))}</p>
      ${submittedBy ? `<p>${esc(submittedBy)}</p>` : ''}
    </div>
  </div>

  <div class="overall">
    <span class="label">Overall Score</span>
    <span class="value${pct != null && pct < 50 ? ' low' : ''}">
      ${pct != null ? `${esc(pct)}%` : 'N/A'}
      ${report.score_achieved != null && report.score_possible != null ? `<small>${esc(report.score_achieved)} OF ${esc(report.score_possible)} POINTS</small>` : ''}
    </span>
  </div>

  ${sectionHtml || '<p style="color:#777;padding:16px 0">No item breakdown available for this audit.</p>'}

  <footer>
    <span>Generated from Operandio audit data by the WCS Staff Portal</span>
    <span class="actions">
      <button onclick="window.close();setTimeout(function(){if(!window.closed&&window.history.length>1)window.history.back()},120)">Back</button>
      <button onclick="window.print()">Print / Save as PDF</button>
      ${report.report_url ? `<a href="${esc(report.report_url)}" target="_blank" rel="noopener">Open in Operandio</a>` : ''}
    </span>
  </footer>
</div>
</body>
</html>`
}

// Opens the in-house HTML report for an audit in a new window. The window
// opens synchronously (so popup blockers don't eat it) and is filled once the
// per-item breakdown arrives; audits without parsed items fall back to the
// Operandio app link. `fetchReport` is injected (the api helper) to avoid an
// import cycle with api.js consumers.
export async function openAuditReport(row, fetchReport, clubLabel) {
  // In the kiosk launcher, render the report as a proper in-app tab (with a
  // real tab title, no floating OS popup) via the preload bridge. Requires
  // launcher >= 1.7.2; older launchers/browsers fall through to the blank-
  // window + document.write path below.
  const openReportTab = typeof window !== 'undefined'
    && window.wcsElectron && typeof window.wcsElectron.openReportTab === 'function'
    ? window.wcsElectron.openReportTab
    : null
  if (openReportTab) {
    const title = `${clubLabel || ''} Audit Report`.trim()
    try {
      const full = await fetchReport(row.id)
      if (full?.items?.length) {
        openReportTab(buildQaReportHtml(full, clubLabel), title)
        return
      }
      const url = full?.report_url || row.report_url
      if (url) window.open(url, '_blank') // launcher routes real URLs into a tab
    } catch {
      if (row.report_url) window.open(row.report_url, '_blank')
    }
    return
  }

  // Browser (or launcher < 1.7.2): open a blank tab synchronously so popup
  // blockers don't eat it, then fill it once the breakdown arrives.
  const w = window.open('', '_blank')
  if (!w) return
  w.document.write('<title>Loading report…</title><p style="font-family:sans-serif;color:#666;padding:24px">Loading report…</p>')
  try {
    const full = await fetchReport(row.id)
    if (full?.items?.length) {
      w.document.open()
      w.document.write(buildQaReportHtml(full, clubLabel))
      w.document.close()
      return
    }
    const url = full?.report_url || row.report_url
    if (url) { w.location = url; return }
    w.close()
  } catch {
    if (row.report_url) { w.location = row.report_url } else { w.close() }
  }
}
