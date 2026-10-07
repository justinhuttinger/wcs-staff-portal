import { useEffect, useMemo, useState } from 'react'
import { onlineJoin } from '../../lib/api'
import { FeaturesEditor } from './OnlineJoinPlans'
import PlanEditor from './OnlineJoinPlanEditor'
import { loadAbcPlanSummary } from './OnlineJoinAbcPicker'
import { abcIssues, fmtMoney } from '../../lib/abcPlan'

// Membership Types, club-first. Pick a club and see every membership card the
// join page shows there, each with its 1-Year / Month-to-Month plans, what
// they cost, and whether they still match ABC. Promo offers sit in their own
// row with the link to share.

const PROSPECTS_BASE = import.meta.env.VITE_PROSPECTS_API_URL || 'https://prospects-documents.onrender.com'
const CLUB_KEY = 'oj-admin-club'
const inputCls = 'w-full px-3 py-1.5 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:border-wcs-red disabled:opacity-60'
const TERMS = [['1yr', '1-Year'], ['m2m', 'Month-to-Month']]

function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toIso(v) {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d.toISOString()
}
function readClub() { try { return localStorage.getItem(CLUB_KEY) || '' } catch { return '' } }
function saveClub(v) { try { localStorage.setItem(CLUB_KEY, v) } catch { /* private mode */ } }
function joinUrl(locationId, promo) {
  return `${PROSPECTS_BASE}/widget/online-join?location=${encodeURIComponent(locationId)}${promo ? `&promo=${encodeURIComponent(promo)}` : ''}`
}

export default function OnlineJoinTypes() {
  const [locations, setLocations] = useState([])
  const [ageRules, setAgeRules] = useState([])
  const [club, setClub] = useState(readClub)
  const [types, setTypes] = useState([])
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showInactive, setShowInactive] = useState(false)
  const [editingType, setEditingType] = useState(null)
  const [editingPlan, setEditingPlan] = useState(null)
  // ABC check: planId -> { status: 'loading' | 'ok' | 'issues' | 'error', issues: [] }
  const [checks, setChecks] = useState({})
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    Promise.all([onlineJoin.listLocations(), onlineJoin.listAgeRules()])
      .then(([l, r]) => {
        const locs = (l.locations || []).filter(x => x.active !== false)
        setLocations(locs)
        setAgeRules(r.age_rules || [])
        setClub(c => (c && locs.some(x => x.wcs_location_id === c)) ? c : (locs[0]?.wcs_location_id || ''))
      })
      .catch(e => setError(e.message || 'Failed to load clubs'))
  }, [])

  async function load() {
    if (!club) return
    setLoading(true); setError(null)
    try {
      const [t, p] = await Promise.all([onlineJoin.listTypes(club), onlineJoin.listPlans(club)])
      setTypes(t.types || [])
      setPlans(p.plans || [])
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { saveClub(club); setChecks({}); load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [club])

  const location = locations.find(l => l.wcs_location_id === club)
  const prorated = !!location?.prorated_billing

  const plansByType = useMemo(() => {
    const m = new Map()
    for (const p of plans) {
      if (!p.membership_type_id) continue
      if (!m.has(p.membership_type_id)) m.set(p.membership_type_id, [])
      m.get(p.membership_type_id).push(p)
    }
    return m
  }, [plans])
  const loosePlans = plans.filter(p => !p.membership_type_id && p.active)

  const visible = types.filter(t => showInactive || t.active)
  const regular = visible.filter(t => !t.promo_code)
  const promos = visible.filter(t => t.promo_code)
  const inactiveCount = types.filter(t => !t.active).length + plans.filter(p => !p.active && types.some(t => t.id === p.membership_type_id && t.active)).length

  async function checkAbc() {
    if (!location?.abc_club_number) return
    setChecking(true)
    const targets = plans.filter(p => p.active && p.payment_plan_id)
    setChecks(Object.fromEntries(targets.map(p => [p.id, { status: 'loading', issues: [] }])))
    const cache = new Map()
    const read = id => {
      if (!id) return Promise.resolve(null)
      if (!cache.has(id)) cache.set(id, loadAbcPlanSummary(location.abc_club_number, id).catch(() => null))
      return cache.get(id)
    }
    await Promise.all(targets.map(async p => {
      const [cc, ach] = await Promise.all([read(p.payment_plan_id), read(p.payment_plan_id_ach)])
      const issues = abcIssues(p, { cc, ach }, prorated)
      if (!cc) issues.unshift("Couldn't read the card plan from ABC (deleted or wrong club?).")
      if (p.payment_plan_id_ach && !ach) issues.unshift("Couldn't read the bank plan from ABC.")
      setChecks(c => ({ ...c, [p.id]: { status: issues.length ? 'issues' : 'ok', issues } }))
    }))
    setChecking(false)
  }

  const checkedValues = Object.values(checks)
  const checkDone = checkedValues.length > 0 && checkedValues.every(c => c.status !== 'loading')
  const issueCount = checkedValues.filter(c => c.status === 'issues').length

  function addPlan(type, term) {
    const existing = (plansByType.get(type.id) || []).filter(p => p.term === term)
    const nextSize = type.allow_secondary_members
      ? (existing.length ? Math.max(...existing.map(p => p.max_members || 1)) + 1 : 3)
      : 1
    setEditingPlan({ plan: { wcs_location_id: club, membership_type_id: type.id, term, max_members: nextSize }, type })
  }

  return (
    <div className="space-y-4">
      {/* Club picker */}
      <div className="bg-surface border border-border rounded-xl p-2 flex flex-wrap gap-1">
        {locations.map(l => (
          <button key={l.wcs_location_id} onClick={() => setClub(l.wcs_location_id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${club === l.wcs_location_id ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}>
            {l.display_name}
          </button>
        ))}
      </div>

      {location && (
        <div className="bg-surface border border-border rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-text-primary">{location.display_name}</h2>
              <span className="text-[11px] text-text-muted">ABC club #{location.abc_club_number}</span>
              {prorated && <Chip tone="blue" title="ABC prorates the first month, so the real due-today is worked out at signup.">Prorated billing</Chip>}
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              {regular.length} membership{regular.length === 1 ? '' : 's'} on the join page · {promos.length} promo offer{promos.length === 1 ? '' : 's'}
              {checkDone && (issueCount ? <span className="text-amber-600"> · {issueCount === 1 ? "1 plan doesn't" : `${issueCount} plans don't`} match ABC</span> : <span className="text-green-600"> · everything matches ABC</span>)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {inactiveCount > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-text-muted mr-1">
                <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Show {inactiveCount} turned off
              </label>
            )}
            <a href={joinUrl(club)} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Open join page ↗</a>
            <button onClick={checkAbc} disabled={checking || !plans.length} className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-text-primary hover:border-wcs-red disabled:opacity-50">
              {checking ? 'Checking ABC…' : 'Check against ABC'}
            </button>
            <button onClick={() => setEditingType({ wcs_location_id: club, active: true, features: [] })} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold">
              + New membership
            </button>
          </div>
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}
      {loading && !types.length && <div className="bg-surface border border-border rounded-xl px-4 py-10 text-center text-sm text-text-muted">Loading…</div>}

      {!loading && visible.length === 0 && (
        <div className="bg-surface border border-border rounded-xl px-4 py-10 text-center text-sm text-text-muted">
          No memberships at {location?.display_name || 'this club'} yet. Click “+ New membership” to add the first one.
        </div>
      )}

      {regular.length > 0 && (
        <TypeGroup title="Memberships" sub="What everyone sees on the join page.">
          {regular.map(t => (
            <TypeCard key={t.id} type={t} plans={(plansByType.get(t.id) || []).filter(p => showInactive || p.active)} checks={checks} club={club}
              onEdit={() => setEditingType(t)} onEditPlan={p => setEditingPlan({ plan: p, type: t })} onAddPlan={term => addPlan(t, term)} />
          ))}
        </TypeGroup>
      )}

      {promos.length > 0 && (
        <TypeGroup title="Promo offers" sub="Hidden from the normal join page. Only people with the promo link see these.">
          {promos.map(t => (
            <TypeCard key={t.id} type={t} plans={(plansByType.get(t.id) || []).filter(p => showInactive || p.active)} checks={checks} club={club}
              onEdit={() => setEditingType(t)} onEditPlan={p => setEditingPlan({ plan: p, type: t })} onAddPlan={term => addPlan(t, term)} />
          ))}
        </TypeGroup>
      )}

      {loosePlans.length > 0 && (
        <div className="bg-surface border border-amber-300 rounded-xl px-4 py-3">
          <p className="text-sm font-semibold text-text-primary">{loosePlans.length} active plan{loosePlans.length === 1 ? '' : 's'} not attached to a membership</p>
          <p className="text-xs text-text-muted">These never show on the join page. Open one and pick its membership type, or turn it off.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {loosePlans.map(p => (
              <button key={p.id} onClick={() => setEditingPlan({ plan: p, type: null })} className="px-2 py-1 rounded-md bg-bg border border-border text-xs text-text-primary hover:border-wcs-red">{p.plan_label}</button>
            ))}
          </div>
        </div>
      )}

      {editingType && (
        <TypeEditor type={editingType} locations={locations} ageRules={ageRules} plans={plansByType.get(editingType.id) || []}
          onClose={() => setEditingType(null)} onSaved={() => { setEditingType(null); load() }} />
      )}
      {editingPlan && (
        <PlanEditor
          plan={editingPlan.plan}
          locations={locations}
          ageRules={ageRules}
          types={types}
          defaultTerm={editingPlan.plan.term}
          membershipTypeId={editingPlan.type?.id || undefined}
          onClose={() => setEditingPlan(null)}
          onSaved={() => { setEditingPlan(null); setChecks({}); load() }}
        />
      )}
    </div>
  )
}

function TypeGroup({ title, sub, children }) {
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        <p className="text-xs text-text-muted">{sub}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">{children}</div>
    </section>
  )
}

function Chip({ children, tone = 'muted', title }) {
  const tones = {
    muted: 'bg-bg border-border text-text-muted',
    red: 'bg-wcs-red/10 border-wcs-red/20 text-wcs-red',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    green: 'bg-green-50 border-green-200 text-green-700',
  }
  return <span title={title} className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>
}

function CopyButton({ text, label = 'Copy link' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})}
      className={`relative px-2 py-1 rounded-md border text-[11px] font-medium transition-colors ${copied ? 'bg-green-100 text-green-700 border-green-300' : 'border-border text-text-muted hover:text-text-primary'}`}
    >
      <span className={copied ? 'opacity-0' : ''}>{label}</span>
      {copied && <span className="absolute inset-0 flex items-center justify-center gap-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>Copied!
      </span>}
    </button>
  )
}

function TypeCard({ type, plans, checks, club, onEdit, onEditPlan, onAddPlan }) {
  const active = plans.filter(p => p.active)
  const promoLive = !type.promo_ends_at || Date.parse(type.promo_ends_at) > Date.now()
  const noPlans = active.length === 0
  return (
    <div className={`bg-surface border rounded-xl overflow-hidden flex flex-col ${type.active ? 'border-border' : 'border-dashed border-border opacity-70'}`}>
      <div className="px-4 pt-3 pb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h4 className="text-sm font-bold text-text-primary">{type.type_label}</h4>
            {!type.active && <Chip>Hidden</Chip>}
            {type.badge && <Chip tone="red">{type.badge}</Chip>}
            {type.allow_secondary_members && <Chip>Household</Chip>}
            {type.age_rule?.name && <Chip>{type.age_rule.name}</Chip>}
            {type.next_month_dues != null && <Chip tone="green" title="After joining, their next dues bill in ABC is set to this amount.">Next month {Number(type.next_month_dues) === 0 ? 'free' : fmtMoney(type.next_month_dues)}</Chip>}
            {noPlans && type.active && <Chip tone="amber">No plans, not showing</Chip>}
          </div>
          {type.promo_callout_enabled && type.promo_callout && (
            <div className="mt-1.5 inline-block bg-wcs-red text-white text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded">{type.promo_callout}</div>
          )}
        </div>
        <button onClick={onEdit} className="shrink-0 text-xs text-wcs-red hover:underline">Edit card</button>
      </div>

      {type.promo_code && (
        <div className="mx-4 mb-2.5 flex items-center gap-2 rounded-lg bg-bg border border-border px-2.5 py-1.5">
          <span className="text-[11px] text-text-muted shrink-0">Link</span>
          <span className="text-xs font-mono text-text-primary truncate">?promo={type.promo_code}</span>
          {!promoLive && <Chip tone="amber">Ended</Chip>}
          <span className="ml-auto flex gap-1.5 shrink-0">
            <a href={joinUrl(club, type.promo_code)} target="_blank" rel="noreferrer" className="px-2 py-1 rounded-md border border-border text-[11px] text-text-muted hover:text-text-primary">Preview ↗</a>
            <CopyButton text={`?promo=${type.promo_code}`} label="Copy" />
          </span>
        </div>
      )}

      <div className="border-t border-border divide-y divide-border mt-auto">
        {TERMS.map(([term, label]) => {
          const rows = plans.filter(p => p.term === term).sort((a, b) => (b.active - a.active) || ((a.max_members || 1) - (b.max_members || 1)))
          return (
            <div key={term} className="px-4 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">{label}</span>
                {(rows.length === 0 || type.allow_secondary_members) && (
                  <button onClick={() => onAddPlan(term)} className="text-[11px] text-wcs-red hover:underline">
                    + {rows.length === 0 ? `Add ${label} plan` : 'Add size'}
                  </button>
                )}
              </div>
              {rows.length === 0 && <p className="text-[11px] text-text-muted mt-0.5">Not offered</p>}
              {rows.map(p => <PlanRow key={p.id} plan={p} check={checks[p.id]} household={type.allow_secondary_members} onClick={() => onEditPlan(p)} />)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PlanRow({ plan, check, household, onClick }) {
  const hasAch = !!plan.payment_plan_id_ach
  const achToday = plan.today_amount_ach ?? plan.today_amount
  const achMonthly = plan.monthly_amount_ach ?? plan.monthly_amount
  return (
    <button onClick={onClick} className={`mt-1 w-full text-left rounded-lg px-2.5 py-1.5 border transition-colors hover:border-wcs-red ${plan.active ? 'border-transparent bg-bg' : 'border-dashed border-border opacity-60'}`}>
      <div className="flex items-center gap-3">
        <div className="flex-1 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Today</div>
            <div className="text-text-primary font-semibold tabular-nums">
              {fmtMoney(plan.today_amount)}{hasAch && Number(achToday) !== Number(plan.today_amount) ? <span className="text-text-muted font-normal"> / {fmtMoney(achToday)} bank</span> : null}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-text-muted">Monthly</div>
            <div className="text-text-primary font-semibold tabular-nums">
              {fmtMoney(plan.monthly_amount)}{hasAch && Number(achMonthly) !== Number(plan.monthly_amount) ? <span className="text-text-muted font-normal"> / {fmtMoney(achMonthly)} bank</span> : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {household && <Chip>{plan.max_members || 1} people</Chip>}
          {!plan.active && <Chip>Off</Chip>}
          {!hasAch && <Chip tone="amber" title="No bank (ACH) plan linked, so bank members pay the card price.">No bank plan</Chip>}
          <CheckDot check={check} />
        </div>
      </div>
      {check?.status === 'issues' && (
        <ul className="mt-1.5 text-[11px] text-amber-700 list-disc pl-4 space-y-0.5">
          {check.issues.map(i => <li key={i}>{i}</li>)}
        </ul>
      )}
    </button>
  )
}

function CheckDot({ check }) {
  if (!check) return null
  if (check.status === 'loading') return <span className="w-3 h-3 rounded-full border-2 border-border border-t-wcs-red animate-spin" />
  if (check.status === 'ok') return <span title="Matches ABC" className="text-green-600 text-xs font-bold">✓</span>
  return <span title="Doesn't match ABC" className="text-amber-600 text-xs font-bold">!</span>
}

// ---------------------------------------------------------------------------
// Type editor: the card's content on the left, a live preview on the right.
// ---------------------------------------------------------------------------
function TypeEditor({ type, locations, ageRules, plans, onClose, onSaved }) {
  const isNew = !type.id
  const [d, setD] = useState(() => ({
    wcs_location_id: type.wcs_location_id || '',
    type_key: type.type_key || '',
    type_label: type.type_label || '',
    description: type.description || '',
    features: Array.isArray(type.features) ? type.features : [],
    badge: type.badge || '',
    age_rule_id: type.age_rule_id || null,
    display_order: type.display_order ?? 0,
    promo_code: type.promo_code || '',
    promo_starts_at: toLocalInput(type.promo_starts_at),
    promo_ends_at: toLocalInput(type.promo_ends_at),
    promo_callout: type.promo_callout || '',
    promo_callout_enabled: !!type.promo_callout_enabled,
    next_month_dues: type.next_month_dues ?? null,
    allow_secondary_members: !!type.allow_secondary_members,
    active: type.active ?? true,
  }))
  const [isPromo, setIsPromo] = useState(!!type.promo_code)
  const [keyTouched, setKeyTouched] = useState(!isNew)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const location = locations.find(l => l.wcs_location_id === d.wcs_location_id)

  function set(k, v) { setD(x => ({ ...x, [k]: v })) }
  function setLabel(v) {
    setD(x => ({ ...x, type_label: v, type_key: keyTouched ? x.type_key : `${x.wcs_location_id}-${v}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))
  }

  const preview = useMemo(() => {
    const monthly = plans.filter(p => p.active).flatMap(p => [p.monthly_amount_ach, p.monthly_amount]).map(Number).filter(n => Number.isFinite(n) && n > 0)
    return monthly.length ? Math.min(...monthly) : null
  }, [plans])
  // Same rule as the join page: exact next-month dues, else "half"/"free" in the wording.
  const dealPrice = useMemo(() => {
    if (!isPromo || preview == null) return null
    if (d.next_month_dues != null && d.next_month_dues !== '') return Number(d.next_month_dues)
    const text = `${d.promo_code} ${d.promo_callout} ${d.type_label}`
    if (/half/i.test(text)) return Math.round(preview * 50) / 100
    if (/free/i.test(text)) return 0
    return null
  }, [isPromo, preview, d.next_month_dues, d.promo_code, d.promo_callout, d.type_label])

  async function save() {
    setSaving(true); setError(null)
    try {
      if (!d.type_label.trim()) throw new Error('Give the card a title.')
      if (isPromo && !d.promo_code.trim()) throw new Error('Promo offers need a link code.')
      const body = {
        wcs_location_id: d.wcs_location_id,
        type_key: d.type_key,
        type_label: d.type_label.trim(),
        description: d.description || null,
        features: d.features.filter(f => String(f).trim()),
        badge: d.badge || null,
        age_rule_id: d.age_rule_id || null,
        display_order: parseInt(d.display_order) || 0,
        promo_code: isPromo ? d.promo_code.trim() : null,
        promo_starts_at: isPromo ? toIso(d.promo_starts_at) : null,
        promo_ends_at: isPromo ? toIso(d.promo_ends_at) : null,
        promo_callout: (d.promo_callout || '').trim() || null,
        promo_callout_enabled: !!d.promo_callout_enabled && !!(d.promo_callout || '').trim(),
        next_month_dues: isPromo && d.next_month_dues != null && d.next_month_dues !== '' ? Math.max(0, Number(d.next_month_dues) || 0) : null,
        allow_secondary_members: !!d.allow_secondary_members,
        active: !!d.active,
      }
      if (isNew) await onlineJoin.createType(body)
      else {
        const { wcs_location_id, ...patch } = body
        await onlineJoin.updateType(type.id, patch)
      }
      onSaved()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{isNew ? 'New membership' : d.type_label || 'Membership'}</h3>
            <p className="text-xs text-text-muted">{location?.display_name}{isPromo ? ' · promo offer' : ''}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto grid grid-cols-1 md:grid-cols-[1fr_280px]">
          <div className="p-5 space-y-6 md:border-r border-border">
            {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

            <Block title="The card" sub="What people read when they pick a membership.">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
                <TextInput label="Title" value={d.type_label} onChange={setLabel} placeholder="Single Membership" />
                <TextInput label="Badge (optional)" value={d.badge} onChange={v => set('badge', v)} placeholder="Most Popular" />
              </div>
              <label className="block mt-3">
                <Lbl>Short description (optional)</Lbl>
                <textarea value={d.description} onChange={e => set('description', e.target.value)} rows={2} className={inputCls} placeholder="One line under the title." />
              </label>
              <div className="mt-3">
                <Lbl>What's included</Lbl>
                <FeaturesEditor value={d.features} onChange={v => set('features', v)} />
              </div>
            </Block>

            <Block title="Promo offer" sub="Promo cards are hidden from the normal join page and only show on a promo link.">
              <Toggle checked={isPromo} onChange={setIsPromo} label="This is a promo offer" />
              {isPromo && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <TextInput label="Link code" mono value={d.promo_code} onChange={v => set('promo_code', v.replace(/\s+/g, '').toLowerCase())} placeholder="halfoff" />
                    <label className="block"><Lbl>Starts (optional)</Lbl><input type="datetime-local" value={d.promo_starts_at} onChange={e => set('promo_starts_at', e.target.value)} className={inputCls} /></label>
                    <label className="block"><Lbl>Ends (optional)</Lbl><input type="datetime-local" value={d.promo_ends_at} onChange={e => set('promo_ends_at', e.target.value)} className={inputCls} /></label>
                  </div>
                  {d.promo_code && <p className="text-[11px] text-text-muted">Add <span className="font-mono text-text-primary">?promo={d.promo_code}</span> to the club's join page link to show this card.</p>}

                  <div className="rounded-lg border border-border bg-bg px-3 py-2.5">
                    <Toggle checked={d.next_month_dues != null} onChange={on => set('next_month_dues', on ? '0' : null)} label="Set their next month's dues in ABC" />
                    <p className="text-[11px] text-text-muted mt-1 ml-6">
                      Right after someone joins, their next dues bill in ABC is changed to this amount and a note goes on their profile.
                      Only turn this on if the ABC plan itself doesn't already discount that month.
                    </p>
                    {d.next_month_dues != null && (
                      <div className="mt-2 ml-6 max-w-[160px]">
                        <TextInput label="Next month's dues ($)" type="number" value={d.next_month_dues} onChange={v => set('next_month_dues', v)} hint="0 = free month" />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-3">
                <Toggle checked={d.promo_callout_enabled} onChange={v => set('promo_callout_enabled', v)} label="Red callout under the price" />
                {d.promo_callout_enabled && (
                  <div className="mt-2 ml-6">
                    <TextInput value={d.promo_callout} onChange={v => set('promo_callout', v)} placeholder="2ND MONTH HALF OFF" />
                  </div>
                )}
              </div>
            </Block>

            <Block title="Who can join">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <Lbl>Age rule</Lbl>
                  <select value={d.age_rule_id || ''} onChange={e => set('age_rule_id', e.target.value || null)} className={inputCls}>
                    <option value="">Anyone</option>
                    {ageRules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </label>
                <div className="pt-5">
                  <Toggle checked={d.allow_secondary_members} onChange={v => set('allow_secondary_members', v)} label="Household (adds family members)" />
                </div>
              </div>
            </Block>

            <div className="flex items-center justify-between border-t border-border pt-4">
              <Toggle checked={d.active} onChange={v => set('active', v)} label="Live on the join page" />
              <button onClick={() => setShowAdvanced(s => !s)} className="text-xs font-semibold text-text-muted hover:text-text-primary">{showAdvanced ? '▾' : '▸'} Advanced</button>
            </div>
            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextInput label="Type key" mono value={d.type_key} onChange={v => { setKeyTouched(true); set('type_key', v.toLowerCase().replace(/[^a-z0-9-]/g, '-')) }} />
                <TextInput label="Display order" type="number" value={d.display_order} onChange={v => set('display_order', v)} hint="Lower shows first." />
              </div>
            )}
          </div>

          {/* Live preview */}
          <div className="p-5 bg-bg/40 md:sticky md:top-0 md:self-start">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-2">Preview</p>
            <div className="rounded-lg overflow-hidden border border-black/10 bg-white text-[#16181d] shadow-sm">
              <div className="bg-[#16181d] text-white px-3 py-2.5 text-sm font-extrabold uppercase italic tracking-wide flex items-center gap-2">
                <span className="truncate">{d.type_label || 'Title'}</span>
                {isPromo && <span className="ml-auto text-[9px] not-italic bg-white text-[#ff0000] px-1.5 py-0.5 rounded">LIMITED TIME</span>}
              </div>
              <div className="px-3 py-3 text-center">
                {preview != null ? (
                  dealPrice != null && dealPrice < preview ? (
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-lg font-extrabold text-gray-400 line-through decoration-[#ff0000] decoration-2">{fmtMoney(preview)}</span>
                      <span className="text-4xl font-extrabold text-[#ff0000] leading-none">{fmtMoney(dealPrice)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl font-extrabold leading-none">{fmtMoney(preview)}</div>
                      <div className="text-[11px] font-semibold mt-1">Per Month</div>
                    </>
                  )
                ) : <div className="text-xs text-gray-400 py-3">Price shows once a plan is added</div>}
                {d.promo_callout_enabled && d.promo_callout && (
                  <div className="mt-2 inline-block bg-[#ff0000] text-white text-[11px] font-extrabold uppercase px-2.5 py-1 rounded">{d.promo_callout}</div>
                )}
                {d.description && <p className="mt-2 text-[11px] text-gray-600">{d.description}</p>}
              </div>
              {d.features.filter(f => String(f).trim()).length > 0 && (
                <ul className="px-3 pb-3 space-y-1">
                  {d.features.filter(f => String(f).trim()).map((f, i) => (
                    <li key={i} className="text-[11px] flex items-center gap-1.5 border-t border-black/5 pt-1"><span className="text-[#16181d]">✓</span>{f}</li>
                  ))}
                </ul>
              )}
              <div className="mx-3 mb-3 bg-[#ff0000] text-white text-center text-xs font-extrabold italic uppercase py-2 rounded">Select →</div>
            </div>
            <p className="text-[10px] text-text-muted mt-2">A rough preview. Open the join page from the club header for the real thing.</p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-border text-xs text-text-muted hover:text-text-primary">Cancel</button>
          <button onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold disabled:opacity-60">
            {saving ? 'Saving…' : (isNew ? 'Create membership' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Block({ title, sub, children }) {
  return (
    <section>
      <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      {sub && <p className="text-[11px] text-text-muted mt-0.5 mb-2.5">{sub}</p>}
      {!sub && <div className="mb-2.5" />}
      {children}
    </section>
  )
}
function Lbl({ children }) { return <span className="block text-xs font-medium text-text-muted mb-1">{children}</span> }
function TextInput({ label, value, onChange, placeholder, mono, type = 'text', hint }) {
  return (
    <label className="block">
      {label && <Lbl>{label}</Lbl>}
      <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${inputCls} ${mono ? 'font-mono' : ''}`} />
      {hint && <span className="block text-[10px] text-text-muted mt-0.5">{hint}</span>}
    </label>
  )
}
function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <span className={`relative w-8 h-[18px] rounded-full transition-colors ${checked ? 'bg-wcs-red' : 'bg-border'}`}>
        <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all ${checked ? 'left-[16px]' : 'left-[2px]'}`} />
      </span>
      <input type="checkbox" className="sr-only" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="text-sm text-text-primary">{label}</span>
    </label>
  )
}
