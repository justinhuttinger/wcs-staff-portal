import { getPTHealth } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

function fmtMoney(n) {
  const v = Number(n || 0)
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  return `${sign}$${abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

function fmtSignedNum(n) {
  const v = Number(n || 0)
  if (v > 0) return `+${v.toLocaleString()}`
  if (v < 0) return v.toLocaleString()
  return '0'
}

function fmtSignedMoney(n) {
  const v = Number(n || 0)
  return (v > 0 ? '+' : '') + fmtMoney(v)
}

function pct(numerator, denominator) {
  const n = Number(numerator || 0)
  const d = Number(denominator || 0)
  if (!d) return '0%'
  return `${Math.round((n / d) * 100)}%`
}

export default function PTHealthReport({ startDate, endDate, locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      if (!startDate || !endDate) return Promise.resolve(null)
      return getPTHealth(
        { start_date: startDate, end_date: endDate, location_slug: locationSlug || 'all' },
        { cache: true, signal }
      )
    },
    [startDate, endDate, locationSlug]
  )

  if (loading) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-text-muted italic">Crunching PT health from ABC + GHL — this may take a minute for all locations…</p>
        <DesktopLoading variant="report" />
      </div>
    )
  }

  if (error) {
    return <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">{error.message || String(error)}</div>
  }
  if (!data) return null

  const t = data.totals
  const netClientsTone = t.netClients > 0 ? 'green' : t.netClients < 0 ? 'red' : 'default'
  const netRevenueTone = t.netRevenue > 0 ? 'green' : t.netRevenue < 0 ? 'red' : 'default'

  return (
    <div className="space-y-5">
      {/* Headline: net change cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SummaryCard
          label="Net Change · Clients"
          value={<span className="text-3xl">{fmtSignedNum(t.netClients)}</span>}
          sub={`${t.newPT.count} new − ${t.deactivated.count} deactivated`}
          tone={netClientsTone}
        />
        <SummaryCard
          label="Net Change · Revenue"
          value={<span className="text-3xl">{fmtSignedMoney(t.netRevenue)}</span>}
          sub={`${fmtMoney(t.newPT.newClientRevenue)} new + ${fmtMoney(t.newPT.resignRevenue)} resign − ${fmtMoney(t.deactivated.value)} lost`}
          tone={netRevenueTone}
        />
      </div>

      {/* Component cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DetailCard
          label="Day Ones"
          value={t.dayOnes.set}
          rows={[
            ['Set', t.dayOnes.set],
            [`Show (${pct(t.dayOnes.show, t.dayOnes.set)})`, t.dayOnes.show],
            [`Close (${pct(t.dayOnes.close, t.dayOnes.show)} of show)`, t.dayOnes.close],
          ]}
          tone="blue"
        />
        <DetailCard
          label="New PT Sales"
          value={t.newPT.count}
          rows={[
            ['New Clients', t.newPT.newClientCount],
            ['Resigns', t.newPT.resignCount],
            ['Revenue', fmtMoney(t.newPT.revenue)],
          ]}
          tone="green"
        />
        <DetailCard
          label="Deactivated PT"
          value={t.deactivated.count}
          rows={[
            ['Deactivated RS', t.deactivated.deactivatedRSCount],
            ['PIF Burned', t.deactivated.burnedPIFCount],
            ['Monthly RS lost', fmtMoney(t.deactivated.deactivatedRSValue)],
            ['PIF total lost', fmtMoney(t.deactivated.burnedPIFValue)],
          ]}
          tone="red"
        />
      </div>

      {/* Per-location breakdown */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg">
              <tr className="text-xs uppercase tracking-wide text-text-muted">
                <th className="text-left px-4 py-2 font-semibold">Location</th>
                <th className="text-right px-4 py-2 font-semibold">Set</th>
                <th className="text-right px-4 py-2 font-semibold">Show</th>
                <th className="text-right px-4 py-2 font-semibold">Close</th>
                <th className="text-right px-4 py-2 font-semibold">New PT</th>
                <th className="text-right px-4 py-2 font-semibold">New $</th>
                <th className="text-right px-4 py-2 font-semibold">Deactivated</th>
                <th className="text-right px-4 py-2 font-semibold">Lost $</th>
                <th className="text-right px-4 py-2 font-semibold">Net Clients</th>
                <th className="text-right px-4 py-2 font-semibold">Net $</th>
              </tr>
            </thead>
            <tbody>
              {data.byLocation.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-text-muted text-sm">No data in this date range.</td>
                </tr>
              ) : (
                data.byLocation.map(c => (
                  <tr key={c.locationSlug} className="border-t border-border hover:bg-bg/60">
                    <td className="px-4 py-2 font-medium text-text-primary">{c.clubName}</td>
                    <td className="px-4 py-2 text-right text-text-primary">{c.dayOnes.set}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{c.dayOnes.show}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{c.dayOnes.close}</td>
                    <td className="px-4 py-2 text-right text-text-primary">{c.newPT.count}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{fmtMoney(c.newPT.revenue)}</td>
                    <td className="px-4 py-2 text-right text-text-primary">{c.deactivated.count}</td>
                    <td className="px-4 py-2 text-right text-text-muted">{fmtMoney(c.deactivated.value)}</td>
                    <td className={`px-4 py-2 text-right font-semibold ${c.netClients > 0 ? 'text-green-700' : c.netClients < 0 ? 'text-red-700' : 'text-text-muted'}`}>
                      {fmtSignedNum(c.netClients)}
                    </td>
                    <td className={`px-4 py-2 text-right font-semibold ${c.netRevenue > 0 ? 'text-green-700' : c.netRevenue < 0 ? 'text-red-700' : 'text-text-muted'}`}>
                      {fmtSignedMoney(c.netRevenue)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {data.byLocation.length > 0 && (
              <tfoot className="border-t-2 border-border">
                <tr className="bg-bg font-semibold">
                  <td className="px-4 py-2 text-text-primary">Totals</td>
                  <td className="px-4 py-2 text-right text-text-primary">{t.dayOnes.set}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{t.dayOnes.show}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{t.dayOnes.close}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{t.newPT.count}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(t.newPT.revenue)}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{t.deactivated.count}</td>
                  <td className="px-4 py-2 text-right text-text-primary">{fmtMoney(t.deactivated.value)}</td>
                  <td className={`px-4 py-2 text-right ${t.netClients > 0 ? 'text-green-700' : t.netClients < 0 ? 'text-red-700' : 'text-text-primary'}`}>
                    {fmtSignedNum(t.netClients)}
                  </td>
                  <td className={`px-4 py-2 text-right ${t.netRevenue > 0 ? 'text-green-700' : t.netRevenue < 0 ? 'text-red-700' : 'text-text-primary'}`}>
                    {fmtSignedMoney(t.netRevenue)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-xl px-4 py-2.5 text-xs text-text-primary">
        <span className="font-semibold">Set</span> = Day One booked in the range. <span className="font-semibold">Show</span> = day_one_status is <em>Completed</em>. <span className="font-semibold">Close</span> = Show ∩ day_one_sale is <em>Sale</em>. Pulled from the same source-of-truth as the Day One dashboard, so the numbers reconcile cell-for-cell. New PT and Deactivated PT use the same algorithms as their dedicated reports; Net = (new − deactivated) for both counts and dollars.
      </div>
    </div>
  )
}

function toneClasses(tone) {
  if (tone === 'green') return 'border-green-200 bg-green-50'
  if (tone === 'red') return 'border-red-200 bg-red-50'
  if (tone === 'blue') return 'border-blue-200 bg-blue-50'
  if (tone === 'amber') return 'border-amber-200 bg-amber-50'
  return 'border-border bg-surface'
}

function SummaryCard({ label, value, sub, tone }) {
  return (
    <div className={`rounded-xl border p-5 ${toneClasses(tone)}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <div className="font-bold text-text-primary mt-1">{value}</div>
      {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
    </div>
  )
}

function DetailCard({ label, value, rows, tone }) {
  return (
    <div className={`rounded-xl border p-4 ${toneClasses(tone)}`}>
      <p className="text-xs font-medium text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-3xl font-bold text-text-primary mt-1">{value}</p>
      <div className="mt-3 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <span className="text-text-muted">{k}</span>
            <span className="font-semibold text-text-primary">{v}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
