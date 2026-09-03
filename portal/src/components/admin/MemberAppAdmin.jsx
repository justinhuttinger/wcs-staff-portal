import { useState } from 'react'
import MemberAppMembers from './memberapp/MemberAppMembers.jsx'
import MemberAppMemberPage from './memberapp/MemberAppMemberPage.jsx'

// Two screens, not a tab bar: a list of members, and one member's page.
// Notifications used to live here as a fourth tab; it is its own Admin section
// now, because broadcasting to every phone is not a per-member action.
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
