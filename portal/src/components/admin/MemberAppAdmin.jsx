import { useState } from 'react'
import MemberAppMembers from './memberapp/MemberAppMembers.jsx'
import MemberAppMemberPage from './memberapp/MemberAppMemberPage.jsx'

// Members (a list, then one member's page). Programs and the template library
// live in the Coaching tile now; a member's page links across to it.
// Notifications are their own Admin section, because broadcasting to every
// phone is not a per-member action.
export default function MemberAppAdmin() {
  const [open, setOpen] = useState(null)

  if (open) {
    return (
      <MemberAppMemberPage
        member={open}
        onChange={setOpen}
        onBack={() => setOpen(null)}
      />
    )
  }
  return <MemberAppMembers onOpen={setOpen} />
}
