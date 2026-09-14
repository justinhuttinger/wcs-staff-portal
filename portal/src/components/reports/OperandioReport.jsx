import ComplianceReport from './ComplianceReport'
import TrainingReport from './TrainingReport'
import AuditsReport from './AuditsReport'

// ---------------------------------------------------------------------------
// Operandio — the two reports that come out of it, behind one tile.
//
// Compliance (are the jobs getting done) and Training (is everyone caught up)
// read the same system and get looked at in the same conversation, so they sit
// together rather than as two tiles with the same icon and different nouns.
//
// COMPLIANCE IS THE DEFAULT. It is the daily number; the others are checked
// when somebody asks about them. The switch does not remember a choice on
// purpose — opening the tile should always land on the same thing, so muscle
// memory works and nobody sees yesterday's tab and reads it as today's
// headline.
//
// Each view appears only for a role granted its own `report:` key. All three
// are seeded to manager and up, but the grid can take any of them away
// independently and the switch has to respect that — a tab that 403s is worse
// than no tab.
//
// THE VIEW IS OWNED BY ReportingView, not by this component. Audits is strictly
// per-club where Compliance and Training are not, so the location bar above has
// to know which view is showing in order to drop the All pill. State that only
// lived down here could not reach it.
// ---------------------------------------------------------------------------

export const OPERANDIO_VIEWS = [
  { key: 'compliance', label: 'Compliance', desc: 'Jobs: who, when and missed' },
  { key: 'training', label: 'Training', desc: 'Who is caught up' },
  { key: 'audits', label: 'Audits', desc: 'Scores by department' },
]

// Audits is scored per club and has no all-clubs view.
export const OPERANDIO_SINGLE_CLUB_VIEWS = ['audits']

export default function OperandioReport({
  locationSlug, view = 'compliance', onViewChange,
  canSeeTraining = false, canSeeAudits = false,
}) {
  const available = OPERANDIO_VIEWS.filter(v => {
    if (v.key === 'training') return canSeeTraining
    if (v.key === 'audits') return canSeeAudits
    return true
  })
  // Granted the tile but none of the extra halves: render Compliance with no
  // switch at all, rather than a single lonely button that does nothing.
  const active = available.some(v => v.key === view) ? view : 'compliance'
  const setView = key => onViewChange && onViewChange(key)

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
            {OPERANDIO_VIEWS.find(v => v.key === active)?.desc}
          </p>
        </div>
      )}

      {active === 'training' && <TrainingReport locationSlug={locationSlug} />}
      {active === 'audits' && <AuditsReport locationSlug={locationSlug} />}
      {active === 'compliance' && <ComplianceReport locationSlug={locationSlug} />}
    </div>
  )
}
