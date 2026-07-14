import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { lapsedCheckins } from '../../lib/api'

const TIERS = [
  { key: 10, label: '10+ days' },
  { key: 21, label: '21+ days' },
  { key: 30, label: '30+ days' },
]

function fmtDate(text) {
  if (!text) return '—'
  const d = new Date(text)
  if (Number.isNaN(d.getTime())) return text
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Drill-down modal — createPortal to body so it isn't trapped under the
// z-50 tab bar on mobile (per the portal's modal convention).
function DrilldownModal({ club, clubName, tier, onClose }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    lapsedCheckins.getDrilldown(club, tier)
      .then(res => { if (!cancelled) setMembers(res?.members || []) })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load members') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [club, tier])

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl border border-border shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{clubName || club}</h3>
            <p className="text-xs text-text-muted">{tier}+ days lapsed</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-text-muted text-center py-6">Loading...</p>
          ) : error ? (
            <p className="text-sm text-red-500 text-center py-6">{error}</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">No members in this tier.</p>
          ) : (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="grid grid-cols-[2fr_1.5fr_auto_1fr] gap-2 px-4 py-2 text-[11px] font-semibold text-text-muted uppercase tracking-wide bg-bg border-b border-border">
                <span>Name</span>
                <span>Membership Type</span>
                <span>Days</span>
                <span>Last Check-In</span>
              </div>
              {members.map(m => (
                <div
                  key={m.member_id}
                  className="grid grid-cols-[2fr_1.5fr_auto_1fr] gap-2 px-4 py-2 text-sm border-b border-border last:border-0 items-center"
                >
                  <span className="text-text-primary font-medium truncate">{m.name}</span>
                  <span className="text-text-muted truncate">{m.membership_type}</span>
                  <span className="text-text-muted">{m.days_since}</span>
                  <span className="text-text-muted">{fmtDate(m.last_check_in)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ExclusionsTab() {
  const [types, setTypes] = useState([])
  const [excluded, setExcluded] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    lapsedCheckins.getTypes()
      .then(res => {
        const list = res?.types || []
        setTypes(list)
        setExcluded(new Set(list.filter(t => t.excluded).map(t => t.membership_type)))
      })
      .catch(err => setError(err.message || 'Failed to load membership types'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(type) {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
    setMessage(null)
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await lapsedCheckins.saveTypes([...excluded])
      setMessage({ type: 'success', text: 'Saved!' })
    } catch (err) {
      if (err.unknown && err.unknown.length) {
        setMessage({ type: 'error', text: `Unknown membership types: ${err.unknown.join(', ')}` })
      } else {
        setMessage({ type: 'error', text: err.message || 'Save failed' })
      }
    }
    setSaving(false)
  }

  const sorted = [...types].sort((a, b) => (b.active_members || 0) - (a.active_members || 0))

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Excluded Membership Types</h3>
          <p className="text-xs text-text-muted mt-1">
            Checked types are excluded from lapsed check-in tagging (staff, corporate, event access, etc. never get win-back tags).
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-2 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          {message && (
            <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {message.text}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted text-center py-6">Loading...</p>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-6">{error}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-6">No membership types found.</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2 text-[11px] font-semibold text-text-muted uppercase tracking-wide bg-bg border-b border-border">
            <span>Excluded</span>
            <span>Membership Type</span>
            <span>Active Members</span>
          </div>
          {sorted.map(t => (
            <label
              key={t.membership_type}
              className="grid grid-cols-[auto_1fr_auto] gap-3 px-4 py-2 text-sm border-b border-border last:border-0 items-center cursor-pointer hover:bg-bg"
            >
              <input
                type="checkbox"
                checked={excluded.has(t.membership_type)}
                onChange={() => toggle(t.membership_type)}
                className="h-4 w-4 rounded border-border text-wcs-red focus:ring-wcs-red/30"
              />
              <span className="text-text-primary font-medium truncate">{t.membership_type}</span>
              <span className="text-text-muted">{t.active_members}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function AtRiskTab() {
  const [clubs, setClubs] = useState([])
  const [generatedAt, setGeneratedAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [drilldown, setDrilldown] = useState(null) // { club, clubName, tier }

  useEffect(() => {
    setLoading(true)
    setError(null)
    lapsedCheckins.getDashboard()
      .then(res => {
        setClubs(res?.clubs || [])
        setGeneratedAt(res?.generated_at || null)
      })
      .catch(err => setError(err.message || 'Failed to load dashboard'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">At-Risk Members</h3>
          <p className="text-xs text-text-muted mt-1">
            Active members by days since last check-in (or join date if never checked in). Click a count to see the members.
          </p>
        </div>
        {generatedAt && (
          <span className="text-[11px] text-text-muted shrink-0">Generated {fmtDate(generatedAt)}</span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-text-muted text-center py-6">Loading...</p>
      ) : error ? (
        <p className="text-sm text-red-500 text-center py-6">{error}</p>
      ) : clubs.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-6">No club data available.</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-[11px] font-semibold text-text-muted uppercase tracking-wide bg-bg border-b border-border">
            <span>Club</span>
            {TIERS.map(t => <span key={t.key} className="text-right">{t.label}</span>)}
          </div>
          {clubs.map(c => (
            <div
              key={c.club}
              className="grid grid-cols-[1.5fr_1fr_1fr_1fr] gap-2 px-4 py-2 text-sm border-b border-border last:border-0 items-center"
            >
              <span className="text-text-primary font-medium truncate">{c.name || c.club}</span>
              {TIERS.map(t => {
                const count = c[`tier${t.key}`] || 0
                return (
                  <span key={t.key} className="text-right">
                    <button
                      onClick={() => count > 0 && setDrilldown({ club: c.club, clubName: c.name, tier: t.key })}
                      disabled={count === 0}
                      className={`text-sm font-semibold tabular-nums ${count > 0 ? 'text-wcs-red hover:underline cursor-pointer' : 'text-text-muted'}`}
                    >
                      {count}
                    </button>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {drilldown && (
        <DrilldownModal
          club={drilldown.club}
          clubName={drilldown.clubName}
          tier={drilldown.tier}
          onClose={() => setDrilldown(null)}
        />
      )}
    </div>
  )
}

export default function LapsedCheckins() {
  const [tab, setTab] = useState('exclusions')

  return (
    <div className="space-y-6">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-2 flex gap-2">
        <button
          onClick={() => setTab('exclusions')}
          className={`flex-1 text-sm font-medium rounded-lg px-4 py-2 transition-colors ${
            tab === 'exclusions' ? 'bg-wcs-red text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg'
          }`}
        >
          Exclusions
        </button>
        <button
          onClick={() => setTab('at-risk')}
          className={`flex-1 text-sm font-medium rounded-lg px-4 py-2 transition-colors ${
            tab === 'at-risk' ? 'bg-wcs-red text-white' : 'text-text-muted hover:text-text-primary hover:bg-bg'
          }`}
        >
          At-Risk
        </button>
      </div>

      {tab === 'exclusions' ? <ExclusionsTab /> : <AtRiskTab />}
    </div>
  )
}
