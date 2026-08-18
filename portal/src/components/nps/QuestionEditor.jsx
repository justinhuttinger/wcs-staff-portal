import { useEffect, useState } from 'react'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'
const labelClass = 'block text-xs font-semibold text-text-muted mb-1'

export const QUESTION_TYPES = [
  { value: 'nps', label: 'Recommend score (0-10)' },
  { value: 'rating', label: 'Rating' },
  { value: 'select', label: 'Pick one' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'short_text', label: 'Short answer' },
  { value: 'header', label: 'Heading' },
  { value: 'description', label: 'Paragraph' },
]

const SCORE_TYPES = ['nps', 'rating']
const DISPLAY_TYPES = ['header', 'description']

export default function QuestionEditor({ question, metrics, onChange, onRemove, disabled }) {
  const [optionsText, setOptionsText] = useState((question.options || []).join('\n'))
  useEffect(() => {
    setOptionsText((question.options || []).join('\n'))
    // Re-sync only when a different question is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id])

  function handleOptions(value) {
    setOptionsText(value)
    onChange({ options: value.split('\n').map(s => s.trim()).filter(Boolean) })
  }

  const isDisplay = DISPLAY_TYPES.includes(question.type)
  const isScore = SCORE_TYPES.includes(question.type)
  const activeMetrics = (metrics || []).filter(m => m.active)

  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <label className={labelClass}>Type</label>
          <select
            value={question.type}
            disabled={disabled}
            onChange={e => onChange({ type: e.target.value })}
            className={inputClass}
          >
            {QUESTION_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="mt-5 text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors shrink-0"
        >
          Remove
        </button>
      </div>

      <div>
        <label className={labelClass}>
          {question.type === 'header' ? 'Heading' : question.type === 'description' ? 'Text' : 'Question'}
        </label>
        <input
          value={question.label || ''}
          disabled={disabled}
          onChange={e => onChange({ label: e.target.value })}
          placeholder={question.type === 'nps' ? 'How likely are you to recommend us?' : ''}
          className={inputClass}
        />
      </div>

      {isScore && (
        <div>
          <label className={labelClass}>Metric</label>
          <select
            value={question.metric_key || ''}
            disabled={disabled}
            onChange={e => onChange({ metric_key: e.target.value })}
            className={inputClass}
          >
            <option value="">Pick a metric</option>
            {activeMetrics.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-text-muted mt-1">
            Answers roll up under this metric across every survey that uses it.
            Reuse an existing one rather than adding a near-duplicate.
          </p>
        </div>
      )}

      {question.type === 'rating' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Lowest</label>
            <input
              type="number" value={question.min ?? 1} disabled={disabled}
              onChange={e => onChange({ min: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Highest</label>
            <input
              type="number" value={question.max ?? 10} disabled={disabled}
              onChange={e => onChange({ max: Number(e.target.value) })}
              className={inputClass}
            />
          </div>
        </div>
      )}

      {question.type === 'nps' && (
        <p className="text-[11px] text-text-muted">
          Fixed at 0 to 10 so scores stay comparable across surveys.
        </p>
      )}

      {question.type === 'select' && (
        <div>
          <label className={labelClass}>Options (one per line)</label>
          <textarea
            value={optionsText} rows={4} disabled={disabled}
            onChange={e => handleOptions(e.target.value)}
            placeholder={'Moving away\nToo expensive\nNot using it enough'}
            className={inputClass}
          />
        </div>
      )}

      {!isDisplay && (
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input
            type="checkbox" checked={!!question.required} disabled={disabled}
            onChange={e => onChange({ required: e.target.checked })}
            className="w-4 h-4 accent-wcs-red"
          />
          Required
        </label>
      )}
    </div>
  )
}
