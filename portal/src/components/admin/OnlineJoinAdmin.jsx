import { useState } from 'react'
import OnlineJoinLocations from './OnlineJoinLocations'
import OnlineJoinCopy from './OnlineJoinCopy'

const TABS = [
  { key: 'locations', label: 'Locations', desc: 'Address, hours, hero copy per club' },
  { key: 'plans',     label: 'Plans',     desc: 'Per-location plans + ABC IDs (next session)' },
  { key: 'age-rules', label: 'Age Rules', desc: 'Named age ranges (next session)' },
  { key: 'copy',      label: 'Copy',      desc: 'Editable global strings' },
  { key: 'signups',   label: 'Signups',   desc: 'Read-only signup log (next session)' },
]

export default function OnlineJoinAdmin() {
  const [tab, setTab] = useState('locations')

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-xs text-yellow-800">
        <span className="font-semibold">Experimental — Online Join admin.</span> Phase 1-2 shipped (data layer + admin API). Phase 3 admin UI rolling out: Locations + Copy live now; Plans, Age Rules, Signups next.
      </div>

      {/* Tab bar */}
      <div className="bg-surface border border-border rounded-xl p-2 flex flex-wrap gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-wcs-red text-white'
                : 'bg-bg text-text-muted hover:text-text-primary'
            }`}
            title={t.desc}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      {tab === 'locations' && <OnlineJoinLocations />}
      {tab === 'copy' && <OnlineJoinCopy />}
      {tab === 'plans' && <ComingSoon label="Plans editor" detail="Per-location plans with the 'Pull from ABC' button. Next session." />}
      {tab === 'age-rules' && <ComingSoon label="Age Rules editor" detail="Named age ranges with live preview of ineligible messages. Next session." />}
      {tab === 'signups' && <ComingSoon label="Signups log" detail="Read-only paginated log filterable by location/status/date. Next session." />}
    </div>
  )
}

function ComingSoon({ label, detail }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-8 text-center text-sm text-text-muted">
      <p className="font-semibold text-text-primary mb-1">{label}</p>
      <p>{detail}</p>
    </div>
  )
}
