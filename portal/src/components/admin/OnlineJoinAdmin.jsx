import { useState } from 'react'
import OnlineJoinLocations from './OnlineJoinLocations'
import OnlineJoinTypes from './OnlineJoinTypes'
import OnlineJoinPlans from './OnlineJoinPlans'
import OnlineJoinAgeRules from './OnlineJoinAgeRules'
import OnlineJoinCopy from './OnlineJoinCopy'
import OnlineJoinSignups from './OnlineJoinSignups'
import OnlineJoinPreview from './OnlineJoinPreview'

const TABS = [
  { key: 'preview',   label: 'Preview',   desc: 'Live widget preview — pick a location and walk the flow' },
  { key: 'locations', label: 'Locations', desc: 'Address, hours, hero copy per club' },
  { key: 'types',     label: 'Membership Types', desc: 'Membership types: amenities, badge, age rule, promo + child plans' },
  { key: 'plans',     label: 'Plans',     desc: 'Per-location plans + ABC IDs (with Pull-from-ABC picker)' },
  { key: 'age-rules', label: 'Age Rules', desc: 'Named age ranges with live preview' },
  { key: 'copy',      label: 'Copy',      desc: 'Editable global strings' },
  { key: 'signups',   label: 'Signups',   desc: 'Read-only signup log + error trail' },
]

export default function OnlineJoinAdmin() {
  const [tab, setTab] = useState('preview')

  return (
    <div className="space-y-4">
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-xs text-yellow-800">
        <span className="font-semibold">Experimental — Online Join admin.</span> Full admin panel live. Backend writes (/start, /submit) shipped — waiting on ABC PayPage ID to flip to production.
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
      {tab === 'preview' && <OnlineJoinPreview />}
      {tab === 'locations' && <OnlineJoinLocations />}
      {tab === 'types' && <OnlineJoinTypes />}
      {tab === 'plans' && <OnlineJoinPlans />}
      {tab === 'age-rules' && <OnlineJoinAgeRules />}
      {tab === 'copy' && <OnlineJoinCopy />}
      {tab === 'signups' && <OnlineJoinSignups />}
    </div>
  )
}
