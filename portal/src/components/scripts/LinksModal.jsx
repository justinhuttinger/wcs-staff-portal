import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { updateCustomValue } from '../../lib/api'
import { collectClubLinks, replaceLink } from '../../lib/messageLinks'

// Every link in a club's texts, call scripts and emails, grouped by URL.
// Changing one rewrites it in each message that uses it, one GHL save per
// message, so a club's tour page or join offer can be swapped in one place.
export default function LinksModal({ locationSlug, locationName, customValues, onUpdated, onClose }) {
  const links = useMemo(() => collectClubLinks(customValues), [customValues])
  const [editing, setEditing] = useState(null)   // url being edited
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(null)         // { done, total }
  const [result, setResult] = useState(null)     // { url, ok, failed: [names] }
  const [openUses, setOpenUses] = useState(null)

  async function applyChange(link) {
    const next = draft.trim()
    if (!next || next === link.url) { setEditing(null); return }
    const byId = new Map(customValues.map(cv => [cv.id, cv]))
    // One save per message, even if it holds the link in more than one form.
    const targets = [...new Set(link.uses.map(u => u.id))].map(id => byId.get(id)).filter(Boolean)
    const failed = []
    setBusy({ done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i++) {
      const cv = targets[i]
      const value = link.variants.reduce((v, variant) => replaceLink(v, variant, next), cv.value || '')
      try {
        if (value !== cv.value) {
          await updateCustomValue(locationSlug, cv.id, { name: cv.name, value })
          onUpdated(cv.id, value)
        }
      } catch {
        failed.push(cv.name)
      }
      setBusy({ done: i + 1, total: targets.length })
    }
    setBusy(null)
    setEditing(null)
    setResult({ url: next, ok: targets.length - failed.length, failed })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onMouseDown={() => { if (!busy) onClose() }}>
      <div className="bg-surface border border-border rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden" onMouseDown={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text-primary">Links in {locationName}</h3>
            <p className="text-xs text-text-muted mt-0.5">Every link in this club&rsquo;s texts, call scripts and emails. Change one and it&rsquo;s updated in every message that uses it.</p>
          </div>
          <button onClick={onClose} disabled={!!busy} className="text-text-muted hover:text-text-primary text-xl leading-none px-1 disabled:opacity-40" aria-label="Close">&times;</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-2">
          {result && (
            <div className={'rounded-lg border px-3 py-2 text-xs ' + (result.failed.length ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
              {result.failed.length
                ? <>Updated {result.ok}. Couldn&rsquo;t save: {result.failed.join(', ')}. Try those again.</>
                : <>Updated in {result.ok} message{result.ok === 1 ? '' : 's'} and saved to GHL.</>}
            </div>
          )}
          {links.length === 0 && <p className="text-sm text-text-muted py-4">No links found in this club&rsquo;s messages.</p>}
          {links.map(link => (
            <div key={link.url} className="border border-border rounded-xl p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-wcs-red/10 text-wcs-red">{link.label}</span>
                    <button type="button" onClick={() => setOpenUses(openUses === link.url ? null : link.url)}
                      className="text-[11px] font-semibold text-text-muted hover:text-text-primary">
                      Used in {link.uses.length} message{link.uses.length === 1 ? '' : 's'} {openUses === link.url ? '▴' : '▾'}
                    </button>
                  </div>
                  <a href={/^https?:/i.test(link.url) ? link.url : 'https://' + link.url} target="_blank" rel="noopener noreferrer"
                    className="block mt-1 text-xs font-mono text-text-primary break-all hover:underline">{link.url}</a>
                  {link.texts.length > 0 && <p className="text-[11px] text-text-muted mt-0.5">Button or link text: {link.texts.join(' · ')}</p>}
                </div>
                {editing !== link.url && (
                  <button disabled={!!busy} onClick={() => { setEditing(link.url); setDraft(link.url); setResult(null) }}
                    className="shrink-0 text-xs bg-surface border border-border rounded-lg px-3 py-1.5 font-medium text-text-muted hover:text-text-primary disabled:opacity-40">Change</button>
                )}
              </div>
              {openUses === link.url && (
                <ul className="mt-2 text-[11px] text-text-muted list-disc pl-5">
                  {link.uses.map(u => <li key={u.id}>{u.name}</li>)}
                </ul>
              )}
              {editing === link.url && (
                <div className="mt-3 space-y-2">
                  <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} disabled={!!busy}
                    className="w-full text-xs font-mono bg-bg border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30" />
                  <div className="flex items-center gap-2">
                    <button onClick={() => applyChange(link)} disabled={!!busy || !draft.trim()}
                      className="text-xs bg-wcs-red text-white rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50">
                      {busy ? `Updating ${busy.done} of ${busy.total}...` : `Change in all ${link.uses.length}`}
                    </button>
                    <button onClick={() => setEditing(null)} disabled={!!busy} className="text-xs text-text-muted hover:text-text-primary disabled:opacity-40">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
