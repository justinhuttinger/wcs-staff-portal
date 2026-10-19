import { useState } from 'react'
import { roleAtLeast } from '../../lib/roles'
import CoachDashboard from './CoachDashboard.jsx'
import ClientsList from './ClientsList.jsx'
import ClientProfile from './ClientProfile.jsx'
import TemplateLibrary from './TemplateLibrary.jsx'
import ExerciseLibrary from './ExerciseLibrary.jsx'
import AddClientDialog from './AddClientDialog.jsx'

// The Coaching tile: Kahunas's coach side in the portal's own look. A left
// nav on desktop, tabs across the top on a phone. Trainers see their own
// clients, managers their clubs, corporate and admin everyone (the API
// enforces it; this only renders what it gets back).
const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', d: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z' },
  { key: 'clients', label: 'Clients', d: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { key: 'programs', label: 'Programs', d: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z' },
  { key: 'exercises', label: 'Exercises', d: 'M3.75 13.5h2.25V9.75H3.75v3.75Zm14.25 0h2.25V9.75H18v3.75ZM6 15.75h1.5v-7.5H6v7.5Zm10.5 0H18v-7.5h-1.5v7.5ZM7.5 12.75h9v-1.5h-9v1.5Z' },
]

export default function CoachingApp({ user, onBack, initialClient = null }) {
  const role = user?.staff?.role
  const me = { id: user?.staff?.id, email: user?.staff?.email, role, isManager: roleAtLeast(role, 'manager') }
  const [section, setSection] = useState('dashboard')
  const [client, setClient] = useState(initialClient ? { member: initialClient, tab: 'dashboard' } : null) // { member, tab }
  const [adding, setAdding] = useState(false)
  const [newProgram, setNewProgram] = useState(0) // bump to open a blank template
  const [refresh, setRefresh] = useState(0)

  const go = (key) => { setClient(null); setSection(key) }
  const openClient = (member, tab = 'dashboard') => setClient({ member, tab })

  let body
  if (client) {
    body = (
      <ClientProfile
        key={`${client.member.member_id}|${client.member.club_number}|${client.tab}`}
        member={client.member}
        initialTab={client.tab}
        me={me}
        onBack={() => { setClient(null); setRefresh(n => n + 1) }}
      />
    )
  } else if (section === 'clients') {
    body = <ClientsList key={refresh} me={me} onOpen={openClient} onAdd={() => setAdding(true)} />
  } else if (section === 'programs') {
    body = <TemplateLibrary key={newProgram} isManager={me.isManager} startNew={newProgram > 0} />
  } else if (section === 'exercises') {
    body = <ExerciseLibrary me={me} />
  } else {
    body = (
      <CoachDashboard
        key={refresh}
        me={me}
        onOpen={openClient}
        onAdd={() => setAdding(true)}
        onNewProgram={() => { setSection('programs'); setNewProgram(n => n + 1) }}
        onClients={() => go('clients')}
      />
    )
  }

  const active = client ? 'clients' : section

  return (
    <div className="w-full max-w-[1400px] mx-auto px-3 sm:px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border px-4 py-2.5 mb-3 flex items-center gap-3">
        {onBack ? (
          <>
            <button onClick={onBack} className="redundant-back text-sm text-tile-sub hover:text-text-primary shrink-0">&larr; Back</button>
            <span className="text-border" aria-hidden="true">|</span>
          </>
        ) : null}
        <h2 className="text-sm font-bold text-text-primary">Coaching</h2>
        <span className="hidden sm:inline text-xs text-text-muted">
          {me.isManager ? (roleAtLeast(role, 'corporate') ? 'Every club' : 'Your clubs') : 'Your clients'}
        </span>
        <button onClick={() => setAdding(true)} className="ml-auto px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red-hover">
          + Add client
        </button>
      </div>

      {/* Phone: tabs across the top. */}
      <nav className="lg:hidden mb-3 bg-surface border border-border rounded-xl p-1 grid grid-cols-4 gap-1" aria-label="Coaching">
        {SECTIONS.map(s => (
          <button
            key={s.key} onClick={() => go(s.key)}
            className={`py-2 rounded-lg text-xs font-semibold ${active === s.key ? 'bg-wcs-red text-white' : 'text-text-primary hover:bg-bg'}`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-4">
        {/* Desktop: a left nav card. */}
        <nav className="hidden lg:block self-start sticky top-3 bg-surface border border-border rounded-xl p-2" aria-label="Coaching">
          {SECTIONS.map(s => (
            <button
              key={s.key} onClick={() => go(s.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-semibold text-left ${active === s.key ? 'bg-wcs-red text-white' : 'text-text-primary hover:bg-bg'}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-5 h-5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d={s.d} /></svg>
              {s.label}
            </button>
          ))}
        </nav>
        <main className="min-w-0">{body}</main>
      </div>

      {adding ? (
        <AddClientDialog
          me={me}
          onClose={() => setAdding(false)}
          onAdded={(member, result) => {
            setAdding(false)
            openClient(member, result?.program ? 'workout' : 'dashboard')
          }}
        />
      ) : null}
    </div>
  )
}
