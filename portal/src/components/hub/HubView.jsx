import { useState } from 'react'
import TasksSection from './TasksSection'

// The owner's private Hub. Tasks is the first section; more sections
// (suggestions, alerts) slot into SECTIONS later.
const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const SECTIONS = [{ key: 'tasks', label: 'Tasks' }]

export default function HubView({ onBack }) {
  const [section, setSection] = useState('tasks')
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className={`${CARD} px-5 py-4 flex items-center justify-between gap-3 flex-wrap`}>
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Hub</h2>
            <p className="text-xs text-text-muted">Just for you</p>
          </div>
        </div>
        {SECTIONS.length > 1 && (
          <div className="flex items-center gap-1">
            {SECTIONS.map(s => (
              <button key={s.key} onClick={() => setSection(s.key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${section === s.key ? 'bg-wcs-red text-white' : 'text-text-muted hover:text-text-primary'}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {section === 'tasks' && <TasksSection />}
    </div>
  )
}
