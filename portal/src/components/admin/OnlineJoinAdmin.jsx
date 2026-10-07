import { useState } from 'react'
import OnlineJoinLocations from './OnlineJoinLocations'
import OnlineJoinTypes from './OnlineJoinTypes'
import OnlineJoinPlans from './OnlineJoinPlans'
import OnlineJoinAgeRules from './OnlineJoinAgeRules'
import OnlineJoinCopy from './OnlineJoinCopy'
import OnlineJoinSignups from './OnlineJoinSignups'
import OnlineJoinPromoDues from './OnlineJoinPromoDues'
import OnlineJoinPreview from './OnlineJoinPreview'

const TABS = [
  { key: 'types',     label: 'Memberships', desc: 'Per club: membership cards, their 1-Year / Month-to-Month plans, promo links, and an ABC check' },
  { key: 'preview',   label: 'Preview',   desc: 'Live widget preview — pick a location and walk the flow' },
  { key: 'locations', label: 'Locations', desc: 'Address, hours, hero copy per club' },
  { key: 'plans',     label: 'All Plans', desc: 'Every plan in one list (edit opens the same ABC-linked editor)' },
  { key: 'age-rules', label: 'Age Rules', desc: 'Named age ranges with live preview' },
  { key: 'copy',      label: 'Copy',      desc: 'Editable global strings' },
  { key: 'signups',   label: 'Signups',   desc: 'Read-only signup log + error trail' },
  { key: 'promo-dues', label: 'Promo Dues', desc: "Promo types: next month's dues set in ABC (free or $X) + profile notes" },
]

export default function OnlineJoinAdmin() {
  const [tab, setTab] = useState('types')

  return (
    <div className="space-y-4">
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
      {tab === 'promo-dues' && <OnlineJoinPromoDues />}
    </div>
  )
}
