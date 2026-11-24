import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, exportL10ToSheet, getGoogleSheetsStatus, startGoogleSheetsAuth } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { fmtInt, fmtSigned, fmtMoney, fmtSignedPct, fmtMonth } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// L10 — Analytics (owner only)
//
// The weekly-meeting scorecard. Net Membership's in / out / net plus dues, PT,
// POS and total revenue, against last month or the six-month average.
//
// Owner only: hidden from the menu by `ownerOnly` in the registry, and refused
// by the server (lib/ownerGate) for anyone else.
//
// Two tables. The scorecard is the whole selection, one metric per row, with
// POS opening into its four goods lines. The club table puts every club against
// every metric so the one dragging the total is visible without changing the
// club picker seven times.
//
// Colour means BETTER or WORSE, never up or down: Lost Members going up is red.
//
// PT DAY ONES ARE ONE COLUMN, NOT THREE: Set · Show · Close as three numbers in
// one cell, each keyed by a shade of one hue, with each one's change under it.
// Numbers only — a bar version was tried and taken out at the owner's request.
// ---------------------------------------------------------------------------

const COMPARES = [
  { key: 'avg6', label: '6-Month Average', short: '6-Mo Avg' },
  { key: 'lastMonth', label: 'Last Month', short: 'Last Mo' },
]

function fmtValue(metric, v, { signed = false } = {}) {
  if (v === null || v === undefined) return 'N/A'
  if (metric.format === 'money') {
    if (!signed) return fmtMoney(v)
    return `${v > 0 ? '+' : v < 0 ? '-' : ''}${fmtMoney(Math.abs(v))}`
  }
  // Averages of member counts carry one decimal; current counts are whole.
  const isWhole = Number.isInteger(Number(v))
  if (signed || metric.signed) {
    return isWhole ? fmtSigned(v) : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`
  }
  return isWhole ? fmtInt(v) : Number(v).toFixed(1)
}

/** good | bad | neutral. Better or worse, not up or down: Lost Members rising is bad. */
function toneKind(metric, delta) {
  if (delta === null || delta === undefined || delta === 0) return 'neutral'
  const better = metric.lowerIsBetter ? delta < 0 : delta > 0
  return better ? 'good' : 'bad'
}

const TONE_CLASS = { good: 'text-emerald-600', bad: 'text-wcs-red', neutral: 'text-text-muted' }

function tone(metric, delta) {
  return TONE_CLASS[toneKind(metric, delta)]
}

/**
 * One By Club cell as text: the value, and the change under it. Shared by the
 * table on screen and the Google Sheet, so the export prints exactly what the
 * report prints rather than formatting the same numbers a second time.
 */
function clubCellText(metric, c) {
  if (metric.format === 'funnel') {
    // c here is the whole compare block; the stages live under their own keys.
    const cells = stageCells(metric, c)
    const main = cells.map(x => fmtValue(COUNT, x.value)).join(' · ')
    const sub = cells.map(x => fmtValue(COUNT, x.delta, { signed: true })).join(' · ')
    return {
      main,
      sub,
      tone: 'neutral',
      mainRuns: cells.map((x, i) => ({ text: (i ? ' · ' : '') + fmtValue(COUNT, x.value), color: x.key })),
      subRuns: cells.map((x, i) => ({ text: (i ? ' · ' : '') + fmtValue(COUNT, x.delta, { signed: true }), tone: toneKind(COUNT, x.delta) })),
    }
  }
  return {
    main: fmtValue(metric, c.value),
    sub: `${fmtValue(metric, c.delta, { signed: true })}${c.pct !== null && c.pct !== undefined ? ` (${fmtSignedPct(c.pct)})` : ''}`,
    tone: toneKind(metric, c.delta),
  }
}

// Three shades of one blue, light to dark, so Set / Show / Close read as stages
// of one thing rather than three unrelated series.
const STAGE_COLORS = { dayOneSet: '#c7dbf5', dayOneShow: '#6fa3e6', dayOneClose: '#1f5fae' }
const COUNT = { format: 'int' }

/** Stage values out of a compare() block: { [stageKey]: { value, base, delta } }. */
function stageCells(metric, cmp) {
  return metric.stages.map(st => ({ ...st, ...(cmp?.[st.key] || {}) }))
}

const rate = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—')

function funnelTitle(cells) {
  const [set, show, close] = cells.map(c => c.value || 0)
  return `Set ${fmtValue(COUNT, set)} · Show ${fmtValue(COUNT, show)} (${rate(show, set)} of set) · Close ${fmtValue(COUNT, close)} (${rate(close, show)} of shows)`
}

/**
 * The PT Day Ones cell: the three counts keyed by colour, and each count's
 * change under it.
 */
function FunnelBlock({ metric, cmp, bold = false, size = 'sm', compareLabel, align = 'end' }) {
  const cells = stageCells(metric, cmp)
  const big = size === 'lg'
  const justify = align === 'start' ? 'justify-start' : 'justify-end'
  const textAlign = align === 'start' ? 'text-left' : 'text-right'
  return (
    <div className="space-y-0.5" title={funnelTitle(cells)}>
      <div className={`flex items-center ${justify} gap-2 tabular-nums ${big ? 'text-sm' : ''} ${bold ? 'font-bold' : 'font-medium'} text-text-primary`}>
        {cells.map(c => (
          <span key={c.key} className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden="true" className="inline-block w-2 h-2 rounded-sm" style={{ background: STAGE_COLORS[c.key] }} />
            <span className="sr-only">{c.label}</span>
            {fmtValue(COUNT, c.value)}
          </span>
        ))}
      </div>
      <div className={`flex items-center ${justify} gap-2 tabular-nums text-[10px]`}>
        {cells.map(c => (
          <span key={c.key} className={`whitespace-nowrap ${tone(COUNT, c.delta)}`}>
            {fmtValue(COUNT, c.delta, { signed: true })}
          </span>
        ))}
      </div>
      {compareLabel && (
        <p className={`text-[10px] text-text-muted tabular-nums ${textAlign}`}>
          {compareLabel} {cells.map(c => fmtValue(COUNT, c.base)).join(' · ')}
        </p>
      )}
    </div>
  )
}

function StageLegend() {
  return (
    <span className="inline-flex items-center gap-2 normal-case tracking-normal font-medium">
      {[['dayOneSet', 'Set'], ['dayOneShow', 'Show'], ['dayOneClose', 'Close']].map(([k, l]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block w-2 h-2 rounded-sm" style={{ background: STAGE_COLORS[k] }} />
          {l}
        </span>
      ))}
    </span>
  )
}

function Arrow({ metric, delta }) {
  if (delta === null || delta === undefined || delta === 0) return null
  const better = metric.lowerIsBetter ? delta < 0 : delta > 0
  return (
    <>
      <span aria-hidden="true" className="ml-1 text-[9px]">{delta > 0 ? '▲' : '▼'}</span>
      <span className="sr-only">{better ? 'better' : 'worse'}</span>
    </>
  )
}

function Tile({ metric, cmp, compareLabel }) {
  if (metric.format === 'funnel') {
    return (
      <div className="bg-surface rounded-xl border border-border px-3 py-2">
        <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">{metric.label}</p>
        <div className="mt-0.5">
          <FunnelBlock metric={metric} cmp={cmp} size="lg" bold compareLabel={compareLabel} align="start" />
        </div>
      </div>
    )
  }
  const c = cmp?.[metric.key]
  if (!c) return null
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2">
      <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">{metric.label}</p>
      <p className="text-lg font-bold tabular-nums text-text-primary">{fmtValue(metric, c.value)}</p>
      <p className={`text-[11px] font-semibold tabular-nums ${tone(metric, c.delta)}`}>
        {fmtValue(metric, c.delta, { signed: true })}
        {c.pct !== null && c.pct !== undefined && <span className="ml-1">({fmtSignedPct(c.pct)})</span>}
        <Arrow metric={metric} delta={c.delta} />
      </p>
      <p className="text-[10px] text-text-muted tabular-nums">{compareLabel} {fmtValue(metric, c.base)}</p>
    </div>
  )
}

function Scorecard({ data, compare, compareLabel }) {
  const [posOpen, setPosOpen] = useState(false)
  const t = data.totals
  const cmp = t[compare]
  const history = t.history || []
  // Oldest first, matching history.
  const histWindows = (data.windows || []).slice(1).reverse()

  const lines = []
  for (const m of data.metrics) {
    lines.push({ metric: m, key: m.key, label: m.label, sub: false })
    if (m.parts && posOpen) {
      for (const p of m.parts) {
        lines.push({ metric: { ...m, label: p, parts: undefined }, key: `pos:${p}`, label: p, sub: true })
      }
    }
  }

  const thBase = 'px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wide whitespace-nowrap'
  const th = `${thBase} text-right`

  return (
    <div className="bg-surface rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className={`${thBase} text-left`}>Metric</th>
            <th className={th}>This Period</th>
            <th className={th}>{compareLabel}</th>
            <th className={th}>Change</th>
            <th className={th}>%</th>
            {histWindows.map(w => (
              <th key={w.start} className={`${th} font-medium`} title={`${w.start} to ${w.end}`}>{fmtMonth(w.start)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const c = cmp[line.key]
            const m = line.metric
            if (m.format === 'funnel') {
              const cells = stageCells(m, cmp)
              const triple = vals => vals.map(v => fmtValue(COUNT, v)).join(' · ')
              return (
                <tr key={line.key} className={`group border-b border-border/60 ${zebra(i)} ${HOVER_TINT}`}>
                  <td className="px-3 py-2 text-left whitespace-nowrap font-semibold text-text-primary">
                    {line.label}
                    <div className="text-[10px] font-medium text-text-muted mt-0.5"><StageLegend /></div>
                  </td>
                  <td className="px-3 py-2 text-right"><FunnelBlock metric={m} cmp={cmp} bold /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted whitespace-nowrap">{triple(cells.map(x => x.base))}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">
                    {cells.map((x, j) => (
                      <span key={x.key} className={tone(COUNT, x.delta)}>{j ? ' · ' : ''}{fmtValue(COUNT, x.delta, { signed: true })}</span>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-muted">—</td>
                  {history.map((h, j) => (
                    <td key={j} className="px-3 py-2 text-right tabular-nums text-text-muted whitespace-nowrap" title={funnelTitle(m.stages.map(st => ({ ...st, value: h[st.key] })))}>
                      {triple(m.stages.map(st => h[st.key]))}
                    </td>
                  ))}
                </tr>
              )
            }
            return (
              <tr key={line.key} className={`group border-b border-border/60 ${zebra(i)} ${HOVER_TINT}`}>
                <td className={`px-3 py-2 text-left whitespace-nowrap ${line.sub ? 'pl-8 text-text-muted' : 'font-semibold text-text-primary'}`}>
                  {m.parts ? (
                    <button
                      type="button"
                      onClick={() => setPosOpen(o => !o)}
                      className="font-semibold text-text-primary hover:text-wcs-red"
                      aria-expanded={posOpen}
                    >
                      {posOpen ? '−' : '+'} {line.label}
                    </button>
                  ) : line.label}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-bold text-text-primary">{fmtValue(m, c.value)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtValue(m, c.base)}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-semibold ${tone(m, c.delta)}`}>
                  {fmtValue(m, c.delta, { signed: true })}
                  <Arrow metric={m} delta={c.delta} />
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${tone(m, c.delta)}`}>
                  {c.pct === null || c.pct === undefined ? '—' : fmtSignedPct(c.pct)}
                </td>
                {history.map((h, j) => (
                  <td key={j} className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtValue(m, h[line.key])}</td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The By Club table as sheet rows: one per club plus the total, and for every
 * metric this period, the comparison, the change and the %. POS is followed by
 * its four goods lines, which the on-screen table folds away. Raw numbers, not
 * formatted ones, so the sheet sums and sorts.
 */
function clubSheet(data, compare, cmpDef) {
  const cols = []
  for (const m of data.metrics) {
    if (m.stages) {
      for (const st of m.stages) cols.push({ key: st.key, label: `Day Ones ${st.label}` })
      continue
    }
    cols.push({ key: m.key, label: m.label })
    if (m.parts) for (const p of m.parts) cols.push({ key: `pos:${p}`, label: `POS ${p}` })
  }
  const header = ['Club']
  for (const c of cols) {
    header.push(c.label, `${c.label} (${cmpDef.label})`, `${c.label} Change`, `${c.label} Change %`)
  }
  const blank = v => (v === null || v === undefined ? null : v)
  const body = [...data.rows, data.totals].map(r => {
    const cmp = r[compare]
    const line = [r.key === 'total' ? 'Total' : r.label]
    for (const c of cols) {
      const x = cmp[c.key] || {}
      line.push(blank(x.value), blank(x.base), blank(x.delta), blank(x.pct))
    }
    return line
  })
  return { title: exportTitle(data, cmpDef), spec: clubSpec(data, compare, cmpDef), rows: [header, ...body] }
}

function exportTitle(data, cmpDef) {
  const meta = data.meta || {}
  return `WCS L10 — By Club — ${meta.start} to ${meta.end} vs ${cmpDef.label}`
}

function exportSubtitle(data, cmpDef) {
  const meta = data.meta || {}
  const span = meta.windowLabel || `${meta.start} to ${meta.end}`
  return `${span} · change vs ${cmpDef.label.toLowerCase()}`
}

/** The styled By Club tab: the same columns, cells and colours as the table. */
function clubSpec(data, compare, cmpDef) {
  return {
    heading: 'L10 — By Club',
    subheading: exportSubtitle(data, cmpDef),
    columns: ['Club', ...data.metrics.map(m => (m.stages ? `${m.label} (Set · Show · Close)` : m.label))],
    rows: [...data.rows, data.totals].map(r => ({
      label: r.key === 'total' ? 'Total' : r.label,
      total: r.key === 'total',
      cells: data.metrics.map(m => clubCellText(m, m.format === 'funnel' ? r[compare] : r[compare][m.key])),
    })),
  }
}

// Per-user Google connection, the same one Payroll's export uses. The OAuth
// popup posts back on success; polling for close is the backup.
function useGoogleSheets() {
  const [google, setGoogle] = useState({ loaded: false, connected: false })
  const [connecting, setConnecting] = useState(false)

  async function refresh() {
    try {
      const st = await getGoogleSheetsStatus()
      setGoogle({ loaded: true, connected: !!st.connected })
    } catch {
      setGoogle({ loaded: true, connected: false })
    }
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => {
    function onMessage(e) {
      if (e.data && e.data.type === 'google-sheets-auth') refresh()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  async function connect() {
    if (connecting) return
    setConnecting(true)
    const { url } = await startGoogleSheetsAuth()
    const popup = window.open(url, 'wcs-google-auth', 'width=520,height=720')
    if (!popup) {
      setConnecting(false)
      throw new Error('Popup blocked. Allow popups for this site and try again.')
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer)
        refresh()
        setConnecting(false)
      }
    }, 800)
  }

  return { google, connecting, connect, refresh }
}

const BUTTON = 'px-2.5 py-1 rounded-lg text-xs font-medium bg-bg border border-border text-text-primary hover:border-wcs-red hover:text-wcs-red disabled:opacity-50'

/**
 * A PDF of the By Club table, made from the table itself, so it is the report
 * pixel for pixel rather than a redrawing of it. html-to-image and jsPDF are
 * loaded only when somebody exports, as the Member Map export does.
 */
function PdfExport({ data, cmpDef, tableRef }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function run(orientation) {
    if (busy || !tableRef.current) return
    setBusy(orientation)
    setErr(null)
    try {
      const { exportTablePdf } = await import('./l10Export')
      const meta = data.meta || {}
      const vs = cmpDef.key === 'lastMonth' ? 'vs-last-month' : 'vs-6mo-avg'
      await exportTablePdf(tableRef.current, {
        title: 'L10 — By Club',
        subtitle: exportSubtitle(data, cmpDef),
        filename: `l10-by-club_${meta.start}_to_${meta.end}_${vs}_${orientation}.pdf`,
        orientation,
      })
    } catch (e) {
      setErr(e?.message || 'PDF export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {err && <span className="text-[11px] text-amber-600">{err}</span>}
      <button type="button" onClick={() => run('landscape')} disabled={!!busy} className={BUTTON} title="Whole table on one landscape page">
        {busy === 'landscape' ? 'Exporting…' : 'PDF · Landscape'}
      </button>
      <button type="button" onClick={() => run('portrait')} disabled={!!busy} className={BUTTON} title="Columns split across two portrait pages">
        {busy === 'portrait' ? 'Exporting…' : 'PDF · Portrait'}
      </button>
    </>
  )
}

function SheetExport({ data, compare, cmpDef }) {
  const { google, connecting, connect, refresh } = useGoogleSheets()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [lastUrl, setLastUrl] = useState(null)

  async function run() {
    if (busy) return
    setErr(null)
    if (!google.connected) {
      try { await connect() } catch (e) { setErr(e.message || 'Could not start Google sign-in') }
      return
    }
    // Opened before the request, while the click still counts as a user
    // gesture, so the browser does not block it as a popup.
    const win = window.open('', '_blank')
    setBusy(true)
    try {
      const result = await exportL10ToSheet(clubSheet(data, compare, cmpDef))
      if (result?.url) {
        setLastUrl(result.url)
        if (win) win.location.href = result.url
      } else if (win) win.close()
    } catch (e) {
      if (win) win.close()
      const msg = e?.message || 'Export failed'
      // The token can expire between loading the page and clicking export.
      if (/google_not_connected/i.test(msg)) {
        await refresh()
        setErr('Google is not connected. Click Connect Google and try again.')
      } else {
        setErr(msg)
      }
    } finally {
      setBusy(false)
    }
  }

  const label = busy
    ? 'Exporting…'
    : connecting
      ? 'Connecting…'
      : google.loaded && !google.connected ? 'Connect Google' : 'Export to Google Sheets'

  return (
    <>
      {err && <span className="text-[11px] text-amber-600">{err}</span>}
      {lastUrl && !err && (
        <a href={lastUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-wcs-red underline">
          Open last export
        </a>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy || connecting || !google.loaded}
        className={BUTTON}
      >
        {label}
      </button>
    </>
  )
}

function ClubTable({ data, compare, compareShort, tableRef }) {
  const metrics = data.metrics
  const rows = [...data.rows, data.totals]
  const thBase = 'px-3 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wide whitespace-nowrap'
  const th = `${thBase} text-right`
  return (
    <div ref={tableRef} className="bg-surface rounded-xl border border-border overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className={`${thBase} text-left sticky left-0 bg-surface`}>Club</th>
            {metrics.map(m => (
              <th key={m.key} className={th}>
                {m.label}
                {m.format === 'funnel' && <div className="mt-0.5 text-[10px] text-text-muted"><StageLegend /></div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isTotal = r.key === 'total'
            const cmp = r[compare]
            return (
              <tr key={r.key} className={`group border-b border-border/60 ${zebra(i)} ${HOVER_TINT} ${isTotal ? 'border-t-2 border-t-border' : ''}`}>
                <td className={`px-3 py-2 text-left whitespace-nowrap sticky left-0 ${zebra(i)} ${isTotal ? 'font-bold' : 'font-semibold'} text-text-primary`}>
                  {isTotal ? 'Total' : r.label}
                </td>
                {metrics.map(m => {
                  if (m.format === 'funnel') {
                    return (
                      <td key={m.key} className="px-3 py-1.5 text-right align-top">
                        <FunnelBlock metric={m} cmp={cmp} bold={isTotal} />
                      </td>
                    )
                  }
                  const c = cmp[m.key]
                  const t = clubCellText(m, c)
                  return (
                    <td key={m.key} className="px-3 py-1.5 text-right tabular-nums align-top">
                      <div className={`${isTotal ? 'font-bold' : 'font-medium'} text-text-primary`}>{t.main}</div>
                      <div
                        className={`text-[10px] ${TONE_CLASS[t.tone]}`}
                        title={`${compareShort}: ${fmtValue(m, c.base)}`}
                      >
                        {t.sub}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function L10({ startDate, endDate, locationSlug, category, basis }) {
  const [compare, setCompare] = useState('avg6')
  const clubTableRef = useRef(null)

  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all',
    category: category || 'all', basis: basis || 'members',
  }).toString(), [startDate, endDate, locationSlug, category, basis])

  const { data, loading, error, retrying } = useCancellableFetch(
    (signal) => api(`/analytics/l10?${query}`, { cache: true, signal }),
    [query]
  )

  const cmpDef = COMPARES.find(c => c.key === compare) || COMPARES[0]
  const meta = data?.meta
  const compareRange = meta
    ? (compare === 'lastMonth'
      ? `${meta.lastMonthStart} to ${meta.lastMonthEnd}`
      : `the same ${meta.spanDays} days in each of the six prior months (${fmtMonth(meta.avgStart)} to ${fmtMonth(meta.avgEnd)})`)
    : ''

  return (
    <div className="space-y-3">
      <Toolbar compare={compare} setCompare={setCompare} />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {meta?.notes?.dataEdge && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{meta.notes.dataEdge}</p>
            </div>
          )}

          <p className="text-[11px] text-text-muted px-1">
            {meta?.windowLabel || `${meta?.start} to ${meta?.end}`} against {cmpDef.label.toLowerCase()}: {compareRange}.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            {data.metrics.map(m => (
              <Tile key={m.key} metric={m} cmp={data.totals[compare]} compareLabel={cmpDef.short} />
            ))}
          </div>

          <Scorecard data={data} compare={compare} compareLabel={cmpDef.label} />

          <div className="flex items-center justify-between px-1 pt-2">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">By Club</h3>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <PdfExport data={data} cmpDef={cmpDef} tableRef={clubTableRef} />
              <SheetExport data={data} compare={compare} cmpDef={cmpDef} />
            </div>
          </div>
          <ClubTable data={data} compare={compare} compareShort={cmpDef.short} tableRef={clubTableRef} />

          <ul className="text-[11px] text-text-muted px-1 space-y-0.5 list-disc pl-5">
            {['members', 'dayOnes', 'dues', 'pos', 'total', 'compare', 'filter'].map(k => (
              meta?.notes?.[k] ? <li key={k}>{meta.notes[k]}</li> : <Fragment key={k} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Toolbar({ compare, setCompare }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
      Compare To
      <div className="flex rounded-lg border border-border overflow-hidden normal-case tracking-normal">
        {COMPARES.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => setCompare(c.key)}
            aria-pressed={compare === c.key}
            className={`px-2.5 py-1.5 text-xs font-medium ${compare === c.key ? 'bg-wcs-red text-white' : 'bg-bg text-text-primary hover:bg-surface'}`}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>,
    slot
  )
}
