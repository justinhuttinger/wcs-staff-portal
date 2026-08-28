import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'

// ---------------------------------------------------------------------------
// Admin > Problem Thresholds
//
// What counts as a problem, for the Analytics > Problem Areas report.
//
// The keys MUST match CHECKS in auth/src/lib/problemAreas.js. A key invented
// here is silently ignored there and the threshold appears to save while
// changing nothing — the same failure that shipped three blank stats on the
// Membership Snapshot before the keys were pinned to the builder.
// ---------------------------------------------------------------------------

const FIELDS = [
  {
    key: 'problem_dayone_book_pct',
    label: 'Day One Booking %',
    hint: 'Flag a club below this share of new members booked into a Day One.',
    placeholder: '40',
    suffix: '%',
  },
  {
    key: 'problem_vip_pct',
    label: 'VIP Collection %',
    hint: 'Flag a club below this share of new members with a VIP collected.',
    placeholder: '40',
    suffix: '%',
  },
  {
    key: 'problem_dayone_close_pct',
    label: 'Day One Close %',
    hint: 'Flag a club below this share of completed Day Ones that sold.',
    placeholder: '30',
    suffix: '%',
  },
  {
    key: 'problem_dayone_open_forms',
    label: 'Day One Forms Left Open',
    hint: 'Flag a club with more than this many Day Ones past their date and no outcome recorded. Counted across all time, not just the window — a form left open in March is still open.',
    placeholder: '10',
    suffix: 'forms',
  },
  {
    key: 'problem_ops_job_pct',
    label: 'Job Completion Standard %',
    hint: 'A single Operandio job counts as done at or above this. Anything below is flagged and attributed to whoever worked it; a job nobody started has no owner to name, so it is reported against the club.',
    placeholder: '75',
    suffix: '%',
  },
  {
    key: 'problem_ops_jobs_below',
    label: 'Jobs Below Standard Tolerated',
    hint: 'Flag once a club or person has more than this many below-standard jobs. Zero means any below-standard job is worth seeing.',
    placeholder: '0',
    suffix: 'jobs',
  },
]

export default function ProblemThresholdsAdmin() {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getAppSettings('problem_')
      .then(map => setSettings(map || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function set(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings(settings)
      setMessage({ type: 'success', text: 'Saved!' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    }
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-text-muted p-4">Loading...</p>

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Problem Thresholds</h3>
          <p className="text-xs text-text-muted mt-1">
            What counts as a problem in Analytics &rsaquo; Problem Areas. Leave a
            field blank to use its built-in default. A check stays silent where there is too
            little to judge on — four new members, or four completed Day Ones — so
            a quiet week is never reported as a failure.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && (
            <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
              {message.text}
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-wcs-red text-white disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      <ul className="space-y-4">
        {FIELDS.map(f => {
          const off = settings[`${f.key}_off`] === '1'
          return (
            <li key={f.key} className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-text-primary">{f.label}</p>
                <p className="text-[11px] text-text-muted mt-0.5">{f.hint}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <label className="flex items-center gap-1.5">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={settings[f.key] ?? ''}
                    placeholder={f.placeholder}
                    onChange={e => set(f.key, e.target.value)}
                    disabled={off}
                    className="w-24 bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary tabular-nums disabled:opacity-40"
                  />
                  <span className="text-[11px] text-text-muted w-10">{f.suffix}</span>
                </label>
                {/* Off means the check never fires. It is NOT the same as a
                    threshold of zero, which would fire on everything. */}
                <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <input
                    type="checkbox"
                    checked={off}
                    onChange={e => set(`${f.key}_off`, e.target.checked ? '1' : '')}
                  />
                  Off
                </label>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
