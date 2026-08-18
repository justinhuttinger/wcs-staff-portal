import { useEffect, useState } from 'react'
import { nps as npsApi } from '../../lib/api'
import QuestionEditor from './QuestionEditor'
import SurveyQrPanel from './SurveyQrPanel'
import TestFirePanel from './TestFirePanel'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'
const labelClass = 'block text-xs font-semibold text-text-muted mb-1'

const TRIGGERS = [
  { value: 'tenure_days', label: 'Days after joining' },
  { value: 'tenure_months', label: 'Months after joining' },
  { value: 'status_change', label: 'When status changes' },
  { value: 'walkup', label: 'Poster only (no email)' },
]

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
]

function newQuestionId() {
  return `q_${Math.random().toString(36).slice(2, 8)}`
}

export default function SurveyBuilder({ surveyId, onBack }) {
  const [survey, setSurvey] = useState(null)
  const [qr, setQr] = useState([])
  const [metrics, setMetrics] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)

  async function load() {
    try {
      const [res, m] = await Promise.all([npsApi.getSurvey(surveyId), npsApi.listMetrics()])
      setSurvey(res.survey)
      setQr(res.qr || [])
      setMetrics(m.metrics || [])
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { load() }, [surveyId])

  function patch(changes) {
    setSurvey(s => ({ ...s, ...changes }))
  }

  function patchQuestion(index, changes) {
    setSurvey(s => {
      const schema = [...(s.schema || [])]
      schema[index] = { ...schema[index], ...changes }
      return { ...s, schema }
    })
  }

  function addQuestion() {
    setSurvey(s => ({
      ...s,
      schema: [...(s.schema || []), { id: newQuestionId(), type: 'rating', label: '', min: 1, max: 10, required: true }],
    }))
  }

  function removeQuestion(index) {
    setSurvey(s => ({ ...s, schema: (s.schema || []).filter((_, i) => i !== index) }))
  }

  function move(index, delta) {
    setSurvey(s => {
      const schema = [...(s.schema || [])]
      const target = index + delta
      if (target < 0 || target >= schema.length) return s
      const [item] = schema.splice(index, 1)
      schema.splice(target, 0, item)
      return { ...s, schema }
    })
  }

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const res = await npsApi.updateSurvey(survey.id, {
        known_updated_at: survey.updated_at,
        title: survey.title,
        slug: survey.slug,
        intro: survey.intro,
        schema: survey.schema || [],
        status: survey.status,
        trigger_type: survey.trigger_type,
        trigger_value: survey.trigger_value,
        trigger_status: survey.trigger_status,
        send_window_days: survey.send_window_days,
        resend_cooldown_days: survey.resend_cooldown_days,
        expires_days: survey.expires_days,
        ghl_tag: survey.ghl_tag,
        ghl_field_key: survey.ghl_field_key,
      })
      setSurvey(res.survey)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (error && !survey) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 w-full">
        <div className="bg-surface rounded-xl border border-border p-5 space-y-3">
          <button onClick={onBack} className="text-sm text-wcs-red hover:underline">Back</button>
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      </div>
    )
  }
  if (!survey) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-6 w-full">
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-text-muted">Loading…</p>
        </div>
      </div>
    )
  }

  const isTenure = survey.trigger_type === 'tenure_days' || survey.trigger_type === 'tenure_months'
  const isWalkup = survey.trigger_type === 'walkup'

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4 w-full">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-primary truncate">{survey.title || 'Untitled survey'}</h2>
            <p className="text-xs text-text-muted font-mono truncate">/{survey.slug}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {savedAt && <span className="text-xs font-semibold text-wcs-red animate-pulse">Saved</span>}
            <button
              onClick={onBack}
              className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded-lg hover:bg-bg transition-colors"
            >
              Back
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {/* Details */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <h3 className="text-sm font-bold text-text-primary">Details</h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Name</label>
            <input value={survey.title || ''} onChange={e => patch({ title: e.target.value })} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Status</label>
            <select value={survey.status} onChange={e => patch({ status: e.target.value })} className={inputClass}>
              {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>Web address</label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted shrink-0">survey.westcoaststrength.com/</span>
            <input value={survey.slug || ''} onChange={e => patch({ slug: e.target.value })} className={inputClass} />
          </div>
          <p className="text-[11px] text-text-muted mt-1">
            Members see this. Keep it short. Changing it breaks any link or poster already out there.
          </p>
        </div>

        <div>
          <label className={labelClass}>Intro (optional)</label>
          <textarea value={survey.intro || ''} rows={2} onChange={e => patch({ intro: e.target.value })} className={inputClass} />
        </div>
      </div>

      {/* Trigger */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Who gets it</h3>
          <p className="text-xs text-text-muted mt-0.5">Checked nightly at 7am.</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Trigger</label>
            <select value={survey.trigger_type} onChange={e => patch({ trigger_type: e.target.value })} className={inputClass}>
              {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          {isTenure && (
            <div>
              <label className={labelClass}>
                {survey.trigger_type === 'tenure_days' ? 'How many days' : 'How many months'}
              </label>
              <input
                type="number" value={survey.trigger_value ?? ''}
                onChange={e => patch({ trigger_value: e.target.value === '' ? null : Number(e.target.value) })}
                className={inputClass}
              />
            </div>
          )}

          {survey.trigger_type === 'status_change' && (
            <div>
              <label className={labelClass}>Status to watch for</label>
              <input
                value={survey.trigger_status || ''}
                onChange={e => patch({ trigger_status: e.target.value })}
                placeholder="Cancelled"
                className={inputClass}
              />
            </div>
          )}
        </div>

        {isWalkup && (
          <p className="text-xs text-text-muted">
            Poster-only surveys are never emailed. People reach them by scanning a code in the gym.
          </p>
        )}

        {!isWalkup && (
          <div className="grid sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Catch-up window (days)</label>
              <input type="number" value={survey.send_window_days ?? 3}
                onChange={e => patch({ send_window_days: Number(e.target.value) })} className={inputClass} />
              <p className="text-[11px] text-text-muted mt-1">Covers a missed night.</p>
            </div>
            <div>
              <label className={labelClass}>Leave alone for (days)</label>
              <input type="number" value={survey.resend_cooldown_days ?? 60}
                onChange={e => patch({ resend_cooldown_days: Number(e.target.value) })} className={inputClass} />
              <p className="text-[11px] text-text-muted mt-1">Across every survey, not just this one.</p>
            </div>
            <div>
              <label className={labelClass}>Link expires after (days)</label>
              <input type="number" value={survey.expires_days ?? 30}
                onChange={e => patch({ expires_days: Number(e.target.value) })} className={inputClass} />
            </div>
          </div>
        )}
      </div>

      {/* Questions */}
      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary">Questions</h3>
          <button
            type="button" onClick={addQuestion}
            className="px-3 py-1.5 text-xs font-medium text-text-primary border border-border rounded-lg hover:bg-bg transition-colors"
          >
            Add question
          </button>
        </div>

        {(survey.schema || []).length === 0 && (
          <p className="text-xs text-text-muted">No questions yet. Add one to get started.</p>
        )}

        <div className="space-y-3">
          {(survey.schema || []).map((q, i) => (
            <QuestionEditor
              key={q.id}
              question={q}
              index={i}
              total={survey.schema.length}
              metrics={metrics}
              onChange={changes => patchQuestion(i, changes)}
              onRemove={() => removeQuestion(i)}
              onMove={delta => move(i, delta)}
            />
          ))}
        </div>
      </div>

      {/* GHL */}
      {!isWalkup && (
        <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-text-primary">Sending</h3>
            <p className="text-xs text-text-muted mt-0.5">
              The tag fires your GHL workflow. The field carries the member's link.
              Set both or neither: a tag with no field sends an email with a dead link.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>GHL tag</label>
              <input value={survey.ghl_tag || ''} onChange={e => patch({ ghl_tag: e.target.value })}
                placeholder="nps-6mo" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>GHL field key</label>
              <input value={survey.ghl_field_key || ''} onChange={e => patch({ ghl_field_key: e.target.value })}
                placeholder="contact.nps_survey_url" className={inputClass} />
            </div>
          </div>
        </div>
      )}

      {!isWalkup && <TestFirePanel survey={survey} />}

      {isWalkup && <SurveyQrPanel survey={survey} qr={qr} onChanged={load} />}
    </div>
  )
}
