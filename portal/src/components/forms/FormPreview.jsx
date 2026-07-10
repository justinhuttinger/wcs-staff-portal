// Read-only render of a form schema in the public-renderer styling.
// The public renderer mirrors this markup: white card, labels with required
// asterisks, one block per field, red submit button.

import { renderInline } from './richText'

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 text-gray-500'

function RequiredMark({ field }) {
  if (!field.required) return null
  return <span className="text-red-600 ml-0.5">*</span>
}

function FieldLabel({ field }) {
  return (
    <label className="block text-sm font-medium text-gray-800 mb-1">
      {field.label}
      <RequiredMark field={field} />
    </label>
  )
}

function HelpText({ field }) {
  if (!field.help_text) return null
  return <p className="text-xs text-gray-500 mt-1">{field.help_text}</p>
}

function PreviewField({ field }) {
  switch (field.type) {
    case 'header':
      return (
        <div className="pt-2">
          <h3 className="text-lg font-semibold text-gray-900">{field.label || 'Section Header'}</h3>
          {field.help_text && <p className="text-sm text-gray-600 mt-0.5">{field.help_text}</p>}
        </div>
      )
    case 'description':
      return (
        <p className="text-sm text-gray-600 whitespace-pre-wrap">{field.help_text || field.label || ''}</p>
      )
    case 'long_text':
      return (
        <div>
          <FieldLabel field={field} />
          <textarea disabled rows={3} placeholder={field.placeholder || ''} className={inputClass} />
          <HelpText field={field} />
        </div>
      )
    case 'dropdown':
      return (
        <div>
          <FieldLabel field={field} />
          <select disabled className={inputClass}>
            <option>{field.placeholder || 'Choose an option'}</option>
            {(field.options || []).map((o, i) => <option key={i}>{o}</option>)}
          </select>
          <HelpText field={field} />
        </div>
      )
    case 'radio':
      return (
        <div>
          <FieldLabel field={field} />
          <div className="space-y-1.5">
            {(field.options || []).map((o, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="radio" disabled name={`preview-${field.id}`} className="accent-red-700" />
                {o}
              </label>
            ))}
          </div>
          <HelpText field={field} />
        </div>
      )
    case 'checkbox':
      return (
        <div>
          <FieldLabel field={field} />
          <div className="space-y-1.5">
            {(field.options || []).map((o, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" disabled className="accent-red-700" />
                {o}
              </label>
            ))}
          </div>
          <HelpText field={field} />
        </div>
      )
    case 'date':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="date" disabled className={inputClass} />
          <HelpText field={field} />
        </div>
      )
    case 'number':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="number" disabled placeholder={field.placeholder || ''} className={inputClass} />
          <HelpText field={field} />
        </div>
      )
    case 'email':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="email" disabled placeholder={field.placeholder || ''} className={inputClass} />
          <HelpText field={field} />
        </div>
      )
    case 'phone':
      return (
        <div>
          <FieldLabel field={field} />
          <input type="tel" disabled placeholder={field.placeholder || ''} className={inputClass} />
          <HelpText field={field} />
        </div>
      )
    case 'short_text':
    default:
      return (
        <div>
          <FieldLabel field={field} />
          <input type="text" disabled placeholder={field.placeholder || ''} className={inputClass} />
          <HelpText field={field} />
        </div>
      )
  }
}

export default function FormPreview({ schema, title, description }) {
  const fields = Array.isArray(schema) ? schema : []
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 max-w-xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900">{title || 'Untitled Form'}</h2>
      {description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{renderInline(description)}</p>}
      {fields.length === 0 ? (
        <p className="text-sm text-gray-400 mt-6">No fields yet. Add fields to see the preview.</p>
      ) : (
        <div className="mt-5 space-y-5">
          {fields.map(f => <PreviewField key={f.id} field={f} />)}
        </div>
      )}
      <button type="button" disabled
        className="mt-6 w-full py-2.5 bg-red-700 text-white text-sm font-semibold rounded-lg opacity-90 cursor-default">
        Submit
      </button>
    </div>
  )
}
