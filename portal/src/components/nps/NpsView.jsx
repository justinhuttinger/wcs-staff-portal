import { useEffect, useState } from 'react'
import { nps as npsApi } from '../../lib/api'
import SurveyBuilder from './SurveyBuilder'

const STATUS_STYLES = {
  draft: 'bg-gray-100 border border-gray-200 text-gray-600',
  active: 'bg-green-50 border border-green-200 text-green-700',
  paused: 'bg-amber-50 border border-amber-200 text-amber-700',
}

const TRIGGER_LABELS = {
  tenure_days: (v) => `${v} days after joining`,
  tenure_months: (v) => `${v} months after joining`,
  status_change: (_, s) => `When status becomes ${s || '…'}`,
  walkup: () => 'Poster only',
}

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red'
const labelClass = 'block text-xs font-semibold text-text-muted mb-1'

function CreateSurvey({ onCreated, onCancel }) {
  const [title, setTitle] = useState('')
  const [triggerType, setTriggerType] = useState('tenure_months')
  const [triggerValue, setTriggerValue] = useState(6)
  const [triggerStatus, setTriggerStatus] = useState('Cancelled')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const isTenure = triggerType === 'tenure_days' || triggerType === 'tenure_months'

  async function create() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await npsApi.createSurvey({
        title,
        trigger_type: triggerType,
        trigger_value: isTenure ? Number(triggerValue) : null,
        trigger_status: triggerType === 'status_change' ? triggerStatus : null,
      })
      onCreated(res.survey)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
      <h3 className="text-sm font-bold text-text-primary">New survey</h3>

      {error && (
        <div className="bg-bg border border-border rounded-lg p-3">
          <p className="text-xs text-wcs-red">{error}</p>
        </div>
      )}

      <div>
        <label className={labelClass}>Name</label>
        <input value={title} onChange={e => setTitle(e.target.value)}
          placeholder="6 Month Check-In" className={inputClass} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass}>Who gets it</label>
          <select value={triggerType} onChange={e => setTriggerType(e.target.value)} className={inputClass}>
            <option value="tenure_days">Days after joining</option>
            <option value="tenure_months">Months after joining</option>
            <option value="status_change">When status changes</option>
            <option value="walkup">Poster only (no email)</option>
          </select>
        </div>

        {isTenure && (
          <div>
            <label className={labelClass}>How many</label>
            <input type="number" value={triggerValue}
              onChange={e => setTriggerValue(e.target.value)} className={inputClass} />
          </div>
        )}

        {triggerType === 'status_change' && (
          <div>
            <label className={labelClass}>Status to watch for</label>
            <input value={triggerStatus} onChange={e => setTriggerStatus(e.target.value)} className={inputClass} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={create} disabled={!title.trim() || busy}
          className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40">
          {busy ? 'Creating…' : 'Create'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded-lg hover:bg-bg transition-colors">
          Cancel
        </button>
      </div>

      <p className="text-[11px] text-text-muted">
        It starts as a draft, so nothing sends until you set it active.
      </p>
    </div>
  )
}

function MetricsTab({ metrics, onChanged }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function add() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await npsApi.createMetric({ key, label })
      setKey(''); setLabel('')
      onChanged()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  async function toggle(m) {
    try {
      await npsApi.setMetricActive(m.id, !m.active)
      onChanged()
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-5">
        <h3 className="text-sm font-bold text-text-primary">What we measure</h3>
        <p className="text-xs text-text-muted mt-0.5 mb-4">
          Every rating question points at one of these, which is how answers from
          different surveys roll up together. Add sparingly: a near-duplicate
          splits a metric in two and the report cannot show you that it happened.
        </p>

        <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
          {metrics.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-bg">
              <div className="min-w-0">
                <p className="text-sm text-text-primary truncate">{m.label}</p>
                <p className="text-xs text-text-muted font-mono truncate">{m.key}</p>
              </div>
              <button
                type="button" onClick={() => toggle(m)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${
                  m.active ? 'bg-green-50 border border-green-200 text-green-700'
                            : 'bg-gray-100 border border-gray-200 text-gray-500'}`}
              >
                {m.active ? 'In use' : 'Retired'}
              </button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-text-muted mt-2">
          Retiring keeps the history and stops it being offered on new questions.
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-border p-5 space-y-4">
        <h3 className="text-sm font-bold text-text-primary">Add a metric</h3>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Name</label>
            <input value={label} onChange={e => setLabel(e.target.value)}
              placeholder="Locker room condition" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Key</label>
            <input value={key} onChange={e => setKey(e.target.value)}
              placeholder="locker_room" className={`${inputClass} font-mono`} />
          </div>
        </div>

        <button type="button" onClick={add} disabled={!key.trim() || !label.trim() || busy}
          className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40">
          {busy ? 'Adding…' : 'Add metric'}
        </button>
      </div>
    </div>
  )
}

export default function NpsView({ onBack }) {
  const [surveys, setSurveys] = useState(null)
  const [metrics, setMetrics] = useState([])
  const [openId, setOpenId] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [tab, setTab] = useState('surveys')
  const [error, setError] = useState('')

  async function load() {
    try {
      const [s, m] = await Promise.all([npsApi.listSurveys(), npsApi.listMetrics()])
      setSurveys(s.surveys || [])
      setMetrics(m.metrics || [])
    } catch (err) { setError(err.message) }
  }
  useEffect(() => { load() }, [])

  if (openId) {
    return <SurveyBuilder surveyId={openId} onBack={() => { setOpenId(null); load() }} />
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4 w-full">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Feedback</h2>
            <p className="text-xs text-text-muted">
              Member surveys, what they measure, and the posters that collect them
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={onBack} className="px-4 py-2 text-sm font-medium text-text-primary border border-border rounded-lg hover:bg-bg transition-colors">
              Back
            </button>
            {tab === 'surveys' && !showCreate && (
              <button
                type="button" onClick={() => setShowCreate(true)}
                className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity"
              >
                New survey
              </button>
            )}
          </div>
        </div>

        <div className="flex rounded-lg border border-border overflow-hidden w-fit">
          {[['surveys', 'Surveys'], ['metrics', 'What we measure']].map(([key, label]) => (
            <button
              key={key} type="button" onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === key ? 'bg-wcs-red text-white' : 'bg-bg text-text-muted hover:text-text-primary'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-border px-4 py-3">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {tab === 'metrics' ? (
        <MetricsTab metrics={metrics} onChanged={load} />
      ) : (
        <>
          {showCreate && (
            <CreateSurvey
              onCancel={() => setShowCreate(false)}
              onCreated={(s) => { setShowCreate(false); load(); setOpenId(s.id) }}
            />
          )}

          {surveys === null ? (
            <div className="bg-surface rounded-xl border border-border p-8 text-center">
              <p className="text-sm text-text-muted">Loading…</p>
            </div>
          ) : surveys.length === 0 ? (
            <div className="bg-surface rounded-xl border border-border p-8 text-center">
              <p className="text-sm text-text-muted">
                No surveys yet. Create one to start collecting feedback.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {surveys.map(s => (
                <button
                  key={s.id} type="button" onClick={() => setOpenId(s.id)}
                  className="w-full text-left bg-surface rounded-xl border border-border p-4 hover:border-wcs-red transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-text-primary truncate">{s.title}</p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {(TRIGGER_LABELS[s.trigger_type] || (() => s.trigger_type))(s.trigger_value, s.trigger_status)}
                        {' · '}
                        {(s.schema || []).filter(q => !['header', 'description'].includes(q.type)).length} questions
                      </p>
                      <p className="text-[11px] text-text-muted font-mono mt-1 truncate">/{s.slug}</p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${STATUS_STYLES[s.status] || ''}`}>
                      {s.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
