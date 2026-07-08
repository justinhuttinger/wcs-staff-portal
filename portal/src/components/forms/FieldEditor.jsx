import { useEffect, useState } from 'react'

const OPTION_TYPES = ['dropdown', 'radio', 'checkbox']
const PLACEHOLDER_TYPES = ['short_text', 'long_text', 'email', 'phone', 'number', 'dropdown']

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'
const labelClass = 'block text-xs font-semibold text-text-muted mb-1'

// Right-pane settings editor for the selected field. Never touches field.id.
export default function FieldEditor({ field, typeLabel, onChange, disabled }) {
  const [optionsText, setOptionsText] = useState((field.options || []).join('\n'))
  useEffect(() => {
    setOptionsText((field.options || []).join('\n'))
    // Re-sync the textarea only when a different field is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.id])

  function handleOptionsChange(value) {
    setOptionsText(value)
    onChange({ options: value.split('\n').map(s => s.trim()).filter(Boolean) })
  }

  const isDisplay = field.type === 'header' || field.type === 'description'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-text-primary">Field Settings</h4>
        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-bg border border-border text-text-muted">
          {typeLabel}
        </span>
      </div>

      {field.type === 'description' ? (
        <div>
          <label className={labelClass}>Text</label>
          <textarea value={field.help_text || ''} rows={4} disabled={disabled}
            onChange={e => onChange({ help_text: e.target.value })}
            placeholder="Paragraph text shown to the person filling out the form"
            className={inputClass} />
        </div>
      ) : (
        <div>
          <label className={labelClass}>{field.type === 'header' ? 'Heading' : 'Label'}</label>
          <input value={field.label || ''} disabled={disabled}
            onChange={e => onChange({ label: e.target.value })}
            className={inputClass} />
        </div>
      )}

      {!isDisplay && PLACEHOLDER_TYPES.includes(field.type) && (
        <div>
          <label className={labelClass}>Placeholder</label>
          <input value={field.placeholder || ''} disabled={disabled}
            onChange={e => onChange({ placeholder: e.target.value })}
            className={inputClass} />
        </div>
      )}

      {OPTION_TYPES.includes(field.type) && (
        <div>
          <label className={labelClass}>Options (one per line)</label>
          <textarea value={optionsText} rows={5} disabled={disabled}
            onChange={e => handleOptionsChange(e.target.value)}
            placeholder={'Option 1\nOption 2'}
            className={inputClass} />
        </div>
      )}

      {field.type !== 'description' && (
        <div>
          <label className={labelClass}>{field.type === 'header' ? 'Subtext (optional)' : 'Help text (optional)'}</label>
          <input value={field.help_text || ''} disabled={disabled}
            onChange={e => onChange({ help_text: e.target.value })}
            placeholder="Shown in small print under the field"
            className={inputClass} />
        </div>
      )}

      {!isDisplay && (
        <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
          <input type="checkbox" checked={!!field.required} disabled={disabled}
            onChange={e => onChange({ required: e.target.checked })}
            className="w-4 h-4 accent-wcs-red" />
          Required
        </label>
      )}
    </div>
  )
}
