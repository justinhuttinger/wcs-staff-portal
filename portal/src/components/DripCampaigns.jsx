// portal/src/components/DripCampaigns.jsx
//
// Drip Campaigns — read and edit a club's GHL custom values without leaving the
// portal. GHL's own settings screen edits these one sub-account at a time in a
// single-line input, which quietly flattens multi-line SMS copy; this editor is
// a textarea and saves through the API, so real newlines survive.
import { useState, useEffect, useMemo, useRef } from 'react'
import {
  getCustomValueLocations, getCustomValues, updateCustomValue,
  getDripTestConfig, saveDripTestConfig, previewDripMessage, sendDripTest,
  uploadDripMedia, clearDripMedia,
} from '../lib/api'
import { shrinkImage, formatBytes } from '../lib/imageShrink'
import { MERGE_FIELD_GROUPS } from '../lib/ghlMergeFields'

// The WCS drip sequence, in the order the messages actually go out. GHL returns
// custom values in an arbitrary order, so the list is sorted by this instead of
// alphabetically. Anything not listed here sorts after, by name.
const DRIP_ORDER = [
  'custom_values.new_lead_sms_1',
  'custom_values.new_lead_sms_2',
  'custom_values.new_lead_sms_3',
  'custom_values.new_lead_sms_4',
  'custom_values.new_lead_sms_5',
  'custom_values.trial_begin_sms',
  'custom_values.trial_check_in_sms',
  'custom_values.trial_end_sms_1',
  'custom_values.trial_end_sms_2',
  'custom_values.trial_end_sms_3',
  'custom_values.new_member_sms_1',
  'custom_values.new_member_sms_2',
  'custom_values.missed_tour_sms',
  'custom_values.vip_sms_1',
  'custom_values.vip_sms_2',
  'custom_values.vip_sms_3',
  'custom_values.vip_sms_4',
  'custom_values.vip_sms_5',
]

// The drip sequences, for the flow filter. Each flow owns a set of keys; a
// custom value outside every flow (something added later) still shows under
// "All" rather than disappearing from the tool.
const FLOWS = [
  { key: 'all', label: 'All flows', keys: null },
  { key: 'new-lead', label: 'New Lead', keys: [
    'custom_values.new_lead_sms_1', 'custom_values.new_lead_sms_2', 'custom_values.new_lead_sms_3',
    'custom_values.new_lead_sms_4', 'custom_values.new_lead_sms_5',
  ] },
  { key: 'vip', label: 'VIP', keys: [
    'custom_values.vip_sms_1', 'custom_values.vip_sms_2', 'custom_values.vip_sms_3',
    'custom_values.vip_sms_4', 'custom_values.vip_sms_5',
  ] },
  { key: 'missed-tour', label: 'Missed Tour', keys: ['custom_values.missed_tour_sms'] },
  { key: 'trial', label: 'Trial', keys: [
    'custom_values.trial_begin_sms', 'custom_values.trial_check_in_sms',
    'custom_values.trial_end_sms_1', 'custom_values.trial_end_sms_2', 'custom_values.trial_end_sms_3',
  ] },
  { key: 'sale', label: 'Sale', keys: [
    'custom_values.new_member_sms_1', 'custom_values.new_member_sms_2',
  ] },
]

const FLOW_BY_KEY = Object.fromEntries(FLOWS.map(f => [f.key, f]))

// fieldKey comes back as "custom_values.new_lead_sms_1"; tolerate a stray
// "{{ }}" wrapper or missing prefix so ordering never silently degrades.
function normalizeKey(cv) {
  return String(cv.fieldKey || '').replace(/[{}\s]/g, '')
}

function dripRank(cv) {
  const i = DRIP_ORDER.indexOf(normalizeKey(cv))
  return i === -1 ? DRIP_ORDER.length : i
}

function inFlow(cv, flowKey) {
  const flow = FLOW_BY_KEY[flowKey]
  if (!flow || !flow.keys) return true
  return flow.keys.includes(normalizeKey(cv))
}

function byDripOrder(a, b) {
  const ra = dripRank(a), rb = dripRank(b)
  if (ra !== rb) return ra - rb
  return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
}

function TestSendPanel({ locationSlug, locationName, label, text, mediaUrl, onClose }) {
  const [cfg, setCfg] = useState(null)
  const [phone, setPhone] = useState('')
  // Planted merge-field values, keyed by full token path. Seeded from the saved
  // defaults and then edited per send.
  const [values, setValues] = useState({})
  const [savingDefaults, setSavingDefaults] = useState(false)
  const [defaultsSaved, setDefaultsSaved] = useState(false)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(null)
  const [webhookDraft, setWebhookDraft] = useState('')
  const [showSetup, setShowSetup] = useState(false)
  const [savingCfg, setSavingCfg] = useState(false)

  useEffect(() => {
    getDripTestConfig()
      .then(c => {
        setCfg(c)
        setPhone(c.defaultPhone || '')
        setWebhookDraft(c.webhookUrl || '')
        setValues(c.sampleValues || {})
        if (!c.configured) setShowSetup(true)
      })
      .catch(e => setError(e.message))
  }, [])

  // Re-render whenever a planted value changes. The response also names the
  // merge fields this copy uses, which is what drives the inputs below.
  useEffect(() => {
    let cancelled = false
    previewDripMessage({ location: locationSlug, text, values })
      .then(r => { if (!cancelled) setPreview(r) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [locationSlug, text, values])

  async function handleSend() {
    setBusy(true)
    setError(null)
    setSent(null)
    try {
      const r = await sendDripTest({ location: locationSlug, text, phone, values, mediaUrl, label })
      setSent(r)
      // The handset is the real confirmation, so the panel gets out of the way
      // rather than making you dismiss it.
      setTimeout(() => onCloseRef.current?.(), 2000)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  // Persist the planted values so they are not retyped on every test. Admin
  // only, enforced by the app-settings PUT.
  async function handleSaveDefaults() {
    setSavingDefaults(true)
    setError(null)
    try {
      const toSave = {}
      for (const f of (preview?.fields || [])) toSave[f.path] = values[f.path] ?? ''
      await saveDripTestConfig({ drip_test_sample_values: JSON.stringify({ ...(cfg?.sampleValues || {}), ...toSave }) })
      setDefaultsSaved(true)
      setTimeout(() => setDefaultsSaved(false), 2500)
    } catch (e) {
      setError(e.message)
    }
    setSavingDefaults(false)
  }

  async function handleSaveCfg() {
    setSavingCfg(true)
    setError(null)
    try {
      await saveDripTestConfig({ drip_test_webhook_url: webhookDraft.trim(), drip_test_default_phone: phone.trim() })
      const c = await getDripTestConfig()
      setCfg(c)
      setShowSetup(false)
    } catch (e) {
      setError(e.message)
    }
    setSavingCfg(false)
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div
        className="bg-surface border border-border rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-text-primary">Send a test</h3>
          <p className="text-xs text-text-muted mt-0.5">{label} · {locationName}</p>
        </div>

        {sent ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-14">
            <div className="animate-tour-pop w-20 h-20 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
              <svg viewBox="0 0 52 52" className="w-12 h-12" fill="none" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
                <path className="tour-check-path" d="M14 27 l8 8 l16 -18" />
              </svg>
            </div>
            <p className="animate-tour-pop text-lg font-bold text-text-primary">Sent</p>
            <p className="text-xs text-text-muted text-center">
              {sent.phone} · {sent.segments} segment{sent.segments === 1 ? '' : 's'}
              <br />
              Check the handset, not the workflow preview.
            </p>
          </div>
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
          {cfg && !cfg.configured && !cfg.canEdit && (
            <p className="text-sm text-red-500">
              No test webhook is configured yet. An admin needs to set one before tests can send.
            </p>
          )}

          {cfg && cfg.canEdit && (showSetup || !cfg.configured) && (
            <div className="rounded-xl border border-border bg-bg p-3 space-y-2">
              <h4 className="text-xs font-bold text-text-primary">Webhook setup (admin)</h4>
              <p className="text-[11px] text-text-muted">
                Paste the Inbound Webhook URL from the one GHL workflow that sends these tests. The portal
                POSTs <span className="font-mono">phone</span>, <span className="font-mono">message</span> and{' '}
                <span className="font-mono">media_url</span>; the workflow should send an SMS to{' '}
                <span className="font-mono">phone</span> with the body set to{' '}
                <span className="font-mono">{'{{inboundWebhookRequest.message}}'}</span>.
              </p>
              <input
                type="text"
                value={webhookDraft}
                onChange={e => setWebhookDraft(e.target.value)}
                placeholder="https://services.leadconnectorhq.com/hooks/..."
                className="w-full text-xs font-mono bg-surface border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
              />
              <button
                type="button"
                onClick={handleSaveCfg}
                disabled={savingCfg}
                className="text-xs bg-wcs-red text-white rounded-lg px-3 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
              >
                {savingCfg ? 'Saving…' : 'Save webhook'}
              </button>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">Send to</label>
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(503) 555-1234"
              className="w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold text-text-primary mb-1">Attachment</span>
            {mediaUrl ? (
              <div className="flex items-center gap-2">
                <img src={mediaUrl} alt="" className="h-10 w-10 rounded object-cover border border-border" />
                <span className="text-[11px] text-text-muted">
                  Sends as an MMS with this message's attachment.
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">
                No attachment on this message, so it sends as a plain SMS. Turn media on in the list to include one.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-semibold text-text-primary">Merge field values</label>
              {cfg?.canEdit && preview?.fields?.length > 0 && (
                <button
                  type="button"
                  onClick={handleSaveDefaults}
                  disabled={savingDefaults}
                  className="text-[11px] text-text-muted hover:text-text-primary underline underline-offset-2 disabled:opacity-50"
                >
                  {savingDefaults ? 'Saving…' : defaultsSaved ? 'Saved as defaults' : 'Save as defaults'}
                </button>
              )}
            </div>
            {preview?.fields?.length ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {preview.fields.map(f => (
                    <div key={f.path}>
                      <span className="block text-[10px] text-text-muted mb-0.5" title={`{{${f.path}}}`}>{f.label}</span>
                      <input
                        type="text"
                        value={values[f.path] ?? f.value ?? ''}
                        onChange={e => setValues(v => ({ ...v, [f.path]: e.target.value }))}
                        className="w-full text-xs bg-bg border border-border rounded-lg px-2 py-1.5 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted mt-1">
                  A test number is not attached to a contact, so these stand in for the real thing. Clear one to see
                  what a member missing that field receives.
                </p>
              </>
            ) : (
              <p className="text-[11px] text-text-muted">This message uses no merge fields.</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">What will arrive</label>
            <div className="rounded-lg bg-bg border border-border px-3 py-2">
              <span className="text-xs text-text-primary whitespace-pre-wrap break-words">
                {preview ? preview.text : 'Rendering…'}
              </span>
            </div>
            {preview && (
              <p className="text-[11px] text-text-muted mt-1">
                {preview.chars} chars · {preview.segments} segment{preview.segments === 1 ? '' : 's'} · {preview.encoding}
              </p>
            )}
            {preview?.unresolved?.length > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                Empty or unresolved: {preview.unresolved.map(u => `{{${u}}}`).join(', ')} — a member missing these gets a gap where the value should be.
              </p>
            )}
            {preview?.hidden?.length > 0 && (
              <p className="text-[11px] text-amber-600 mt-1">
                {preview.hidden.length} invisible character{preview.hidden.length === 1 ? '' : 's'} ({preview.hidden.map(h => h.codePoint).join(', ')}) — these force UCS-2 and raise the segment count.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        )}

        {!sent && (
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-2">
          {cfg?.canEdit && cfg?.configured && !showSetup ? (
            <button type="button" onClick={() => setShowSetup(true)} className="text-[11px] text-text-muted hover:text-text-primary underline underline-offset-2">
              Webhook settings
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs bg-surface border border-border rounded-lg px-4 py-2 font-medium text-text-muted hover:text-text-primary transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !cfg?.configured || !phone.trim()}
              className="text-xs bg-wcs-red text-white rounded-lg px-4 py-2 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send test'}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

// Media for one message. GHL attaches an MMS by reading a URL out of a custom
// value, so "on" is simply whether that companion value holds a URL - there is
// no separate flag that could drift out of step with what actually sends.
// Turning it off empties the value; the workflow is never touched.
function MediaControl({ locationSlug, cv, onChanged }) {
  const media = cv.media || {}
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  // Yes can be chosen before a file exists, so the dropdown and "is there a
  // URL stored" are not the same thing until an upload lands.
  const [wantMedia, setWantMedia] = useState(false)
  const fileRef = useRef(null)

  async function handleToggle(next) {
    setError(null)
    setNote(null)
    if (next === 'on') {
      setWantMedia(true)
      return
    }
    setWantMedia(false)
    // Nothing was ever stored, so there is nothing to clear.
    if (!media.url) return
    setBusy(true)
    try {
      await clearDripMedia({ location: locationSlug, messageKey: cv.fieldKey })
      onChanged()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const shrunk = await shrinkImage(file)
      const res = await uploadDripMedia({
        location: locationSlug,
        messageKey: cv.fieldKey,
        messageName: cv.name,
        file: shrunk.file,
      })
      if (shrunk.resized) {
        setNote(`Resized from ${formatBytes(shrunk.originalBytes)} to ${formatBytes(shrunk.bytes)} to stay under the carrier limit.`)
      }
      if (res.mediaValue?.keyWarning) setError(res.mediaValue.keyWarning)
      onChanged()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const on = !!media.on || wantMedia

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-[11px] font-medium text-text-muted">Media</span>
      <select
        value={on ? 'on' : 'off'}
        onChange={e => handleToggle(e.target.value)}
        disabled={busy}
        className="text-[11px] bg-surface border border-border rounded-lg px-2 py-1 font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30 disabled:opacity-50"
      >
        <option value="off">No</option>
        <option value="on">Yes</option>
      </select>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif"
        onChange={handleFile}
        className="hidden"
      />

      {on && !media.url && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1 text-[11px] font-medium text-text-muted hover:text-text-primary hover:border-wcs-red/40 transition-colors disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add attachment
        </button>
      )}

      {on && media.url && (
        <>
          {/* The thumbnail is the obvious thing to click, so it opens the full
              image too - the same target as View beside it. */}
          <a href={media.url} target="_blank" rel="noreferrer" title="Open the full image">
            <img
              src={media.url}
              alt=""
              className="h-8 w-8 rounded object-cover border border-border hover:border-wcs-red/50 transition-colors"
            />
          </a>
          <a
            href={media.url}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] rounded-md border border-border px-2 py-0.5 font-medium text-text-muted hover:text-text-primary transition-colors"
          >
            View
          </a>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="text-[11px] rounded-md border border-border px-2 py-0.5 font-medium text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
          >
            Replace
          </button>
          {/* Two different things worth copying: the token that goes into the
              GHL workflow, and the raw URL for anywhere else. */}
          <CopyButton text={`{{ ${media.key} }}`} label="Copy token" />
          <CopyButton text={media.url} label="Copy link" />
          <span className="text-[10px] font-mono text-text-muted truncate max-w-[200px]" title={media.key}>
            {'{{ ' + media.key + ' }}'}
          </span>
        </>
      )}

      {busy && <span className="text-[11px] text-text-muted">Working…</span>}
      {note && <span className="text-[11px] text-text-muted">{note}</span>}
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  )
}

function CopyButton({ text, className = '', label = 'Copy' }) {
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
      {copied ? 'Copied!' : label}
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

export default function DripCampaigns() {
  const [locations, setLocations] = useState([])
  const [location, setLocation] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [flow, setFlow] = useState('all')
  const [testing, setTesting] = useState(null)
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

  // Bumped after a media change so the row re-reads what GHL now holds, rather
  // than trusting an optimistic local edit.
  const [reloadTick, setReloadTick] = useState(0)
  const reload = () => setReloadTick(t => t + 1)

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
  }, [location, reloadTick])

  // Standard GHL tokens plus this club's own custom values and contact custom
  // fields, so the picker covers everything that actually resolves here.
  const pickerGroups = useMemo(() => {
    const groups = []
    const cvs = (data?.customValues || []).filter(cv => cv.token).sort(byDripOrder)
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
  const rows = (data?.customValues || []).slice().sort(byDripOrder)
    .filter(cv => inFlow(cv, flow))
    .filter(cv =>
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

        <div className="flex flex-wrap items-center gap-1.5 mt-4">
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

          <label className="ml-2 flex items-center gap-1.5">
            <span className="sr-only">Filter by flow</span>
            <select
              value={flow}
              onChange={e => setFlow(e.target.value)}
              className="text-xs bg-surface border border-border rounded-lg px-2.5 py-1.5 font-medium text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
            >
              {FLOWS.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </label>
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
            {!data.customValues?.length
              ? `No custom values in ${activeLocation?.name || 'this account'}.`
              : flow === 'all'
                ? 'No custom values match that search.'
                : `No ${FLOW_BY_KEY[flow]?.label} custom values${q ? ' match that search' : ''} in ${activeLocation?.name || 'this account'}.`}
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
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setTesting(cv)}
                    className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary transition-colors whitespace-nowrap"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => { setSaveError(null); setEditing(cv) }}
                    className="text-xs bg-surface border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary transition-colors whitespace-nowrap"
                  >
                    Edit
                  </button>
                </div>
              </div>
              <div className="mt-2 rounded-lg bg-bg border border-border px-3 py-2">
                <ValuePreview value={cv.value} />
              </div>
              {cv.fieldKey && (
                <MediaControl
                  locationSlug={location}
                  cv={cv}
                  onChanged={() => reload()}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {testing && (
        <TestSendPanel
          locationSlug={location}
          locationName={activeLocation?.name || ''}
          label={testing.name}
          text={testing.value || ''}
          mediaUrl={testing.media?.on ? testing.media.url : ''}
          onClose={() => setTesting(null)}
        />
      )}

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
