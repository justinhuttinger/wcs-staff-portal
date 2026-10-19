import { useState } from 'react'
import MemberAppMembers from './memberapp/MemberAppMembers.jsx'
import MemberAppMemberPage from './memberapp/MemberAppMemberPage.jsx'
import TemplateLibrary from '../coaching/TemplateLibrary.jsx'

// Members (a list, then one member's page) and the program template library.
// Notifications used to live here as a fourth tab; it is its own Admin section
// now, because broadcasting to every phone is not a per-member action.
// Templates sit here until Coaching PR 3 gives them a Coaching tile.
export default function MemberAppAdmin() {
  const [open, setOpen] = useState(null)
  const [area, setArea] = useState('members')

  if (open) {
    return (
      <MemberAppMemberPage
        member={open}
        onChange={setOpen}
        onBack={() => setOpen(null)}
      />
    )
  }
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-border bg-surface overflow-hidden text-sm">
        {[['members', 'Members'], ['templates', 'Program templates']].map(([k, label]) => (
          <button
            key={k} onClick={() => setArea(k)}
            className={`px-4 py-2 font-semibold transition-colors ${area === k ? 'bg-wcs-red text-white' : 'hover:bg-bg text-text-primary'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {area === 'templates' ? <TemplateLibrary /> : <MemberAppMembers onOpen={setOpen} />}
    </div>
  )
}
