import { useEffect, useMemo, useRef, useState } from 'react'
import { getChildcareReport } from '../../lib/api'
import { exportCSV } from '../../lib/export'
import { ReportBlock, ReportSection, StatBlock, StatCell } from './StatBlock'

const BLOCK_LABEL = { morning: 'Morning', evening: 'Evening' }

// An unknown count is shown as a dash, never as 0 — this report advises
// staffing, and a phantom zero reads as "nobody was here".
const num = (v) => (typeof v === 'number' ? String(v) : '—')

function Bar({ value, max }) {
  const pct = max > 0 && typeof value === 'number' ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-bg overflow-hidden">
      <div className="h-full rounded-full bg-wcs-red" style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function ChildcareReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('planning')
  const reqRef = useRef(0)

  useEffect(() => {
    const id = ++reqRef.current
    setLoading(true); setError('')
    getChildcareReport({ start: startDate, end: endDate, locationSlug })
      .then((d) => { if (id === reqRef.current) { setData(d); setLoading(false) } })
      .catch((e) => {
        if (id !== reqRef.current) return
        setError(e.message || 'Failed to load childcare data'); setLoading(false)
      })
  }, [startDate, endDate, locationSlug])

  const peakCombined = useMemo(() => {
    if (!data?.day_of_week?.length) return 0
    return Math.max(...data.day_of_week.map((r) => r.combined.avg || 0))
  }, [data])

  function exportLedger() {
    const rows = (data?.ledger || []).map((r) => ({
      date: r.date,
      day: r.day_of_week,
      club: r.location_slug,
      morning_over_1: r.morning ? num(r.morning.over1) : '',
      morning_under_1: r.morning ? num(r.morning.under1) : '',
      evening_over_1: r.evening ? num(r.evening.over1) : '',
      evening_under_1: r.evening ? num(r.evening.under1) : '',
      day_total: r.day_total,
      corrections: r.corrections || '',
    }))
    exportCSV(rows, `childcare-${startDate}-to-${endDate}.csv`)
  }

  if (loading) {
    return <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">Loading childcare data…</div>
  }
  if (error) {
    return <div className="bg-surface rounded-xl border border-border p-8 text-center text-wcs-red">{error}</div>
  }
  if (!data || data.entries === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
        No childcare headcounts recorded in this range.
        {(data?.warnings || []).map((w) => (
          <div key={w} className="mt-2 text-xs">{w}</div>
        ))}
      </div>
    )
  }

  const t = data.totals

  return (
    <div className="space-y-4">
      {(data.warnings || []).map((w) => (
        <div key={w} className="bg-surface rounded-xl border border-border p-3 text-sm text-text-muted">{w}</div>
      ))}

      <StatBlock>
        <StatCell label="Avg over 1yr" value={num(t.over1.avg)} sub={`peak ${num(t.over1.peak)}`} />
        <StatCell label="Avg under 1yr" value={num(t.under1.avg)} sub={`peak ${num(t.under1.peak)}`} />
        <StatCell label="Days reported" value={String(t.days_reported)} sub={`${t.blocks_reported} blocks`} />
        <StatCell label="Corrections" value={String(t.corrections)} sub="resubmitted blocks" />
      </StatBlock>

      <div className="flex gap-2">
        {[['planning', 'By day of week'], ['ledger', 'Daily log'], ['trend', 'Trend']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              tab === key
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-bg text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'planning' && (
        <ReportBlock>
          <ReportSection title="Average headcount by day of week">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3 font-medium">Day</th>
                    <th className="py-2 pr-3 font-medium">Block</th>
                    <th className="py-2 pr-3 font-medium text-right">Avg over 1yr</th>
                    <th className="py-2 pr-3 font-medium text-right">Avg under 1yr</th>
                    <th className="py-2 pr-3 font-medium text-right">Avg total</th>
                    <th className="py-2 pr-3 font-medium text-right">Peak</th>
                    <th className="py-2 pr-3 font-medium text-right">Samples</th>
                    <th className="py-2 font-medium w-32">Relative</th>
                  </tr>
                </thead>
                <tbody>
                  {data.day_of_week.map((r) => (
                    <tr key={`${r.dow}-${r.block}`} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 text-text-primary">{r.day_of_week}</td>
                      <td className="py-2 pr-3 text-text-muted">{BLOCK_LABEL[r.block]}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{num(r.over1.avg)}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{num(r.under1.avg)}</td>
                      <td className="py-2 pr-3 text-right font-medium text-text-primary">{num(r.combined.avg)}</td>
                      <td className="py-2 pr-3 text-right text-text-muted">{num(r.combined.peak)}</td>
                      <td className="py-2 pr-3 text-right text-text-muted">{r.combined.occurrences}</td>
                      <td className="py-2"><Bar value={r.combined.avg} max={peakCombined} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Averages count only blocks that reported a number; a skipped checklist is unknown, not zero.
              &ldquo;Samples&rdquo; is how many times that block was actually reported.
            </p>
          </ReportSection>
        </ReportBlock>
      )}

      {tab === 'ledger' && (
        <ReportBlock>
          <ReportSection
            title="Daily log"
            action={(
              <button
                onClick={exportLedger}
                className="px-3 py-1.5 rounded-lg text-sm border border-border bg-bg text-text-muted hover:text-text-primary"
              >
                Export CSV
              </button>
            )}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Club</th>
                    <th className="py-2 pr-3 font-medium text-right">AM over 1</th>
                    <th className="py-2 pr-3 font-medium text-right">AM under 1</th>
                    <th className="py-2 pr-3 font-medium text-right">PM over 1</th>
                    <th className="py-2 pr-3 font-medium text-right">PM under 1</th>
                    <th className="py-2 font-medium text-right">Day total</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((r) => (
                    <tr key={`${r.date}-${r.location_slug}`} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 text-text-primary">
                        {r.date} <span className="text-text-muted">{r.day_of_week}</span>
                        {r.corrections > 0 && (
                          <span className="ml-2 text-xs text-text-muted" title="A block was submitted more than once; the latest was used">
                            corrected
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 capitalize text-text-muted">{r.location_slug}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{r.morning ? num(r.morning.over1) : '—'}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{r.morning ? num(r.morning.under1) : '—'}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{r.evening ? num(r.evening.over1) : '—'}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{r.evening ? num(r.evening.under1) : '—'}</td>
                      <td className="py-2 text-right font-medium text-text-primary">{r.day_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>
        </ReportBlock>
      )}

      {tab === 'trend' && (
        <ReportBlock>
          <ReportSection title="Daily totals">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-text-muted border-b border-border">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium text-right">Over 1yr</th>
                    <th className="py-2 pr-3 font-medium text-right">Under 1yr</th>
                    <th className="py-2 pr-3 font-medium text-right">Total</th>
                    <th className="py-2 font-medium w-48">Relative</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trend.map((d) => (
                    <tr key={d.date} className="border-b border-border last:border-0">
                      <td className="py-2 pr-3 text-text-primary">{d.date}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{d.over1}</td>
                      <td className="py-2 pr-3 text-right text-text-primary">{d.under1}</td>
                      <td className="py-2 pr-3 text-right font-medium text-text-primary">{d.total}</td>
                      <td className="py-2">
                        <Bar value={d.total} max={Math.max(...data.trend.map((x) => x.total))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ReportSection>
        </ReportBlock>
      )}
    </div>
  )
}
