import { useState } from 'react'
import MemberAppMembers from './memberapp/MemberAppMembers.jsx'
import MemberAppPrograms from './memberapp/MemberAppPrograms.jsx'
import MemberAppMessages from './memberapp/MemberAppMessages.jsx'
import MemberAppBroadcasts from './memberapp/MemberAppBroadcasts.jsx'

const TABS = [
  { key: 'members', label: 'Members', hint: 'Tier and coach' },
  { key: 'programs', label: 'Programs', hint: 'Write a training plan' },
  { key: 'messages', label: 'Messages', hint: 'Talk to members in the app' },
  { key: 'broadcasts', label: 'Notifications', hint: 'Send or schedule' },
]

export default function MemberAppAdmin() {
  const [tab, setTab] = useState('members')
  // Chosen in Members, then used by Programs and Messages so a coach does not
  // search for the same person three times.
  const [selected, setSelected] = useState(null)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={[
              'px-4 py-2 rounded-lg text-sm font-semibold border transition-colors',
              tab === t.key
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-primary border-border hover:border-text-muted',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {selected ? (
        <div className="flex items-center gap-3 text-sm bg-surface border border-border rounded-lg px-4 py-2">
          <span className="text-text-muted">Working with</span>
          <span className="font-semibold">{selected.first_name} {selected.last_name}</span>
          <span className="text-text-muted">
            {selected.tier === 'training' ? 'Training' : 'Basic'} &middot; club {selected.club_number}
          </span>
          <button onClick={() => setSelected(null)} className="ml-auto text-text-muted hover:text-text-primary">
            Clear
          </button>
        </div>
      ) : null}

      {tab === 'members' && <MemberAppMembers selected={selected} onSelect={setSelected} />}
      {tab === 'programs' && <MemberAppPrograms member={selected} onNeedMember={() => setTab('members')} />}
      {tab === 'messages' && <MemberAppMessages member={selected} onSelect={setSelected} />}
      {tab === 'broadcasts' && <MemberAppBroadcasts />}
    </div>
  )
}
