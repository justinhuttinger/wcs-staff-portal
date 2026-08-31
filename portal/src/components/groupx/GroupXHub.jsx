import { useState } from 'react'
import GroupXView from './GroupXView'
import GroupXAttendanceView from './GroupXAttendanceView'

// The Group X tile on the home board. Two jobs behind one tile, chosen from a
// card the way Shared Drive does it: the schedule (planning work, done ahead of
// time) and the attendance queue (worked through after the fact).
//
// Both cards are shown to everyone who has the tile. What changes with
// permission is what you can DO once inside -- front desk reads and prints the
// week, lead and above edit it and log headcounts. Hiding a card from someone
// who can still usefully read it would just make them ask someone else.
//
// Board links, the class-type badge list and the cross-club history report are
// all absent here on purpose: they are admin settings and live in
// Admin -> Group X, which is the only place they exist now.

const SCHEDULE_ICON = 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5'
const ATTENDANCE_ICON = 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z'

function HubCard({ iconPath, label, desc, onClick }) {
  return (
    <button onClick={onClick}
      className="rounded-[14px] bg-surface border border-border p-8 min-h-[160px] flex flex-col items-start text-left transition-transform hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-wcs-red mb-4">
        <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
      </svg>
      <span className="text-base font-bold text-text-primary">{label}</span>
      <span className="text-sm text-tile-sub mt-1">{desc}</span>
    </button>
  )
}

export default function GroupXHub({ onBack, canEdit = false, canRecord = false }) {
  const [section, setSection] = useState(null)

  if (section) {
    return (
      <div className="w-full max-w-[1400px] mx-auto px-8 pb-12">
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border px-4 py-2.5 mb-3 flex items-center gap-3">
          {/* NOT .redundant-back: this steps back to the hub's two cards, not
              out of Group X. The one Back leaves the view entirely, so hiding
              this would strand you inside the Scheduler with no way up. It was
              tagged when this screen was written, which is why Press had no way
              back to the cards either. */}
          <button onClick={() => setSection(null)}
            className="text-sm text-tile-sub hover:text-text-primary shrink-0">&larr; Group X</button>
          <span className="text-border" aria-hidden="true">|</span>
          <h2 className="text-sm font-bold text-text-primary">
            {section === 'schedule' ? 'Class Schedule' : 'Class Attendance'}
          </h2>
        </div>
        {section === 'schedule'
          ? <GroupXView canEdit={canEdit} />
          : <GroupXAttendanceView canRecord={canRecord} />}
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <button onClick={onBack} className="redundant-back text-sm text-tile-sub hover:text-text-primary">&larr; Back</button>
        <h2 className="text-lg font-bold text-text-primary mt-3">Group X</h2>
        <p className="text-sm text-tile-sub mt-1">The class schedule, and the headcount for each class that has run.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <HubCard iconPath={SCHEDULE_ICON} label="Scheduler"
          desc={canEdit ? 'Build and print the class week' : 'See and print the class week'}
          onClick={() => setSection('schedule')} />
        <HubCard iconPath={ATTENDANCE_ICON} label="Attendance"
          desc={canRecord ? 'Log who came to each class' : 'See how each class attended'}
          onClick={() => setSection('attendance')} />
      </div>
    </div>
  )
}
