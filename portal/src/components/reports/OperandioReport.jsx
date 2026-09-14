import { useState } from 'react'
import ComplianceReport from './ComplianceReport'
import TrainingReport from './TrainingReport'

// ---------------------------------------------------------------------------
// Operandio — the two reports that come out of it, behind one tile.
//
// Compliance (are the jobs getting done) and Training (is everyone caught up)
// read the same system and get looked at in the same conversation, so they sit
// together rather than as two tiles with the same icon and different nouns.
//
// COMPLIANCE IS THE DEFAULT. It is the daily number; Training is checked when
// somebody asks about it. The switch does not remember a choice on purpose —
// opening the tile should always land on the same thing, so muscle memory works
// and nobody sees yesterday's tab and reads it as today's headline.
//
// The Training half appears only for a role granted `report:training`. Both are
// seeded to manager and up, but the grid can take either away independently and
// the switch has to respect that — a tab that 403s is worse than no tab.
// ---------------------------------------------------------------------------

const VIEWS = [
  { key: 'compliance', label: 'Compliance', desc: 'Jobs: who, when and missed' },
  { key: 'training', label: 'Training', desc: 'Who is caught up' },
]

export default function OperandioReport({ locationSlug, canSeeTraining = false }) {
  const [view, setView] = useState('compliance')

  const available = VIEWS.filter(v => v.key !== 'training' || canSeeTraining)
  // Granted the tile but not the Training half: render Compliance with no
  // switch at all, rather than a single lonely button that does nothing.
  const active = available.some(v => v.key === view) ? view : 'compliance'

  return (
    <div className="space-y-4">
      {available.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div
            className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-bg border border-border"
            role="tablist"
            aria-label="Operandio report"
          >
            {available.map(v => (
              <button
                key={v.key}
                role="tab"
                id={`operandio-tab-${v.key}`}
                aria-selected={active === v.key}
                onClick={() => setView(v.key)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                  active === v.key
                    ? 'bg-surface text-text-primary shadow-sm'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-text-muted">
            {VIEWS.find(v => v.key === active)?.desc}
          </p>
        </div>
      )}

      {active === 'training'
        ? <TrainingReport locationSlug={locationSlug} />
        : <ComplianceReport locationSlug={locationSlug} />}
    </div>
  )
}
