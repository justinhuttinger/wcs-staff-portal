import { useState } from 'react'
import {
  KINDS, WAIT_UNITS, ACTION_TYPES, CHANGE_FLAGS, MERGE_FIELDS, newId, smsSegments, waitSummary,
} from './kinds'
import { KindIcon, MergeText } from './StepNode'
import { inputCls, btnGhost } from './ui'
import EmailHtmlPreview, { EmailPreviewModal, WidthToggle, looksLikeHtml } from './EmailHtmlPreview'

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  if (!text) return null
  return (
    <button type="button"
      onClick={() => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      className={`px-2 py-0.5 rounded text-[11px] font-semibold border transition-colors ${copied ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'border-border text-text-muted hover:text-text-primary'}`}>
      {copied ? 'Copied!' : label}
    </button>
  )
}

function Field({ label, children, extra }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs font-semibold text-text-muted">{label}</label>
        {extra}
      </div>
      {children}
    </div>
  )
}

function ReadBlock({ label, text, copy = true }) {
  if (!text) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-text-muted">{label}</span>
        {copy && <CopyButton text={text} />}
      </div>
      <div className="rounded-lg border border-border bg-bg p-3 text-sm text-text-primary whitespace-pre-wrap break-words"><MergeText text={text} /></div>
    </div>
  )
}

function SmsMeta({ text }) {
  const s = smsSegments(text)
  if (!s.chars) return null
  return <span className="text-[11px] text-text-muted">{s.chars} chars · {s.segments} SMS{s.unicode ? ' (emoji/special chars)' : ''}</span>
}

// Inserts a merge field at the caret of the most recently focused textarea.
function MergeFieldPicker({ onPick }) {
  return (
    <select className="text-[11px] rounded border border-border bg-bg text-text-muted px-1 py-0.5" value=""
      onChange={e => { if (e.target.value) onPick(e.target.value) }}>
      <option value="">+ Merge field</option>
      {MERGE_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
    </select>
  )
}

function BodyEditor({ label, value, onChange, onFocus, rows = 6, sms = false, mono = false, placeholder }) {
  const [el, setEl] = useState(null)
  function insert(field) {
    const v = value || ''
    const start = el?.selectionStart ?? v.length
    const end = el?.selectionEnd ?? v.length
    onFocus?.()
    onChange(v.slice(0, start) + field + v.slice(end))
    requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = el.selectionEnd = start + field.length } })
  }
  return (
    <Field label={label} extra={<MergeFieldPicker onPick={insert} />}>
      <textarea ref={setEl} className={inputCls + (mono ? ' font-mono text-xs' : ' font-normal')} spellCheck={!mono} rows={rows} value={value || ''} placeholder={placeholder}
        onFocus={onFocus} onChange={e => onChange(e.target.value)} />
      {sms && <div className="mt-1"><SmsMeta text={value} /></div>}
    </Field>
  )
}

const BODY_LABEL = {
  trigger: 'Trigger details (form, tag, filters)',
  sms: 'Message',
  email: 'Email body',
  call: 'Call script',
  action: 'Details',
  goal: 'Details',
  note: 'Note',
}

export default function NodePanel({ node, readOnly, onChange, onBeforeEdit, onDelete, onDuplicate, onClose, edgesFromBranch }) {
  const [previewWidth, setPreviewWidth] = useState('desktop')
  const [fullPreview, setFullPreview] = useState(false)
  if (!node) return null
  const { type, data } = node
  const isHtmlEmail = type === 'email' && data.bodyFormat === 'html'
  const modal = fullPreview && isHtmlEmail && (
    <EmailPreviewModal subject={data.subject} previewText={data.previewText} html={data.body} onClose={() => setFullPreview(false)} />
  )
  const kind = KINDS[type] || KINDS.note
  const set = (patch) => onChange(node.id, patch)
  // One undo step per field focus, not per keystroke.
  const focus = () => onBeforeEdit()

  const header = (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-border" style={{ background: kind.color + '14' }}>
      <span className="flex items-center justify-center w-7 h-7 rounded-md text-white shrink-0" style={{ background: kind.color }}>
        <KindIcon type={type} className="w-4 h-4" />
      </span>
      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: kind.color }}>{kind.label}</span>
      <button onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary text-xl leading-none px-1" aria-label="Close panel">&times;</button>
    </div>
  )

  if (readOnly) {
    const flag = CHANGE_FLAGS[data.change || '']
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <h3 className="text-lg font-bold text-text-primary leading-snug">{data.title || kind.label}</h3>
          {flag?.color && <span className="inline-block px-2 py-0.5 rounded text-[11px] font-semibold text-white" style={{ background: flag.color }}>{flag.label}</span>}
          {type === 'wait' && <ReadBlock label="Wait" text={waitSummary(data)} copy={false} />}
          {type === 'action' && <ReadBlock label="Action" text={data.actionType} copy={false} />}
          {type === 'condition' && (
            <div>
              <span className="text-xs font-semibold text-text-muted">Branches</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(data.branches || []).map(b => <span key={b.id} className="px-2 py-1 rounded border border-border bg-bg text-xs font-semibold text-text-primary">{b.label}</span>)}
              </div>
            </div>
          )}
          {isHtmlEmail && (
            <div className="space-y-2">
              <div className="rounded-lg border border-border bg-bg px-3 py-2 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-primary"><MergeText text={data.subject || '(no subject)'} /></div>
                  <CopyButton text={data.subject} />
                </div>
                {data.previewText && <div className="text-xs text-text-muted"><MergeText text={data.previewText} /></div>}
              </div>
              {data.body ? <EmailHtmlPreview html={data.body} onClick={() => setFullPreview(true)} /> : <p className="text-xs text-text-muted">No email HTML yet.</p>}
              {data.body && (
                <div className="flex gap-2">
                  <button type="button" className={btnGhost} onClick={() => setFullPreview(true)}>Full preview</button>
                  <CopyButton text={data.body} label="Copy HTML" />
                </div>
              )}
            </div>
          )}
          {type === 'email' && !isHtmlEmail && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-bg px-3 py-2 border-b border-border space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-text-primary"><MergeText text={data.subject || '(no subject)'} /></div>
                  <CopyButton text={data.subject} />
                </div>
                {data.previewText && <div className="text-xs text-text-muted"><MergeText text={data.previewText} /></div>}
              </div>
              <div className="p-3 text-sm text-text-primary whitespace-pre-wrap break-words"><MergeText text={data.body} /></div>
              {data.body && <div className="px-3 pb-3"><CopyButton text={data.body} /></div>}
            </div>
          )}
          {type !== 'email' && <ReadBlock label={BODY_LABEL[type] || 'Details'} text={data.body} copy={type === 'sms' || type === 'call'} />}
          {type === 'sms' && <SmsMeta text={data.body} />}
          {data.link && (
            <a href={data.link} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-border bg-bg text-sm font-semibold text-text-primary hover:border-text-muted">
              Open full copy
            </a>
          )}
          {data.notes && <ReadBlock label="Internal notes" text={data.notes} copy={false} />}
        </div>
        {modal}
      </div>
    )
  }

  const branches = data.branches || []
  function setBranch(id, label) { set({ branches: branches.map(b => b.id === id ? { ...b, label } : b) }) }
  function addBranch() { focus(); set({ branches: [...branches, { id: newId('b'), label: 'Branch ' + (branches.length + 1) }] }) }

  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <Field label="Title">
          <input className={inputCls} value={data.title || ''} onFocus={focus} onChange={e => set({ title: e.target.value })} />
        </Field>

        {type === 'email' && (
          <>
            <Field label="Subject line"><input className={inputCls} value={data.subject || ''} onFocus={focus} onChange={e => set({ subject: e.target.value })} /></Field>
            <Field label="Preview text"><input className={inputCls} value={data.previewText || ''} onFocus={focus} onChange={e => set({ previewText: e.target.value })} /></Field>
            <Field label="Body format">
              <div className="flex gap-1 bg-bg rounded-lg p-1">
                {[['text', 'Plain text'], ['html', 'HTML (rendered)']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => { focus(); set({ bodyFormat: k }) }}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${(data.bodyFormat || 'text') === k ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>{l}</button>
                ))}
              </div>
            </Field>
          </>
        )}

        {type === 'wait' && (
          <>
            <Field label="Wait for">
              <div className="flex gap-1 bg-bg rounded-lg p-1">
                {[['duration', 'A set time'], ['until', 'Until an event']].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => { focus(); set({ waitMode: k }) }}
                    className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold ${(data.waitMode || 'duration') === k ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted'}`}>{l}</button>
                ))}
              </div>
            </Field>
            {(data.waitMode || 'duration') === 'duration' ? (
              <div className="flex gap-2">
                <input type="number" min="0" className={inputCls + ' w-24'} value={data.waitAmount ?? 1} onFocus={focus} onChange={e => set({ waitAmount: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })} />
                <select className={inputCls} value={data.waitUnit || 'days'} onFocus={focus} onChange={e => set({ waitUnit: e.target.value })}>
                  {WAIT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            ) : (
              <input className={inputCls} value={data.waitUntil || ''} onFocus={focus} onChange={e => set({ waitUntil: e.target.value })} placeholder="e.g. 1 hour before appointment, reply received" />
            )}
          </>
        )}

        {type === 'action' && (
          <Field label="Action type">
            <select className={inputCls} value={data.actionType || 'Other'} onFocus={focus} onChange={e => set({ actionType: e.target.value })}>
              {ACTION_TYPES.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
        )}

        {type === 'condition' && (
          <Field label="Branches">
            <div className="space-y-1.5">
              {branches.map(b => (
                <div key={b.id} className="flex gap-1.5">
                  <input className={inputCls} value={b.label} onFocus={focus} onChange={e => setBranch(b.id, e.target.value)} />
                  <button type="button" disabled={branches.length <= 2}
                    title={edgesFromBranch(b.id) ? 'Also removes its connection' : 'Remove branch'}
                    onClick={() => { focus(); set({ branches: branches.filter(x => x.id !== b.id) }) }}
                    className="px-2 rounded-lg border border-border text-text-muted hover:text-wcs-red disabled:opacity-30">&times;</button>
                </div>
              ))}
              <button type="button" className={btnGhost} onClick={addBranch}>+ Add branch</button>
            </div>
          </Field>
        )}

        {type !== 'wait' && type !== 'condition' && (
          <BodyEditor label={isHtmlEmail ? 'Email HTML' : (BODY_LABEL[type] || 'Details')} value={data.body} onFocus={focus} onChange={v => set({ body: v })}
            rows={isHtmlEmail ? 8 : type === 'email' ? 10 : 5} sms={type === 'sms'} mono={isHtmlEmail}
            placeholder={type === 'sms' ? 'Hey {{contact.first_name}}...' : isHtmlEmail ? 'Paste the email HTML from GHL or your email builder' : undefined} />
        )}

        {type === 'email' && !isHtmlEmail && looksLikeHtml(data.body) && (
          <button type="button" onClick={() => { focus(); set({ bodyFormat: 'html' }) }}
            className="w-full text-left rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
            This looks like HTML. Show it as a rendered email
          </button>
        )}

        {isHtmlEmail && data.body && (
          <Field label="Preview" extra={<WidthToggle value={previewWidth} onChange={setPreviewWidth} />}>
            <EmailHtmlPreview html={data.body} width={previewWidth} onClick={() => setFullPreview(true)} />
            <button type="button" className={btnGhost + ' mt-2'} onClick={() => setFullPreview(true)}>Full preview</button>
          </Field>
        )}

        {type !== 'note' && (
          <>
            <Field label="Link to full copy (Google Doc, etc.)">
              <input className={inputCls} value={data.link || ''} onFocus={focus} onChange={e => set({ link: e.target.value.trim() })} placeholder="https://docs.google.com/..." />
            </Field>
            <Field label="Internal notes">
              <textarea className={inputCls} rows={3} value={data.notes || ''} onFocus={focus} onChange={e => set({ notes: e.target.value })} placeholder="Not shown to the member" />
            </Field>
            <Field label="GHL status">
              <select className={inputCls} value={data.change || ''} onFocus={focus} onChange={e => set({ change: e.target.value })}>
                {Object.entries(CHANGE_FLAGS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
              </select>
            </Field>
          </>
        )}
      </div>
      <div className="flex gap-2 p-3 border-t border-border">
        <button className={btnGhost + ' flex-1'} onClick={onDuplicate}>Duplicate</button>
        <button className="flex-1 px-3 py-1.5 rounded-lg border border-wcs-red/40 text-xs font-semibold text-wcs-red hover:bg-wcs-red/10" onClick={onDelete}>Delete step</button>
      </div>
      {modal}
    </div>
  )
}
