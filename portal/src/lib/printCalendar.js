// Printable month calendar for the Marketing Tracker and the GM Event
// Calendar. Opens a clean, print-only page in a new window (landscape month
// grid on page one, a detailed agenda after it) and hands it to the browser's
// print dialog, so the printout doesn't carry the portal's chrome.

import { typeLabel, STATUS_BY_KEY } from '../config/marketingTypes'

// Print-safe hex per effort type (Tailwind classes don't exist in the popup).
const TYPE_HEX = {
  meta_ad: '#3b82f6', social_post: '#a855f7', flyer: '#f59e0b', facebook_event: '#6366f1',
  event: '#f97316', email: '#14b8a6', sms: '#22c55e', app_blast: '#ec4899',
  ad_tvs: '#06b6d4', website: '#64748b',
}
const STATUS_HEX = { planned: '#a16207', approved: '#1d4ed8', complete: '#15803d' }

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoDate(iso) {
  return iso ? dateStr(new Date(iso)) : ''
}

// Times stored at local noon with no time picked are "all day"; only show a
// time when one was actually set.
function timeLabel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (d.getHours() === 12 && d.getMinutes() === 0) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase()
}

/**
 * @param {object} opts
 * @param {string} opts.title        e.g. 'Event Calendar'
 * @param {string} opts.monthDate    any 'YYYY-MM-DD' inside the month to print
 * @param {object[]} opts.efforts    already-filtered efforts
 * @param {(slugs: string[]) => string} opts.locationsLabel
 * @param {string} [opts.subtitle]   e.g. 'Salem, Keizer'
 */
export function printCalendar({ title, monthDate, efforts, locationsLabel, subtitle }) {
  const base = new Date(monthDate + 'T12:00:00')
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthName = base.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const monthStart = dateStr(new Date(year, month, 1))
  const monthEnd = dateStr(new Date(year, month + 1, 0))

  // Efforts overlapping this month, soonest first.
  const inMonth = efforts
    .map(e => ({ ...e, _start: isoDate(e.start_at), _end: e.end_at ? isoDate(e.end_at) : isoDate(e.start_at) }))
    .filter(e => e._start <= monthEnd && e._end >= monthStart)
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))

  // Six-week grid starting on the Sunday on/before the 1st, trimmed to the
  // weeks that actually touch this month.
  const gridStart = new Date(year, month, 1)
  gridStart.setDate(1 - gridStart.getDay())
  const weeks = []
  const cur = new Date(gridStart)
  for (let w = 0; w < 6; w++) {
    const week = []
    for (let i = 0; i < 7; i++) { week.push(new Date(cur)); cur.setDate(cur.getDate() + 1) }
    if (week.some(d => d.getMonth() === month)) weeks.push(week)
  }

  const today = dateStr(new Date())
  const cells = weeks.map(week => `<tr>${week.map(d => {
    const ds = dateStr(d)
    const out = d.getMonth() !== month
    const items = inMonth.filter(e => ds >= e._start && ds <= e._end)
    const chips = items.map(e => {
      const t = ds === e._start ? timeLabel(e.start_at) : ''
      const cont = ds !== e._start ? ' cont' : ''
      return `<div class="chip${cont}" style="--c:${TYPE_HEX[e.type] || '#6b7280'}">${t ? `<b>${esc(t)}</b> ` : ''}${esc(e.title)}</div>`
    }).join('')
    return `<td class="${out ? 'out' : ''}${ds === today ? ' today' : ''}"><div class="num">${d.getDate()}</div>${chips}</td>`
  }).join('')}</tr>`).join('')

  const typesShown = [...new Set(inMonth.map(e => e.type))]
  const legend = typesShown.length > 1
    ? `<div class="legend">${typesShown.map(t => `<span><i style="background:${TYPE_HEX[t] || '#6b7280'}"></i>${esc(typeLabel(t))}</span>`).join('')}</div>`
    : ''

  const agenda = inMonth.map(e => {
    const s = new Date(e.start_at)
    const status = STATUS_BY_KEY[e.status]
    const details = [e.custom?.description, e.notes].filter(v => v && String(v).trim())
    const range = e._end !== e._start
      ? `through ${new Date(e._end + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : ''
    return `<div class="row">
      <div class="when"><div class="dow">${esc(s.toLocaleDateString('en-US', { weekday: 'short' }))}</div><div class="day">${s.getDate()}</div><div class="mon">${esc(s.toLocaleDateString('en-US', { month: 'short' }))}</div></div>
      <div class="what">
        <div class="t"><span class="dot" style="background:${TYPE_HEX[e.type] || '#6b7280'}"></span>${esc(e.title)}
          ${status ? `<span class="pill" style="color:${STATUS_HEX[e.status] || '#374151'};border-color:${STATUS_HEX[e.status] || '#d1d5db'}">${esc(status.label)}</span>` : ''}</div>
        <div class="meta">${[timeLabel(e.start_at), range, typesShown.length > 1 ? typeLabel(e.type) : '', locationsLabel(e.locations || [])].filter(Boolean).map(esc).join(' &middot; ')}</div>
        ${details.map(d => `<p>${esc(d)}</p>`).join('')}
      </div>
    </div>`
  }).join('')

  const logo = `${window.location.origin}/wcs-logo.png`
  const printed = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} - ${esc(monthName)}</title>
<style>
  @page { size: letter landscape; margin: 0.4in; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media screen { body { padding: 24px; } }
  body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; }
  header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #e53e3e; padding-bottom: 8px; margin-bottom: 10px; }
  header .l { display: flex; align-items: center; gap: 12px; }
  header img { height: 38px; }
  h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
  h1 span { color: #e53e3e; }
  .sub { font-size: 11px; color: #6b7280; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  .stamp { font-size: 10px; color: #9ca3af; text-align: right; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #6b7280; padding: 5px 0; background: #f9fafb; border: 1px solid #e5e7eb; }
  td { border: 1px solid #e5e7eb; vertical-align: top; height: 1.05in; padding: 4px; overflow: hidden; }
  td.out { background: #fafafa; }
  td.out .num { color: #d1d5db; }
  td.today .num { background: #e53e3e; color: #fff; border-radius: 999px; width: 18px; text-align: center; }
  .num { font-size: 11px; font-weight: 700; margin-bottom: 3px; }
  .chip { font-size: 9px; line-height: 1.25; padding: 2px 4px; margin-bottom: 2px; border-left: 3px solid var(--c); background: color-mix(in srgb, var(--c) 12%, white); border-radius: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chip.cont { opacity: 0.65; font-style: italic; }
  .legend { display: flex; gap: 14px; margin-top: 8px; font-size: 10px; color: #4b5563; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
  .agenda { page-break-before: always; }
  .agenda h2 { font-size: 15px; margin: 0 0 8px; }
  .row { display: flex; gap: 14px; padding: 9px 0; border-bottom: 1px solid #e5e7eb; page-break-inside: avoid; }
  .when { width: 46px; text-align: center; flex-shrink: 0; }
  .dow, .mon { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #6b7280; font-weight: 600; }
  .day { font-size: 20px; font-weight: 800; color: #e53e3e; line-height: 1.1; }
  .what { flex: 1; min-width: 0; }
  .t { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
  .dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
  .pill { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border: 1px solid; border-radius: 999px; padding: 1px 7px; margin-left: 4px; }
  .meta { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .what p { font-size: 11px; color: #374151; margin: 4px 0 0; white-space: pre-wrap; }
  .empty { text-align: center; color: #9ca3af; font-size: 12px; padding: 24px 0; }
</style></head><body>
<header>
  <div class="l"><img src="${logo}" alt="" onerror="this.remove()"><div><h1>${esc(title)} <span>&middot;</span> ${esc(monthName)}</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div></div>
  <div class="stamp">West Coast Strength<br>Printed ${esc(printed)}</div>
</header>
<table>
  <thead><tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<th>${d}</th>`).join('')}</tr></thead>
  <tbody>${cells}</tbody>
</table>
${legend}
<section class="agenda">
  <header style="border-bottom-width:2px"><div class="l"><img src="${logo}" alt="" onerror="this.remove()"><div><h1>${esc(monthName)} <span>&middot;</span> Details</h1>${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}</div></div><div class="stamp">${inMonth.length} ${inMonth.length === 1 ? 'item' : 'items'}</div></header>
  ${agenda || '<div class="empty">Nothing scheduled this month.</div>'}
</section>
<script>
  window.onload = function () { setTimeout(function () { window.print() }, 150) }
  window.onafterprint = function () { window.close() }
</script>
</body></html>`

  const w = window.open('', '_blank', 'width=1100,height=800')
  if (!w) {
    window.alert('Allow pop-ups for the portal to print the calendar.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
