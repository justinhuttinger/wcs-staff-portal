import { OPTION_TYPES, DISPLAY_TYPES, asFileList, fmtBytes } from './shared'

// Only allow http(s) links so a schema can't smuggle a javascript: URL.
function safeHref(url) {
  return /^https?:\/\//i.test(String(url || '').trim()) ? url.trim() : null
}

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red'

// Renders an editable set of fields for a ticket-type schema. `values` is a
// map keyed by field id; onChange(id, value) updates one field. `errors` is an
// optional map of id -> message.
export default function DynamicFields({ schema = [], values = {}, onChange, errors = {} }) {
  return (
    <div className="space-y-4">
      {schema.map(field => {
        if (field.type === 'header') {
          return (
            <div key={field.id} className="pt-2">
              <h4 className="text-base font-bold text-text-primary">{field.label}</h4>
              {field.help_text && <p className="text-xs text-text-muted mt-0.5">{field.help_text}</p>}
            </div>
          )
        }
        if (field.type === 'description') {
          return <p key={field.id} className="text-sm text-text-muted whitespace-pre-wrap">{field.help_text}</p>
        }
        if (field.type === 'link') {
          const href = safeHref(field.url)
          if (!href) return null
          return (
            <div key={field.id}>
              <a href={href} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-wcs-red/30 bg-wcs-red/5 text-sm font-semibold text-wcs-red hover:bg-wcs-red/10 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                {field.label || 'Download'}
              </a>
              {field.help_text && <p className="text-[11px] text-text-muted mt-1">{field.help_text}</p>}
            </div>
          )
        }

        const val = values[field.id]
        const err = errors[field.id]
        const setVal = v => onChange(field.id, v)

        return (
          <div key={field.id}>
            <label className="block text-sm font-semibold text-text-primary mb-1">
              {field.label}
              {field.required && <span className="text-wcs-red ml-0.5">*</span>}
            </label>

            {field.type === 'long_text' ? (
              <textarea value={val || ''} rows={4} placeholder={field.placeholder || ''}
                onChange={e => setVal(e.target.value)} className={inputClass} />
            ) : field.type === 'dropdown' ? (
              <select value={val || ''} onChange={e => setVal(e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : field.type === 'radio' ? (
              <div className="space-y-1.5">
                {(field.options || []).map(o => (
                  <label key={o} className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                    <input type="radio" name={field.id} checked={val === o}
                      onChange={() => setVal(o)} className="w-4 h-4 accent-wcs-red" />
                    {o}
                  </label>
                ))}
              </div>
            ) : field.type === 'checkbox' ? (
              <div className="space-y-1.5">
                {(field.options || []).map(o => {
                  const arr = Array.isArray(val) ? val : []
                  const checked = arr.includes(o)
                  return (
                    <label key={o} className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => setVal(checked ? arr.filter(x => x !== o) : [...arr, o])}
                        className="w-4 h-4 accent-wcs-red" />
                      {o}
                    </label>
                  )
                })}
              </div>
            ) : field.type === 'file' ? (
              <FileField files={asFileList(val)} onChange={setVal} />
            ) : (
              <input
                type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'email' ? 'email' : 'text'}
                value={val || ''} placeholder={field.placeholder || ''}
                onChange={e => setVal(e.target.value)} className={inputClass} />
            )}

            {field.help_text && <p className="text-[11px] text-text-muted mt-1">{field.help_text}</p>}
            {err && <p className="text-[11px] text-wcs-red mt-1">{err}</p>}
          </div>
        )
      })}
    </div>
  )
}

// Multi-file picker. Each pick appends to the list (rather than replacing it),
// so several documents can be added in separate trips through the file dialog.
function FileField({ files, onChange }) {
  function add(picked) {
    const next = [...files]
    for (const f of picked) {
      if (!next.some(x => x.name === f.name && x.size === f.size)) next.push(f)
    }
    onChange(next)
  }
  return (
    <div>
      <input type="file" multiple
        onChange={e => { add(Array.from(e.target.files || [])); e.target.value = '' }}
        className="block w-full text-xs text-text-muted file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-wcs-red/10 file:text-wcs-red hover:file:bg-wcs-red/20" />
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center justify-between gap-2 text-xs bg-bg border border-border rounded-lg px-2.5 py-1.5">
              <span className="truncate text-text-primary">{f.name} <span className="text-text-muted">({fmtBytes(f.size)})</span></span>
              <button type="button" onClick={() => onChange(files.filter((_, idx) => idx !== i))}
                className="text-red-500 shrink-0" aria-label={`Remove ${f.name}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Read-only presentation of a submitted ticket's answers.
export function DynamicAnswers({ schema = [], data = {} }) {
  const inputs = schema.filter(f => !DISPLAY_TYPES.includes(f.type))
  const answered = inputs.filter(f => {
    const v = data[f.id]
    return !(v == null || v === '' || (Array.isArray(v) && v.length === 0))
  })
  if (answered.length === 0) return <p className="text-sm text-text-muted">No details submitted.</p>
  return (
    <dl className="divide-y divide-border">
      {answered.map(f => {
        const v = data[f.id]
        return (
          <div key={f.id} className="py-2 grid grid-cols-3 gap-3">
            <dt className="text-xs font-semibold text-text-muted col-span-1">{f.label}</dt>
            <dd className="text-sm text-text-primary col-span-2 whitespace-pre-wrap">{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
          </div>
        )
      })}
    </dl>
  )
}
