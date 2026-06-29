// Pure HTML renderer for the till-close receipt. No I/O. The desktop loads this
// into a hidden window and silent-prints it.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
function money(n) {
  const v = Number(n || 0)
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}
function signedMoney(n) {
  const v = Number(n || 0)
  if (v > 0) return `+$${v.toFixed(2)}`
  if (v < 0) return `-$${Math.abs(v).toFixed(2)}`
  return '$0.00'
}
function prettyDate(iso) {
  // iso 'YYYY-MM-DD' -> 'Jun 29, 2026' without timezone surprises.
  const [y, m, d] = String(iso).split('-').map(Number)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (!y || !m || !d) return esc(iso)
  return `${months[m - 1]} ${d}, ${y}`
}

function renderReceiptHtml(p, opts = {}) {
  const logo = opts.logoDataUri || ''
  const dropRows = (p.drops || []).map(
    d => `<tr><td>${esc(d.name)}</td><td class="r">${money(d.amount)}</td></tr>`
  ).join('')
  const loc = esc(String(p.location || '')).replace(/^\w/, c => c.toUpperCase())
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #111; margin: 0; padding: 24px; }
  .logo { display: block; margin: 0 auto 8px; width: 96px; height: auto; }
  h1 { text-align: center; font-size: 22px; margin: 4px 0 0; letter-spacing: 1px; }
  .sub { text-align: center; color: #666; margin: 2px 0 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  td { padding: 4px 0; }
  td.r { text-align: right; font-variant-numeric: tabular-nums; }
  .rule { border-top: 1px solid #999; margin: 10px 0; }
  .hero { border: 2px solid #111; border-radius: 8px; text-align: center; padding: 12px; margin: 14px 0; }
  .hero .label { color: #666; font-size: 12px; letter-spacing: 1px; }
  .hero .amt { font-size: 30px; font-weight: 700; }
  .foot { text-align: center; color: #888; font-size: 11px; margin-top: 12px; }
</style></head><body>
  ${logo ? `<img class="logo" src="${logo}" alt="WCS">` : ''}
  <h1>TILL CLOSE</h1>
  <div class="sub">${loc} &nbsp;&middot;&nbsp; ${prettyDate(p.date)}</div>
  <table>
    <tr><td>Closed by</td><td class="r">${esc(p.closedBy)}</td></tr>
    <tr><td>Starting float</td><td class="r">${money(p.float)}</td></tr>
    <tr><td>Cash sales</td><td class="r">${money(p.cashSales)}</td></tr>
    <tr><td>Cash refunds</td><td class="r">${money(p.cashRefunds)}</td></tr>
    <tr><td>Cash drops</td><td class="r">${money(p.dropsTotal)}</td></tr>
    ${dropRows ? `<tr><td colspan="2"><div class="rule"></div></td></tr>${dropRows}` : ''}
    <tr><td colspan="2"><div class="rule"></div></td></tr>
    <tr><td>Expected in drawer</td><td class="r">${money(p.expected)}</td></tr>
    <tr><td><strong>Counted in drawer</strong></td><td class="r"><strong>${money(p.counted)}</strong></td></tr>
    <tr><td>Over / short</td><td class="r">${signedMoney(p.overShort)}</td></tr>
  </table>
  <div class="hero">
    <div class="label">BAG DROP</div>
    <div class="amt">${money(p.bagDrop)}</div>
  </div>
  <div class="foot">WCS Till System</div>
</body></html>`
}

module.exports = { renderReceiptHtml }
