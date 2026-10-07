import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { updateCustomValue, createCustomValue } from '../../lib/api'
import { emailPairs, findLinks, replaceLink, setPreheader } from '../../lib/messageLinks'
import EmailHtmlPreview, { EmailPreviewModal, WidthToggle } from '../workflowMaps/EmailHtmlPreview'

const input = 'w-full text-sm bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30'
const ghost = 'text-xs bg-surface border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary transition-colors whitespace-nowrap disabled:opacity-40'

function EmailEditor({ locationSlug, locationName, pair, onSaved, onClose }) {
  const [subject, setSubject] = useState(pair.subject?.value || '')
  const [preview, setPreview] = useState(pair.preview?.value || '')
  const [html, setHtml] = useState(pair.html?.value || '')
  const [tab, setTab] = useState('preview')
  const [width, setWidth] = useState('desktop')
  const [full, setFull] = useState(false)
  const [editingLink, setEditingLink] = useState(null)
  const [linkDraft, setLinkDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const links = useMemo(() => findLinks(html), [html])
  const previewChanged = !!pair.preview && preview !== (pair.preview.value || '')
  const dirty = subject !== (pair.subject?.value || '') || previewChanged || html !== (pair.html?.value || '')

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (pair.subject && subject !== pair.subject.value) {
        await updateCustomValue(locationSlug, pair.subject.id, { name: pair.subject.name, value: subject })
        onSaved(pair.subject.id, subject)
      }
      if (previewChanged) {
        await updateCustomValue(locationSlug, pair.preview.id, { name: pair.preview.name, value: preview })
        onSaved(pair.preview.id, preview)
      }
      // The HTML carries its own hidden copy of the preview line; keep it
      // matching the Preview value.
      const finalHtml = previewChanged ? setPreheader(html, preview) : html
      if (pair.html && finalHtml !== pair.html.value) {
        await updateCustomValue(locationSlug, pair.html.id, { name: pair.html.name, value: finalHtml })
        onSaved(pair.html.id, finalHtml)
      }
      onClose()
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return createPortal(
    <>
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={() => { if (!saving) onClose() }}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-6xl max-h-[94vh] flex flex-col overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border">
          <h3 className="text-base font-bold text-text-primary">{pair.base}</h3>
          <p className="text-xs text-text-muted mt-0.5">{locationName} · saves straight to GHL</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
            <div className="space-y-3 min-w-0">
              <div>
                <label className="block text-xs font-semibold text-text-primary mb-1">Subject</label>
                {pair.subject
                  ? <input className={input} value={subject} onChange={e => setSubject(e.target.value)} />
                  : <p className="text-xs text-amber-700">No "{pair.base} Subject" custom value in this club.</p>}
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-text-primary">Preview text</label>
                  {pair.preview && <span className={'text-[11px] ' + (preview.length && (preview.length < 40 || preview.length > 90) ? 'text-amber-700' : 'text-text-muted')}>{preview.length} chars, aim for 40 to 90</span>}
                </div>
                {pair.preview
                  ? <input className={input} value={preview} onChange={e => setPreview(e.target.value)} placeholder="The line inboxes show after the subject" />
                  : <p className="text-xs text-amber-700">No "{pair.base} Preview" custom value in this club.</p>}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1 bg-bg rounded-lg p-1">
                  {[['preview', 'Preview'], ['html', 'HTML']].map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)}
                      className={`px-3 py-1 rounded-md text-xs font-semibold ${tab === k ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>{l}</button>
                  ))}
                </div>
                {tab === 'preview' && (
                  <div className="flex items-center gap-2">
                    <WidthToggle value={width} onChange={setWidth} />
                    <button className={ghost} onClick={() => setFull(true)} disabled={!html}>Full size</button>
                  </div>
                )}
              </div>
              {!pair.html && <p className="text-xs text-amber-700">No "{pair.base} HTML" custom value in this club.</p>}
              {pair.html && tab === 'preview' && (
                html ? <EmailHtmlPreview html={html} width={width} onClick={() => setFull(true)} />
                  : <p className="text-sm text-text-muted py-6">No HTML yet. Paste it in the HTML tab.</p>
              )}
              {pair.html && tab === 'html' && (
                <textarea value={html} onChange={e => setHtml(e.target.value)} spellCheck={false} rows={22}
                  className={input + ' font-mono text-xs'} placeholder="Paste the email HTML" />
              )}
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-text-primary">Links in this email</h4>
              <p className="text-[11px] text-text-muted">To change a link in every message in the club, use Links at the top of the page.</p>
              {links.length === 0 && <p className="text-xs text-text-muted">No links found.</p>}
              {links.map(l => (
                <div key={l.url} className="border border-border rounded-lg p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-wcs-red/10 text-wcs-red">{l.label}</span>
                    {editingLink !== l.url && (
                      <button className="text-[11px] font-semibold text-text-muted hover:text-text-primary" onClick={() => { setEditingLink(l.url); setLinkDraft(l.url) }}>Change</button>
                    )}
                  </div>
                  {l.texts.length > 0 && <p className="text-[11px] text-text-muted mt-1">{l.texts.join(' · ')}</p>}
                  {editingLink === l.url ? (
                    <div className="mt-1.5 space-y-1.5">
                      <input autoFocus value={linkDraft} onChange={e => setLinkDraft(e.target.value)} className={input + ' font-mono text-xs'} />
                      <div className="flex gap-2">
                        <button className="text-xs bg-wcs-red text-white rounded-lg px-3 py-1 font-semibold disabled:opacity-50" disabled={!linkDraft.trim()}
                          onClick={() => { setHtml(h => replaceLink(h, l.url, linkDraft.trim())); setEditingLink(null) }}>Use this link</button>
                        <button className="text-xs text-text-muted" onClick={() => setEditingLink(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] font-mono text-text-primary break-all mt-1">{l.url}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
          <button className={ghost} onClick={onClose} disabled={saving}>Cancel</button>
          <button className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-semibold disabled:opacity-50" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving to GHL...' : 'Save to GHL'}
          </button>
        </div>
      </div>
    </div>
    {/* Outside the backdrop: portal events bubble through React, so a click
        in the preview would otherwise close the editor too. */}
    {full && <EmailPreviewModal subject={subject} html={html} onClose={() => setFull(false)} />}
    </>,
    document.body,
  )
}

// The club's sender, shared by every email: "Email From Name" and
// "Email From Address". The workflows' Send Email actions use both.
function SenderCard({ locationSlug, sender, onSaved }) {
  const [name, setName] = useState(sender.name?.value || '')
  const [address, setAddress] = useState(sender.address?.value || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  if (!sender.name && !sender.address) return null
  const dirty = (sender.name && name !== (sender.name.value || '')) || (sender.address && address !== (sender.address.value || ''))

  async function save() {
    setBusy(true)
    setMsg(null)
    try {
      for (const [cv, value] of [[sender.name, name], [sender.address, address]]) {
        if (cv && value !== (cv.value || '')) {
          await updateCustomValue(locationSlug, cv.id, { name: cv.name, value })
          onSaved(cv.id, value)
        }
      }
      setMsg({ ok: true, text: 'Saved to GHL' })
    } catch (err) {
      setMsg({ ok: false, text: err.message })
    }
    setBusy(false)
  }

  return (
    <div className="border border-border rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-text-primary">Sender (all emails)</span>
        {msg && <span className={'text-[11px] font-medium ' + (msg.ok ? 'text-green-600' : 'text-red-500')}>{msg.text}</span>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-[11px] text-text-muted mb-0.5">From name</span>
          <input className={input} value={name} onChange={e => setName(e.target.value)} disabled={!sender.name || busy} />
        </label>
        <label className="block">
          <span className="block text-[11px] text-text-muted mb-0.5">From email</span>
          <input className={input} value={address} onChange={e => setAddress(e.target.value)} disabled={!sender.address || busy} />
        </label>
        <button className="text-xs bg-wcs-red text-white rounded-lg px-4 py-2 font-semibold disabled:opacity-50" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function NewEmailModal({ locationSlug, locationName, onCreated, onClose }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const base = (() => {
    const n = name.trim()
    return !n || /\bemail\b/i.test(n) ? n : n + ' Email'
  })()

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const s = await createCustomValue(locationSlug, { name: `${base} Subject`, value: 'Subject line' })
      onCreated(s.customValue)
      const p = await createCustomValue(locationSlug, { name: `${base} Preview`, value: 'Preview text' })
      onCreated(p.customValue)
      const h = await createCustomValue(locationSlug, { name: `${base} HTML`, value: '<!-- Paste the email HTML here -->' })
      onCreated(h.customValue)
      onClose()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-5 space-y-3" onMouseDown={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-text-primary">New email in {locationName}</h3>
        <p className="text-xs text-text-muted">Creates three custom values in GHL: the subject, the preview text and the HTML.</p>
        <input autoFocus className={input} placeholder="e.g. New Lead Email 9" value={name} onChange={e => setName(e.target.value)} />
        {base && <p className="text-[11px] text-text-muted">Creates <strong>{base} Subject</strong>, <strong>{base} Preview</strong> and <strong>{base} HTML</strong>.</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className={ghost} onClick={onClose} disabled={busy}>Cancel</button>
          <button className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-semibold disabled:opacity-50" disabled={!base || busy} onClick={create}>
            {busy ? 'Creating...' : 'Create in GHL'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// The Emails view of Workflows & Scripts: each email is a "<Name> Subject" and
// "<Name> HTML" custom value pair, shown rendered with its links listed.
export default function EmailsPanel({ locationSlug, locationName, customValues, search, onUpdated, onCreated, canCreate }) {
  const { pairs, sender } = useMemo(() => emailPairs(customValues), [customValues])
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const q = (search || '').trim().toLowerCase()
  const shown = pairs.filter(p => !q || p.base.toLowerCase().includes(q) || (p.subject?.value || '').toLowerCase().includes(q))

  return (
    <div className="space-y-2">
      <SenderCard key={locationSlug} locationSlug={locationSlug} sender={sender} onSaved={onUpdated} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-muted">{shown.length} email{shown.length === 1 ? '' : 's'}</p>
        {canCreate && <button className={ghost} onClick={() => setCreating(true)}>+ New email</button>}
      </div>
      {pairs.length === 0 && (
        <p className="text-sm text-text-muted py-4">No emails in {locationName} yet. Emails are custom value pairs named like "New Lead Email 1 Subject" and "New Lead Email 1 HTML".</p>
      )}
      {shown.map(p => {
        const linkCount = p.html ? findLinks(p.html.value).length : 0
        return (
          <button key={p.base} onClick={() => setOpen(p.base)} className="w-full text-left bg-surface border border-border rounded-xl p-3 hover:border-text-muted transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-text-primary">{p.base}</span>
                <p className="text-xs text-text-primary mt-0.5 truncate">{p.subject ? p.subject.value || '(no subject)' : 'Missing subject value'}</p>
                {p.preview?.value && <p className="text-[11px] text-text-muted truncate">{p.preview.value}</p>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!p.html && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">No HTML</span>}
                {!p.subject && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">No subject</span>}
                <span className="text-[11px] text-text-muted">{linkCount} link{linkCount === 1 ? '' : 's'}</span>
              </div>
            </div>
          </button>
        )
      })}
      {open && (() => {
        const pair = pairs.find(p => p.base === open)
        return pair ? <EmailEditor locationSlug={locationSlug} locationName={locationName} pair={pair} onSaved={onUpdated} onClose={() => setOpen(null)} /> : null
      })()}
      {creating && <NewEmailModal locationSlug={locationSlug} locationName={locationName} onCreated={onCreated} onClose={() => setCreating(false)} />}
    </div>
  )
}
