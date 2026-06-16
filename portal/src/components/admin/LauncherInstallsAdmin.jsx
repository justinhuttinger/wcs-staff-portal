import { useState, useEffect, useMemo } from 'react'
import {
  getKioskInstalls, setKioskInstallTarget, deleteKioskInstall,
  getKioskLinks, createKioskLink, getLocations,
} from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'

const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red'
const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'

function timeAgo(iso) {
  if (!iso) return '—'
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 90) return 'just now'
  const mins = secs / 60
  if (mins < 60) return `${Math.round(mins)}m ago`
  const hrs = mins / 60
  if (hrs < 48) return `${Math.round(hrs)}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// Copy button with the required "Copied!" confirmation animation.
function CopyButton({ text, label = 'Copy', className = '' }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return (
    <button
      onClick={handleCopy}
      className={`relative ${btnGhost} ${className} ${copied ? '!bg-green-100 !text-green-700 !border-green-300' : ''}`}
    >
      <span className={copied ? 'opacity-0' : 'opacity-100'}>{label}</span>
      {copied && (
        <span className="absolute inset-0 flex items-center justify-center gap-1 text-green-700">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" /></svg>
          Copied!
        </span>
      )}
    </button>
  )
}

export default function LauncherInstallsAdmin() {
  const [installs, setInstalls] = useState([])
  const [links, setLinks] = useState([])
  const [abcByLocation, setAbcByLocation] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState({}) // id -> { location, abc_url }
  const [savingId, setSavingId] = useState(null)

  // Standalone "generate link" form
  const [linkLoc, setLinkLoc] = useState(LOCATION_NAMES[0])
  const [linkAbc, setLinkAbc] = useState('')
  const [minting, setMinting] = useState(false)

  function load() {
    setLoading(true)
    Promise.all([getKioskInstalls(), getKioskLinks(), getLocations()])
      .then(([inst, lnk, locs]) => {
        setInstalls(inst.installs || [])
        setLinks(lnk.links || [])
        const map = {}
        for (const l of locs.locations || locs || []) if (l.name) map[l.name] = l.abc_url || ''
        setAbcByLocation(map)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // Default the standalone link form's ABC URL to the picked club's URL.
  useEffect(() => { setLinkAbc(abcByLocation[linkLoc] || '') }, [linkLoc, abcByLocation])

  const draftFor = (it) => drafts[it.id] || {
    location: it.target_location || it.location || '',
    abc_url: it.target_abc_url || it.abc_url || '',
  }
  function setDraft(id, patch) {
    setDrafts(d => ({ ...d, [id]: { ...draftFor(installs.find(i => i.id === id)), ...d[id], ...patch } }))
  }
  // When the location dropdown changes, follow it with that club's ABC URL.
  function pickLocation(it, name) {
    setDraft(it.id, { location: name, abc_url: abcByLocation[name] || '' })
  }

  async function saveTarget(it) {
    const d = draftFor(it)
    setSavingId(it.id); setError('')
    try {
      const res = await setKioskInstallTarget(it.id, { target_location: d.location, target_abc_url: d.abc_url })
      setInstalls(list => list.map(x => x.id === it.id ? res.install : x))
      setDrafts(dd => { const n = { ...dd }; delete n[it.id]; return n })
    } catch (err) { setError(err.message) } finally { setSavingId(null) }
  }

  async function clearTarget(it) {
    setSavingId(it.id); setError('')
    try {
      const res = await setKioskInstallTarget(it.id, { target_location: null })
      setInstalls(list => list.map(x => x.id === it.id ? res.install : x))
    } catch (err) { setError(err.message) } finally { setSavingId(null) }
  }

  async function removeInstall(it) {
    if (!confirm(`Remove ${it.hostname || it.install_id} from the list? It reappears if the machine checks in again.`)) return
    try {
      await deleteKioskInstall(it.id)
      setInstalls(list => list.filter(x => x.id !== it.id))
    } catch (err) { setError(err.message) }
  }

  // Mint a one-time link for a specific machine (its current draft location).
  async function mintForInstall(it) {
    const d = draftFor(it)
    try {
      const res = await createKioskLink({ location: d.location, abc_url: d.abc_url, install_id: it.install_id })
      setLinks(l => [res.link, ...l])
    } catch (err) { setError(err.message) }
  }

  async function mintStandalone() {
    setMinting(true); setError('')
    try {
      const res = await createKioskLink({ location: linkLoc, abc_url: linkAbc })
      setLinks(l => [res.link, ...l])
    } catch (err) { setError(err.message) } finally { setMinting(false) }
  }

  const activeLinks = useMemo(() => links.filter(l => l.status === 'active'), [links])

  if (loading) return <p className="text-sm text-text-muted bg-surface border border-border rounded-xl p-6 text-center">Loading installs...</p>

  return (
    <div className="space-y-5">
      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {/* Installs table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <p className="text-sm font-bold text-text-primary">Installed Machines <span className="text-text-muted font-normal">({installs.length})</span></p>
            <p className="text-xs text-text-muted">Set a target location and the machine applies it on its next check-in (within ~15 min). The ABC link follows the location automatically.</p>
          </div>
          <button onClick={load} className={btnGhost}>Refresh</button>
        </div>

        {installs.length === 0 ? (
          <p className="text-sm text-text-muted p-8 text-center">No machines have checked in yet. They register on the next launcher update + restart.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <th className="py-2.5 px-4">Machine</th>
                  <th className="py-2.5 px-2">Current</th>
                  <th className="py-2.5 px-2">Set Location</th>
                  <th className="py-2.5 px-2">ABC URL</th>
                  <th className="py-2.5 px-2">Version</th>
                  <th className="py-2.5 px-2">Last Seen</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {installs.map(it => {
                  const d = draftFor(it)
                  const pending = it.target_location && it.target_location !== it.location
                  return (
                    <tr key={it.id} className="border-b border-border/50 align-top">
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-text-primary">{it.hostname || '—'}</span>
                        <span className="block text-[10px] text-text-muted font-mono">{it.install_id?.slice(0, 8)}</span>
                      </td>
                      <td className="py-2.5 px-2">
                        <span className="capitalize text-text-primary">{it.location || '—'}</span>
                        {pending && <span className="block text-[10px] font-bold uppercase text-amber-600">→ {it.target_location} pending</span>}
                      </td>
                      <td className="py-2.5 px-2">
                        <select value={d.location} onChange={e => pickLocation(it, e.target.value)} className={inputCls + ' w-32'}>
                          <option value="">—</option>
                          {LOCATION_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </td>
                      <td className="py-2.5 px-2">
                        <input value={d.abc_url} onChange={e => setDraft(it.id, { abc_url: e.target.value })}
                          placeholder="ABC URL (follows location)" className={inputCls + ' w-56 font-mono text-[11px]'} />
                      </td>
                      <td className="py-2.5 px-2 text-text-muted">{it.app_version || '—'}</td>
                      <td className="py-2.5 px-2 text-text-muted whitespace-nowrap">{timeAgo(it.last_seen_at)}</td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <button onClick={() => saveTarget(it)} disabled={savingId === it.id || !d.location} className={btnPrimary + ' mr-2'}>
                          {savingId === it.id ? '...' : 'Set'}
                        </button>
                        <button onClick={() => mintForInstall(it)} disabled={!d.location} className={btnGhost + ' mr-2'}>Link</button>
                        {pending && <button onClick={() => clearTarget(it)} className={btnGhost + ' mr-2'}>Cancel</button>}
                        <button onClick={() => removeInstall(it)} className="text-xs font-semibold text-wcs-red hover:underline">Remove</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Generate a standalone one-time link */}
      <div className="bg-surface border border-border rounded-xl p-4">
        <p className="text-sm font-bold text-text-primary mb-1">Generate a one-time link</p>
        <p className="text-xs text-text-muted mb-3">Send this to a team member. When they click it on their machine, Portal applies the location + ABC link and reloads. Single-use, expires in 72 hours.</p>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">Location</span>
            <select value={linkLoc} onChange={e => setLinkLoc(e.target.value)} className={inputCls + ' w-40'}>
              {LOCATION_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[260px]">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">ABC URL</span>
            <input value={linkAbc} onChange={e => setLinkAbc(e.target.value)} className={inputCls + ' w-full font-mono text-[11px]'} />
          </div>
          <button onClick={mintStandalone} disabled={minting} className={btnPrimary}>{minting ? 'Creating...' : 'Create Link'}</button>
        </div>
      </div>

      {/* Recent links */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border">
          <p className="text-sm font-bold text-text-primary">Recent Links <span className="text-text-muted font-normal">({activeLinks.length} active)</span></p>
        </div>
        {links.length === 0 ? (
          <p className="text-sm text-text-muted p-6 text-center">No links generated yet.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {links.map(l => (
              <div key={l.id} className="flex items-center justify-between gap-3 px-4 py-2.5 flex-wrap">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-text-primary capitalize">{l.location}</span>
                  {l.install_id && <span className="text-[10px] text-text-muted ml-2">machine {l.install_id.slice(0, 8)}</span>}
                  <span className="block text-[11px] font-mono text-text-muted truncate max-w-[420px]">{l.url}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                    l.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : l.status === 'used' ? 'bg-bg text-text-muted border-border'
                    : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{l.status}</span>
                  {l.status === 'active' && <CopyButton text={l.url} label="Copy Link" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
