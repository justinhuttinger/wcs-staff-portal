import { useState, useEffect, useCallback } from 'react'
import { getMarketingScoreboard, saveMarketingScoreboardGoals } from '../../lib/api'
import DesktopLoading from '../DesktopLoading'

// Marketing Scoreboard — the daily ad sheet, rebuilt from our own data.
// Two tables for one month: Meta (paid Facebook / Instagram, with spend and
// CPL) and Organic (the website with no paid click, with GA4 sessions). Each
// has a row per day, a totals row, and month-end pace against goals that are
// edited right here. Counting rules: auth/migrations/221_marketing_scoreboard.sql.
// Month comes from its own picker; the club from the Reporting shell.

const money = v => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
const num = v => (v == null ? '—' : Number(v).toLocaleString('en-US'))
const pct = v => (v == null ? '—' : `${v}%`)

function thisMonth() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date()).slice(0, 7)
}

function shortDay(iso) {
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

// The Reporting shell can hand over several clubs; the scoreboard shows one
// club or all of them.
function clubParam(locationSlug) {
  if (!locationSlug || locationSlug === 'all' || String(locationSlug).includes(',')) return 'all'
  return locationSlug
}

const TH = 'py-2 px-2 text-right font-semibold'
const TD = 'py-1.5 px-2 text-right tabular-nums'

function GroupHeader({ groups }) {
  return (
    <tr className="text-[10px] uppercase tracking-wider text-text-muted bg-bg/50">
      <th className="py-2 px-3" />
      {groups.map(g => (
        <th key={g.label} colSpan={g.span} className={`py-2 px-2 text-center border-l border-border ${g.accent ? 'text-wcs-red' : ''}`}>{g.label}</th>
      ))}
    </tr>
  )
}

function PaceTable({ goals, editing, draft, setDraft }) {
  const keys = ['leads', 'carts', 'joins']
  return (
    <table className="text-sm">
      <thead>
        <tr className="text-[10px] uppercase tracking-wider text-text-muted">
          <th className="py-1 pr-4 text-left" />
          {keys.map(k => <th key={k} className="py-1 px-3 text-right">{k}</th>)}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="py-1 pr-4 text-text-muted">Month-end pace</td>
          {keys.map(k => <td key={k} className="py-1 px-3 text-right tabular-nums text-text-primary">{num(goals[k].pace)}</td>)}
        </tr>
        <tr>
          <td className="py-1 pr-4 text-text-muted">Goal</td>
          {keys.map(k => (
            <td key={k} className="py-1 px-3 text-right tabular-nums">
              {editing ? (
                <input type="number" min="0" value={draft[k] ?? ''} onChange={e => setDraft({ ...draft, [k]: e.target.value })}
                  className="w-20 text-right rounded border border-border bg-bg px-1.5 py-0.5" />
              ) : num(goals[k].goal)}
            </td>
          ))}
        </tr>
        <tr>
          <td className="py-1 pr-4 text-text-muted">vs goal</td>
          {keys.map(k => {
            const d = goals[k].diff
            return (
              <td key={k} className={`py-1 px-3 text-right tabular-nums font-semibold ${d == null ? 'text-text-muted' : d < 0 ? 'text-red-600' : 'text-green-600'}`}>
                {d == null ? '—' : (d > 0 ? '+' : '') + num(d)}
              </td>
            )
          })}
        </tr>
      </tbody>
    </table>
  )
}

function GoalsPanel({ channel, data, month, club, onSaved, children }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  function start() {
    setDraft({
      leads: data.goals.leads.goal ?? '',
      carts: data.goals.carts.goal ?? '',
      joins: data.goals.joins.goal ?? '',
      target_cpl: data.cplTarget?.target ?? '',
    })
    setErr(null)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      await saveMarketingScoreboardGoals({ month, channel, club, ...draft })
      setEditing(false)
      onSaved()
    } catch (e) {
      setErr(e.message || 'Could not save goals')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-8 px-4 py-4 border-t border-border">
      {children}
      <div>
        <PaceTable goals={data.goals} editing={editing} draft={draft} setDraft={setDraft} />
        {channel === 'meta' && editing && (
          <label className="flex items-center gap-2 mt-2 text-sm text-text-muted">
            Target CPL $
            <input type="number" min="0" step="0.01" value={draft.target_cpl} onChange={e => setDraft({ ...draft, target_cpl: e.target.value })}
              className="w-24 text-right rounded border border-border bg-bg px-1.5 py-0.5" />
          </label>
        )}
        <div className="flex items-center gap-2 mt-3">
          {editing ? (
            <>
              <button onClick={save} disabled={saving} className="px-3 py-1 text-xs font-semibold rounded bg-wcs-red text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save goals'}</button>
              <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs rounded border border-border text-text-muted">Cancel</button>
            </>
          ) : (
            <button onClick={start} className="px-3 py-1 text-xs rounded border border-border text-text-muted hover:text-text-primary">Edit goals</button>
          )}
          {err && <span className="text-xs text-red-600">{err}</span>}
        </div>
      </div>
    </div>
  )
}

function MetaTable({ data, month, club, onSaved }) {
  const t = data.totals
  const target = data.cplTarget
  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">Meta</h3>
        <p className="text-xs text-text-muted">Paid Facebook &amp; Instagram: Instant Form leads, and website / Online Join visits from a paid click.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <GroupHeader groups={[{ label: 'Activity', span: 2 }, { label: 'KPIs', span: 3, accent: true }, { label: 'Spend', span: 1 }, { label: 'CPL', span: 2 }]} />
            <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
              <th className="py-2 px-3 text-left">Day</th>
              <th className={`${TH} border-l border-border`}>Imp</th><th className={TH}>Clicks</th>
              <th className={`${TH} border-l border-border`}>Leads</th><th className={TH}>Carts</th><th className={TH}>Joins</th>
              <th className={`${TH} border-l border-border`}>Spend</th>
              <th className={`${TH} border-l border-border`}>Day</th><th className={TH}>MTD</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.day} className="border-b border-border/40 hover:bg-bg/40">
                <td className="py-1.5 px-3 text-text-primary whitespace-nowrap">{shortDay(r.day)}</td>
                <td className={`${TD} border-l border-border/60 text-text-muted`}>{num(r.impressions)}</td>
                <td className={`${TD} text-text-muted`}>{num(r.clicks)}</td>
                <td className={`${TD} border-l border-border/60 text-text-primary`}>{num(r.leads)}</td>
                <td className={`${TD} text-text-primary`}>{num(r.carts)}</td>
                <td className={`${TD} text-text-primary font-semibold`}>{num(r.joins)}</td>
                <td className={`${TD} border-l border-border/60`}>{money(r.spend)}</td>
                <td className={`${TD} border-l border-border/60 text-text-muted`}>{money(r.cplDay)}</td>
                <td className={TD}>{money(r.cplMtd)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-bg/50 font-bold text-text-primary">
              <td className="py-2 px-3">Total</td>
              <td className={`${TD} border-l border-border/60`}>{num(t.impressions)}</td>
              <td className={TD}>{num(t.clicks)}</td>
              <td className={`${TD} border-l border-border/60`}>{num(t.leads)}</td>
              <td className={TD}>{num(t.carts)}</td>
              <td className={TD}>{num(t.joins)}</td>
              <td className={`${TD} border-l border-border/60`}>{money(t.spend)}</td>
              <td className={`${TD} border-l border-border/60`} />
              <td className={`${TD} ${target && target.over != null ? (target.over > 0 ? 'text-red-600' : 'text-green-600') : ''}`}>{money(data.costs.perLead)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <GoalsPanel channel="meta" data={data} month={month} club={club} onSaved={onSaved}>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Cost per</p>
          <table className="text-sm">
            <tbody>
              <tr><td className="py-1 pr-4 text-text-muted">Lead</td><td className="py-1 text-right tabular-nums font-semibold text-text-primary">{money(data.costs.perLead)}</td></tr>
              <tr><td className="py-1 pr-4 text-text-muted">Cart</td><td className="py-1 text-right tabular-nums font-semibold text-text-primary">{money(data.costs.perCart)}</td></tr>
              <tr><td className="py-1 pr-4 text-text-muted">Join</td><td className="py-1 text-right tabular-nums font-semibold text-text-primary">{money(data.costs.perJoin)}</td></tr>
            </tbody>
          </table>
        </div>
        {target && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">CPL vs target</p>
            <p className="text-sm text-text-muted">Target <span className="font-semibold text-text-primary">{money(target.target)}</span></p>
            {target.over != null && (
              <p className={`text-sm font-semibold ${target.over > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {target.over > 0 ? `${money(target.over)} over (${target.overPct}%)` : `${money(-target.over)} under (${-target.overPct}%)`}
              </p>
            )}
          </div>
        )}
      </GoalsPanel>
    </div>
  )
}

function OrganicTable({ data, month, club, onSaved }) {
  const t = data.totals
  const hasSessions = t.sessions != null
  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-bold text-text-primary">Organic website</h3>
        <p className="text-xs text-text-muted">The website with no paid click: direct, search, referral and organic social. Sessions exclude paid channels.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <GroupHeader groups={[{ label: 'Traffic', span: 1 }, { label: 'KPIs', span: 3, accent: true }, { label: 'Rate', span: 1 }]} />
            <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
              <th className="py-2 px-3 text-left">Day</th>
              <th className={`${TH} border-l border-border`}>Sessions</th>
              <th className={`${TH} border-l border-border`}>Leads</th><th className={TH}>Carts</th><th className={TH}>Joins</th>
              <th className={`${TH} border-l border-border`} title="Leads per 100 organic sessions">Lead&nbsp;%</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.day} className="border-b border-border/40 hover:bg-bg/40">
                <td className="py-1.5 px-3 text-text-primary whitespace-nowrap">{shortDay(r.day)}</td>
                <td className={`${TD} border-l border-border/60 text-text-muted`}>{hasSessions ? num(r.sessions) : '—'}</td>
                <td className={`${TD} border-l border-border/60 text-text-primary`}>{num(r.leads)}</td>
                <td className={`${TD} text-text-primary`}>{num(r.carts)}</td>
                <td className={`${TD} text-text-primary font-semibold`}>{num(r.joins)}</td>
                <td className={`${TD} border-l border-border/60 text-text-muted`}>{pct(r.leadRate)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-bg/50 font-bold text-text-primary">
              <td className="py-2 px-3">Total</td>
              <td className={`${TD} border-l border-border/60`}>{hasSessions ? num(t.sessions) : '—'}</td>
              <td className={`${TD} border-l border-border/60`}>{num(t.leads)}</td>
              <td className={TD}>{num(t.carts)}</td>
              <td className={TD}>{num(t.joins)}</td>
              <td className={`${TD} border-l border-border/60`}>{pct(data.rates.leadRate)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <GoalsPanel channel="organic" data={data} month={month} club={club} onSaved={onSaved}>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-muted mb-1">Rates</p>
          <table className="text-sm">
            <tbody>
              <tr><td className="py-1 pr-4 text-text-muted">Leads / sessions</td><td className="py-1 text-right tabular-nums font-semibold text-text-primary">{pct(data.rates.leadRate)}</td></tr>
              <tr><td className="py-1 pr-4 text-text-muted">Carts → joins</td><td className="py-1 text-right tabular-nums font-semibold text-text-primary">{pct(data.rates.cartToJoin)}</td></tr>
            </tbody>
          </table>
        </div>
      </GoalsPanel>
    </div>
  )
}

export default function MarketingScoreboardReport({ locationSlug }) {
  const [month, setMonth] = useState(thisMonth())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const club = clubParam(locationSlug)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getMarketingScoreboard({ month, club }))
    } catch (e) {
      setError(e.message || 'Failed to load the scoreboard')
    } finally {
      setLoading(false)
    }
  }, [month, club])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border px-4 py-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Month
          <input type="month" value={month} max={thisMonth()} onChange={e => e.target.value && setMonth(e.target.value)}
            className="rounded border border-border bg-bg px-2 py-1 text-text-primary" />
        </label>
        {data && (
          <span className="text-xs text-text-muted">
            {club === 'all' ? 'All clubs' : club.charAt(0).toUpperCase() + club.slice(1)} · through {shortDay(data.through)} · day {data.elapsedDays} of {data.monthDays}
          </span>
        )}
        {String(locationSlug || '').includes(',') && <span className="text-xs text-amber-600">Showing all clubs: pick one club or All.</span>}
      </div>

      {data?.warnings?.map(w => (
        <p key={w} className="text-xs text-amber-700 bg-surface/95 rounded-xl border border-border px-4 py-2">{w}</p>
      ))}

      {loading && !data && <DesktopLoading />}
      {error && <p className="text-sm text-red-600 bg-surface/95 rounded-xl border border-border p-4">{error}</p>}

      {data && (
        <div className={`space-y-4 ${loading ? 'opacity-60' : ''}`}>
          <MetaTable data={data.meta} month={data.month} club={club} onSaved={load} />
          <OrganicTable data={data.organic} month={data.month} club={club} onSaved={load} />
        </div>
      )}
    </div>
  )
}
