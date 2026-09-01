// portal/src/components/admin/MarketingSmsAdmin.jsx
//
// Marketing SMS — read and edit a club's GHL custom values without leaving the
// portal. GHL's own settings screen edits these one sub-account at a time in a
// single-line input, which quietly flattens multi-line SMS copy; this editor is
// a textarea and saves through the API, so real newlines survive.
import { useState, useEffect, useMemo, useRef } from 'react'
import { getCustomValueLocations, getCustomValues, updateCustomValue } from '../../lib/api'
import { MERGE_FIELD_GROUPS } from '../../lib/ghlMergeFields'

function CopyButton({ text, className = '' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      className={'text-[11px] rounded-md border border-border px-2 py-0.5 font-medium text-text-muted hover:text-text-primary transition-colors ' + className}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// GSM-7 vs UCS-2 segmenting, so long SMS copy shows what it will actually cost.
// Anything outside the GSM-7 basic set (approximated as ASCII plus the few
// accented characters GHL never sends) forces the whole message to UCS-2.
const GSM7_EXTENDED = '^{}\[~]|€'
function smsSegments(text) {
  const chars = [...(text || '')]
  if (!chars.length) return { len: 0, segments: 0, unicode: false }
  const unicode = chars.some(c => c.codePointAt(0) > 127 && !GSM7_EXTENDED.includes(c))
  // GSM-7 extended characters cost two septets each.
  const len = unicode
    ? chars.length
    : chars.reduce((n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  return { len, unicode, segments: len <= single ? 1 : Math.ceil(len / multi) }
}

// Renders a stored value so newlines and empties are visible at a glance.
function ValuePreview({ value }) {
  if (!value) return <span className="text-xs italic text-text-muted">(empty)</span>
  return (
    <span className="text-xs text-text-primary whitespace-pre-wrap break-words">{value}</span>
  )
}

function MergeFieldPicker({ groups, onInsert }) {
  const [query, setQuery] = useState('')
  const [openGroup, setOpenGroup] = useState(groups[0]?.key || null)
  const q = query.trim().toLowerCase()

  const shown = useMemo(() => {
    if (!q) return groups
    return groups
      .map(g => ({
        ...g,
        fields: g.fields.filter(f =>
          f.token.toLowerCase().includes(q) || (f.label || '').toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.fields.length > 0)
  }, [groups, q])

  return (
    <div className="bg-surface border border-border rounded-xl p-3 flex flex-col min-h-0">
      <h4 className="text-xs font-bold text-text-primary mb-1">Merge Fields</h4>
      <p className="text-[11px] text-text-muted mb-2">Click to insert at the cursor.</p>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search merge fields…"
        className="w-full text-xs bg-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30 mb-2"
      />
      <div className="overflow-y-auto space-y-1 pr-1" style={{ maxHeight: '46vh' }}>
        {shown.length === 0 && (
          <p className="text-xs text-text-muted py-2">No merge fields match “{query}”.</p>
        )}
        {shown.map(g => {
          const expanded = !!q || openGroup === g.key
          return (
            <div key={g.key} className="border border-border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenGroup(expanded && !q ? null : g.key)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 bg-bg text-left"
              >
                <span className="text-[11px] font-semibold text-text-primary">
                  {g.label} <span className="text-text-muted font-normal">({g.fields.length})</span>
                </span>
                <span className="text-[10px] text-text-muted">{expanded ? '−' : '+'}</span>
              </button>
              {expanded && (
                <div className="p-1.5 space-y-0.5">
                  {g.note && <p className="text-[10px] text-text-muted px-1 pb-1">{g.note}</p>}
                  {g.fields.map(f => (
                    <button
                      key={f.token}
                      type="button"
                      onClick={() => onInsert(f.token)}
                      title={f.token}
                      className="w-full text-left px-2 py-1 rounded-md hover:bg-wcs-red/10 transition-colors"
                    >
                      <span className="block text-[11px] font-mono text-text-primary truncate">{f.token}</span>
                      <span className="block text-[10px] text-text-muted truncate">{f.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EditorModal({ locationName, item, groups, onCancel, onSave, saving, error }) {
  const [name, setName] = useState(item.name || '')
  const [value, setValue] = useState(item.value || '')
  const areaRef = useRef(null)

  // Insert a token at the caret (replacing any selection), then restore focus
  // so the picker can be clicked repeatedly without losing position.
  function insertToken(token) {
    const el = areaRef.current
    if (!el) {
      setValue(v => v + token)
      return
    }
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const next = value.slice(0, start) + token + value.slice(end)
    setValue(next)
    requestAnimationFrame(() => {
      el.focus()
      const caret = start + token.length
      el.setSelectionRange(caret, caret)
    })
  }

  const dirty = name !== (item.name || '') || value !== (item.value || '')
  const sms = smsSegments(value)
  const lines = value ? value.split('\n').length : 0

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={onCancel}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-text-primary">Edit Custom Value</h3>
          <p className="text-xs text-text-muted mt-0.5">
            {locationName}
            {item.token && <> · <span className="font-mono">{item.token}</span></>}
          </p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
                />
                <p className="text-[11px] text-text-muted mt-1">
                  Renaming does not change the reference key — templates keep using{' '}
                  <span className="font-mono">{item.token || 'the existing key'}</span>.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-text-primary">Value</label>
                  <span className="text-[11px] text-text-muted">
                    {sms.len} chars · {lines} line{lines === 1 ? '' : 's'} · {sms.segments} SMS segment{sms.segments === 1 ? '' : 's'}
                    {sms.unicode ? ' (unicode)' : ''}
                  </span>
                </div>
                <textarea
                  ref={areaRef}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  rows={12}
                  spellCheck
                  className="w-full text-sm font-mono bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30 whitespace-pre-wrap"
                />
                <p className="text-[11px] text-text-muted mt-1">
                  Press Enter for a real line break — it is saved as an actual newline through the API,
                  which GHL’s single-line settings field cannot do. Send one test message to yourself and
                  check the received text (not the workflow preview) before rolling copy out to every club.
                </p>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>

            <MergeFieldPicker groups={groups} onInsert={insertToken} />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs bg-surface border border-border rounded-lg px-4 py-2 font-medium text-text-muted hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !dirty || !name.trim()}
            onClick={() => onSave({ name: name.trim(), value })}
            className="text-xs bg-wcs-red text-white rounded-lg px-4 py-2 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save to GHL'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MarketingSmsAdmin() {
  const [locations, setLocations] = useState([])
  const [location, setLocation] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedId, setSavedId] = useState(null)

  useEffect(() => {
    getCustomValueLocations()
      .then(res => {
        setLocations(res.locations || [])
        if ((res.locations || []).length) setLocation(res.locations[0].slug)
      })
      .catch(err => setError(err.message))
  }, [])

  useEffect(() => {
    if (!location) return
    let cancelled = false
    setLoading(true)
    setError(null)
    getCustomValues(location)
      .then(res => { if (!cancelled) setData(res) })
      .catch(err => { if (!cancelled) { setError(err.message); setData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [location])

  // Standard GHL tokens plus this club's own custom values and contact custom
  // fields, so the picker covers everything that actually resolves here.
  const pickerGroups = useMemo(() => {
    const groups = []
    const cvs = (data?.customValues || []).filter(cv => cv.token)
    if (cvs.length) {
      groups.push({
        key: 'this_custom_values',
        label: 'This Account’s Custom Values',
        note: 'Custom values can reference each other.',
        fields: cvs.map(cv => ({ token: cv.token, label: cv.name })),
      })
    }
    const cfs = data?.customFields || []
    if (cfs.length) {
      groups.push({
        key: 'this_custom_fields',
        label: 'This Account’s Contact Fields',
        note: 'Contact custom fields for this sub-account.',
        fields: cfs.map(f => ({ token: f.token, label: f.name })),
      })
    }
    return [...groups, ...MERGE_FIELD_GROUPS]
  }, [data])

  const q = search.trim().toLowerCase()
  const rows = (data?.customValues || []).filter(cv =>
    !q ||
    (cv.name || '').toLowerCase().includes(q) ||
    (cv.fieldKey || '').toLowerCase().includes(q) ||
    (cv.value || '').toLowerCase().includes(q)
  )

  async function handleSave({ name, value }) {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await updateCustomValue(location, editing.id, { name, value })
      const updated = res.customValue
      setData(d => ({
        ...d,
        customValues: (d.customValues || []).map(cv =>
          cv.id === editing.id ? { ...cv, ...updated, name, value } : cv
        ),
      }))
      setEditing(null)
      setSavedId(editing.id)
      setTimeout(() => setSavedId(null), 2500)
    } catch (err) {
      setSaveError(err.message)
    }
    setSaving(false)
  }

  const activeLocation = locations.find(l => l.slug === location)

  return (
    <div className="space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5">
        <h3 className="text-sm font-bold text-text-primary">GHL Custom Values</h3>
        <p className="text-xs text-text-muted mt-1">
          The sub-account variables marketing SMS and email templates reference as{' '}
          <span className="font-mono">{'{{ custom_values.your_key }}'}</span>. Edits save straight back to GHL.
        </p>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {locations.map(l => (
            <button
              key={l.slug}
              onClick={() => { setSearch(''); setLocation(l.slug) }}
              className={
                'text-xs rounded-lg px-3 py-1.5 font-medium border transition-colors ' +
                (l.slug === location
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary')
              }
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-surface/95 rounded-xl border border-border p-5">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}

      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            placeholder="Search name, key, or value…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full max-w-md text-xs bg-bg border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
          />
          <span className="text-xs text-text-muted whitespace-nowrap">
            {loading ? 'Loading…' : `${rows.length} of ${data?.customValues?.length || 0}`}
          </span>
        </div>

        {data?.customFieldsError && (
          <p className="text-[11px] text-text-muted">
            Contact custom fields unavailable for the picker ({data.customFieldsError}) — standard merge fields still load.
          </p>
        )}

        {!loading && data && rows.length === 0 && (
          <p className="text-sm text-text-muted py-4">
            {data.customValues?.length ? 'No custom values match that search.' : `No custom values in ${activeLocation?.name || 'this account'}.`}
          </p>
        )}

        <div className="space-y-2">
          {rows.map(cv => (
            <div key={cv.id} className="bg-surface border border-border rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary">{cv.name}</span>
                    {savedId === cv.id && <span className="text-[11px] text-green-600 font-medium">Saved to GHL</span>}
                  </div>
                  {cv.token && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono text-text-muted truncate">{cv.token}</span>
                      <CopyButton text={cv.token} />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setSaveError(null); setEditing(cv) }}
                  className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary transition-colors whitespace-nowrap"
                >
                  Edit
                </button>
              </div>
              <div className="mt-2 rounded-lg bg-bg border border-border px-3 py-2">
                <ValuePreview value={cv.value} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <EditorModal
          locationName={activeLocation?.name || ''}
          item={editing}
          groups={pickerGroups}
          saving={saving}
          error={saveError}
          onCancel={() => { if (!saving) { setEditing(null); setSaveError(null) } }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
