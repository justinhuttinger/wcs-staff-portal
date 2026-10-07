import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  getWorkflowTransferClubs, getWorkflowTransferList, checkWorkflowTransferSession, exportGhlWorkflow,
  previewWorkflowTransfer, pushWorkflowTransfer, getWorkflowSnapshots, getWorkflowSnapshot,
  getWorkflowFolder, prepareWorkflowDrafts,
} from '../lib/api'
import { getGhlSession, setGhlSession, clearGhlSession, GHL_SESSION_EVENT } from '../lib/ghlSession'
import { Button, ErrorBanner, EmptyState, Spinner, Modal } from './adsmanager/ui'

// Owner-only GHL workflow import/export. Exports one, many or every workflow as
// JSON, and copies workflows into other clubs with custom fields, users,
// calendars, pipelines, forms, tags and linked workflows remapped to each
// club's own records. Every overwrite is backed up first (Backups section).

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'
const EXPORT_CONCURRENCY = 4

function useGhlSession() {
  const [session, setSession] = useState(getGhlSession)
  const [, tick] = useState(0)
  useEffect(() => {
    const on = () => setSession(getGhlSession())
    window.addEventListener(GHL_SESSION_EVENT, on)
    // Re-render each minute so the countdown and expiry stay true.
    const t = setInterval(() => { tick(n => n + 1); on() }, 60_000)
    return () => { window.removeEventListener(GHL_SESSION_EVENT, on); clearInterval(t) }
  }, [])
  return session
}

function slugify(s) {
  return String(s || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'workflow'
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function pool(items, limit, fn) {
  let next = 0
  const run = async () => { while (next < items.length) { const i = next++; await fn(items[i], i) } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
}

let itemSeq = 0

const today = () => new Date().toISOString().slice(0, 10)
const isSessionError = err => err?.code === 'ghl_session'

function SessionBar({ session, clubs }) {
  const [paste, setPaste] = useState('')
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState('')
  const minutes = session?.expiresAt ? Math.max(0, Math.round((session.expiresAt - Date.now()) / 60000)) : null

  const check = async () => {
    setChecking(true); setMsg('')
    try {
      await checkWorkflowTransferSession(session.token, clubs[0]?.slug)
      setMsg('Session works.')
    } catch (err) {
      setMsg(err.message)
    } finally { setChecking(false) }
  }

  if (session) {
    return (
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 border border-green-500/30 font-semibold">
          GHL session{minutes !== null ? ` · ${minutes} min left` : ''}
        </span>
        <button onClick={check} disabled={checking} className="text-text-muted hover:text-text-primary">{checking ? 'Checking…' : 'Test'}</button>
        <button onClick={clearGhlSession} className="text-text-muted hover:text-text-primary">Forget</button>
        {msg && <span className="text-text-muted">{msg}</span>}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/30 font-semibold">No GHL session</span>
      <span className="text-text-muted">In GHL, click <b>Send to portal</b> (bottom left). Or paste it:</span>
      <input
        value={paste}
        onChange={e => setPaste(e.target.value)}
        placeholder="GHL session token"
        className="px-2 py-1 rounded border border-border bg-bg text-text-primary w-56"
      />
      <button
        onClick={() => { if (setGhlSession(paste)) setPaste(''); else setMsg('That is not a session token.') }}
        className="font-semibold text-wcs-red hover:underline"
      >Use</button>
      {msg && <span className="text-red-700">{msg}</span>}
    </div>
  )
}

// ── Source: pick a club + workflows, or load a JSON file ───────────────────
function SourcePanel({ clubs, session, onUse, onNeedSession }) {
  const [club, setClub] = useState(clubs[0]?.slug || '')
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [progress, setProgress] = useState(null)
  const fileRef = useRef(null)
  const latestLoad = useRef(0)
  // 'all' = every workflow (public API, no session); 'folders' = browse GHL's
  // folders (internal API, needs the session). folderStack is the path from
  // the top: [{ id, name }].
  const [view, setView] = useState('all')
  const [folderStack, setFolderStack] = useState([])
  const [folders, setFolders] = useState([])
  const folderId = folderStack.length ? folderStack[folderStack.length - 1].id : null
  const sessionToken = session?.token || null

  // A slow list for one club must never land after a newer club's list: each
  // load is numbered and only the latest one is applied. Every row also keeps
  // the club it came from, so an export always pairs an id with its own club.
  const load = useCallback(async (fresh) => {
    if (!club) return
    const seq = ++latestLoad.current
    setLoading(true); setError(''); setList([]); setFolders([])
    try {
      if (view === 'folders') {
        if (!sessionToken) { onNeedSession(); return }
        const data = await getWorkflowFolder(sessionToken, club, folderId)
        if (seq !== latestLoad.current) return
        setFolders(data.folders || [])
        setList((data.workflows || []).map(w => ({ ...w, club })))
      } else {
        const data = await getWorkflowTransferList(club, fresh)
        if (seq !== latestLoad.current) return
        setList((data.workflows || []).map(w => ({ ...w, club })))
      }
    } catch (err) {
      if (seq === latestLoad.current) setError(err.message)
    } finally {
      if (seq === latestLoad.current) setLoading(false)
    }
  }, [club, view, folderId, sessionToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPicked(new Set()); load(false) }, [load])
  // A new club starts at its top level.
  useEffect(() => { setFolderStack([]) }, [club])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? list.filter(w => w.name.toLowerCase().includes(q)) : list
  }, [list, search])

  const toggle = id => setPicked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allShownPicked = shown.length > 0 && shown.every(w => picked.has(w.id))
  const toggleAll = () => setPicked(prev => {
    const n = new Set(prev)
    if (allShownPicked) shown.forEach(w => n.delete(w.id)); else shown.forEach(w => n.add(w.id))
    return n
  })

  // Exports `items` ([{ club, id, name }]) with a few in flight at once.
  const exportMany = async (items, label) => {
    if (!session) { onNeedSession(); return null }
    setError('')
    const done = []
    const failed = []
    setProgress({ label, done: 0, total: items.length })
    try {
      await pool(items, EXPORT_CONCURRENCY, async (it) => {
        try {
          done.push(await exportGhlWorkflow(session.token, it.club, it.id))
        } catch (err) {
          if (isSessionError(err)) throw err
          failed.push({ club: it.club, id: it.id, name: it.name, error: err.message })
        }
        setProgress(p => p && { ...p, done: p.done + 1 })
      })
    } catch (err) {
      setError(err.message)
      setProgress(null)
      return null
    }
    setProgress(null)
    return { done, failed }
  }

  const pickedItems = () => list.filter(w => picked.has(w.id)).map(w => ({ club: w.club, id: w.id, name: w.name }))

  const download = (result, filename) => {
    if (!result) return
    if (result.done.length === 1 && !result.failed.length) {
      downloadJson(filename || `${slugify(result.done[0].name)}-${result.done[0].sourceClub}.json`, result.done[0])
    } else {
      downloadJson(filename, {
        format: 'wcs-ghl-workflow-bundle@1', exportedAt: new Date().toISOString(),
        count: result.done.length, workflows: result.done, failed: result.failed,
      })
    }
    if (result.failed.length) setError(`${result.failed.length} could not be exported (listed under "failed" in the file).`)
  }

  const exportPicked = async () => {
    const items = pickedItems()
    const r = await exportMany(items, 'Exporting')
    download(r, items.length === 1 ? `${slugify(items[0].name)}-${club}-${today()}.json` : `ghl-workflows-${club}-${items.length}-${today()}.json`)
  }

  const exportClub = async () => {
    const r = await exportMany(list.map(w => ({ club: w.club, id: w.id, name: w.name })), `Exporting all of ${clubs.find(c => c.slug === club)?.name}`)
    download(r, `ghl-workflows-${club}-all-${today()}.json`)
  }

  const exportEveryClub = async () => {
    if (!session) { onNeedSession(); return }
    setError('')
    const items = []
    try {
      for (const c of clubs) {
        const data = await getWorkflowTransferList(c.slug)
        for (const w of data.workflows || []) items.push({ club: c.slug, id: w.id, name: w.name })
      }
    } catch (err) { setError(err.message); return }
    const r = await exportMany(items, 'Exporting every club')
    download(r, `ghl-workflows-all-clubs-${today()}.json`)
  }

  const copyPicked = async () => {
    const r = await exportMany(pickedItems(), 'Loading')
    if (!r) return
    if (r.failed.length) setError(`${r.failed.length} could not be loaded: ${r.failed.map(f => f.name).join(', ')}`)
    if (r.done.length) onUse(r.done)
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    try {
      const data = JSON.parse(await file.text())
      const payloads = Array.isArray(data?.workflows) ? data.workflows : [data]
      if (!payloads.length) throw new Error('The file has no workflows')
      onUse(payloads)
    } catch (err) {
      setError(`Could not read ${file.name}: ${err.message}`)
    }
  }

  const busy = !!progress

  return (
    <div className={`${CARD} p-4 flex flex-col min-h-0`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">Source</h3>
        <button onClick={() => fileRef.current?.click()} className="text-xs font-semibold text-wcs-red hover:underline">Load JSON file</button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {clubs.map(c => (
          <button
            key={c.slug}
            onClick={() => setClub(c.slug)}
            className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${club === c.slug ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg border-border text-text-muted hover:text-text-primary'}`}
          >{c.name}</button>
        ))}
      </div>

      <div className="flex items-center gap-1 mb-2 text-xs">
        {[['all', 'All workflows'], ['folders', 'Folders']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => { setView(key); setFolderStack([]) }}
            className={`px-2.5 py-1 rounded-md font-semibold ${view === key ? 'bg-border/60 text-text-primary' : 'text-text-muted hover:text-text-primary'}`}
          >{label}</button>
        ))}
      </div>

      {view === 'folders' && (
        <div className="flex items-center gap-1 flex-wrap mb-2 text-xs">
          <button onClick={() => setFolderStack([])} className={`hover:underline ${folderStack.length ? 'text-wcs-red' : 'font-semibold text-text-primary'}`}>Top</button>
          {folderStack.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1">
              <span className="text-text-muted">›</span>
              <button
                onClick={() => setFolderStack(folderStack.slice(0, i + 1))}
                className={`hover:underline ${i === folderStack.length - 1 ? 'font-semibold text-text-primary' : 'text-wcs-red'}`}
              >{f.name}</button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 mb-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`Search ${list.length} workflows`}
          className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-bg text-sm text-text-primary"
        />
        <button onClick={() => load(true)} disabled={loading} className="text-xs text-text-muted hover:text-text-primary">Refresh</button>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <div className="flex-1 min-h-[240px] overflow-y-auto rounded-lg border border-border mt-2">
        {view === 'folders' && !loading && folders.map(f => (
          <button
            key={f.id}
            onClick={() => setFolderStack([...folderStack, { id: f.id, name: f.name }])}
            className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-border/50 text-left hover:bg-border/20"
          >
            <span aria-hidden="true">📁</span>
            <span className="flex-1 text-sm font-semibold text-text-primary truncate">{f.name}</span>
            <span className="text-text-muted text-xs">›</span>
          </button>
        ))}
        {loading ? <Spinner label={view === 'folders' ? 'Opening folder…' : 'Loading workflows…'} /> : shown.length === 0 ? (
          (view !== 'folders' || !folders.length) && (
            <EmptyState
              title={view === 'folders' && !sessionToken ? 'Needs your GHL session' : list.length ? 'No match' : 'No workflows'}
              hint={view === 'folders' && !sessionToken ? "Folders come from GHL's own API. Use Send to portal in GHL first." : undefined}
            />
          )
        ) : (
          <>
            <label className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs text-text-muted cursor-pointer sticky top-0 bg-surface">
              <input type="checkbox" checked={allShownPicked} onChange={toggleAll} />
              Select {search ? 'shown' : view === 'folders' ? 'all in this folder' : 'all'} ({shown.length})
            </label>
            {shown.map(w => (
              <label key={w.id} className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 last:border-0 cursor-pointer hover:bg-border/20">
                <input type="checkbox" checked={picked.has(w.id)} onChange={() => toggle(w.id)} />
                <span className="flex-1 text-sm text-text-primary truncate">{w.name}</span>
                {w.status && (
                  <span className={`text-[10px] font-bold uppercase ${w.status === 'published' ? 'text-green-700' : 'text-text-muted'}`}>{w.status}</span>
                )}
              </label>
            ))}
          </>
        )}
      </div>

      {progress ? (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-text-muted mb-1">
            <span>{progress.label}…</span><span>{progress.done} / {progress.total}</span>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-wcs-red transition-all" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mt-3">
          <Button onClick={copyPicked} disabled={busy || !picked.size}>Copy {picked.size || ''} to clubs →</Button>
          <Button variant="secondary" onClick={exportPicked} disabled={busy || !picked.size}>Export {picked.size || ''}</Button>
          <Button variant="secondary" onClick={exportClub} disabled={busy || !list.length}>Export all ({list.length})</Button>
          <Button variant="ghost" onClick={exportEveryClub} disabled={busy}>Export every club</Button>
        </div>
      )}
    </div>
  )
}

// ── One workflow x one club: mode, overwrite target, unmatched pickers ─────
function PairCard({ item, club, plan, clubWorkflows, onChange }) {
  const p = plan.preview
  const [open, setOpen] = useState(false)
  const unmatched = p?.unmatched || []
  const matchedCounts = useMemo(() => {
    const c = {}
    for (const m of p?.matched || []) c[m.label] = (c[m.label] || 0) + 1
    return Object.entries(c)
  }, [p])
  const result = plan.result

  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-semibold text-text-primary">{club.name}</span>
        <div className="flex items-center gap-2 text-xs">
          <select
            value={plan.mode === 'overwrite' ? plan.targetWorkflowId || '' : '__new'}
            onChange={e => onChange(e.target.value === '__new'
              ? { mode: 'new', targetWorkflowId: null }
              : { mode: 'overwrite', targetWorkflowId: e.target.value })}
            className="px-2 py-1 rounded border border-border bg-surface text-text-primary max-w-[260px]"
          >
            <option value="__new">New draft "{item.name}"</option>
            {(clubWorkflows || []).map(w => <option key={w.id} value={w.id}>Overwrite: {w.name}</option>)}
          </select>
        </div>
      </div>

      {plan.loading && <p className="text-xs text-text-muted mt-2">Checking ids…</p>}
      {plan.error && <p className="text-xs text-red-700 mt-2">{plan.error}</p>}
      {p && !plan.loading && (
        <div className="mt-2 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {matchedCounts.map(([label, n]) => (
              <span key={label} className="px-2 py-0.5 rounded-full text-[11px] bg-green-500/10 text-green-700 border border-green-500/20">{n} {label.toLowerCase()}{n > 1 ? 's' : ''} remapped</span>
            ))}
            {unmatched.length > 0 && (
              <button onClick={() => setOpen(o => !o)} className="px-2 py-0.5 rounded-full text-[11px] bg-amber-500/10 text-amber-700 border border-amber-500/30 font-semibold">
                {unmatched.length} not found {open ? '▴' : '▾'}
              </button>
            )}
            {!unmatched.length && !matchedCounts.length && <span className="text-[11px] text-text-muted">No club-specific ids</span>}
          </div>
          {p.warnings?.map(w => <p key={w} className="text-[11px] text-amber-700">{w}</p>)}
          {(open || unmatched.length <= 3) && unmatched.map(u => (
            <div key={u.id} className="flex items-center gap-2 text-xs">
              <span className="text-text-muted w-28 shrink-0">{u.label}</span>
              <span className="text-text-primary truncate flex-1" title={u.name}>{u.name}</span>
              <select
                value={plan.overrides?.[u.id] || ''}
                onChange={e => onChange({ overrides: { ...plan.overrides, [u.id]: e.target.value || undefined } })}
                className="px-2 py-0.5 rounded border border-border bg-surface text-text-primary max-w-[200px]"
              >
                <option value="">Leave as is</option>
                {(p.options?.[u.category] || []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          ))}
        </div>
      )}

      {result && (
        <p className={`text-xs mt-2 font-semibold ${result.error ? 'text-red-700' : 'text-green-700'}`}>
          {result.error
            ? result.error
            : `${result.mode === 'new' ? 'Created draft' : 'Overwrote'} · ${result.steps} steps · ${result.triggers} trigger${result.triggers === 1 ? '' : 's'} added${result.triggersAlreadyThere ? ` · ${result.triggersAlreadyThere} already there` : ''}${result.removedTriggers?.length ? ` · ${result.removedTriggers.length} removed` : ''}${result.snapshotId ? ' · backup saved' : ''}`}
        </p>
      )}
      {result?.folder && (
        <p className={`text-xs mt-1 ${result.folder.ok ? 'text-text-muted' : 'font-semibold text-amber-700'}`}>
          {result.folder.ok ? '📁 ' : 'Could not confirm the folder: '}{result.folder.path.join(' › ')}
          {result.folder.created?.length ? ` (created ${result.folder.created.join(', ')})` : ''}
        </p>
      )}
      {result?.published && <p className="text-xs mt-1 font-semibold text-green-700">Published</p>}
      {result?.unpublishReason && (
        <p className="text-xs mt-1 font-semibold text-amber-700">Left as a draft: {result.unpublishReason}.</p>
      )}
      {result?.removedTriggers?.length > 0 && (
        <p className="text-xs mt-1 text-text-muted">
          Removed (not in the source): {result.removedTriggers.map(t => t.name).join(', ')}. The backup still has {result.removedTriggers.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      {result?.notRemovedTriggers?.length > 0 && (
        <p className="text-xs mt-1 font-semibold text-amber-700">
          GHL did not remove: {result.notRemovedTriggers.map(t => t.name).join(', ')}. Delete {result.notRemovedTriggers.length === 1 ? 'it' : 'them'} by hand in GHL.
        </p>
      )}
      {result?.triggersUntouched && (
        <p className="text-xs mt-1 text-amber-700">This file has no trigger list, so the club's triggers were left as they were.</p>
      )}
      {result?.unlinkedTriggerChecks?.length > 0 && (
        <p className="text-xs mt-1 font-semibold text-amber-700">
          An if/else checks "Workflow Trigger is {result.unlinkedTriggerChecks.map(t => t.name).join(', ')}" but that trigger could not be placed here. Fix that branch in GHL.
        </p>
      )}
      {result?.droppedTriggers?.length > 0 && (
        <p className="text-xs mt-1 font-semibold text-amber-700">
          GHL did not keep {result.droppedTriggers.length === 1 ? 'this trigger' : 'these triggers'}: {result.droppedTriggers.map(t => t.name).join(', ')}. Add {result.droppedTriggers.length === 1 ? 'it' : 'them'} by hand in GHL.
        </p>
      )}
    </div>
  )
}

function CopyPanel({ clubs, session, items, onClear, onNeedSession, onPushed }) {
  const [targets, setTargets] = useState(() => new Set())
  const [plans, setPlans] = useState({})
  const [clubLists, setClubLists] = useState({})
  const [confirm, setConfirm] = useState(false)
  const [pushing, setPushing] = useState(null)
  // Copies go in the same folder path as the source (created if missing).
  const [sameFolder, setSameFolder] = useState(true)
  // New copies are published, but only when nothing is left "not found".
  const [publishNew, setPublishNew] = useState(false)
  const batchNames = useMemo(() => items.map(it => it.name), [items])

  const sourceClubs = useMemo(() => new Set(items.map(i => i.payload.sourceClub).filter(Boolean)), [items])
  // Plans are keyed by the item's own id, so loading new items never reads a stale plan.
  const key = (i, slug) => `${items[i]?.uid}:${slug}`

  // Each target club's workflow list feeds the overwrite picker.
  useEffect(() => {
    for (const slug of targets) {
      if (clubLists[slug]) continue
      setClubLists(prev => ({ ...prev, [slug]: [] }))
      getWorkflowTransferList(slug).then(d => setClubLists(prev => ({ ...prev, [slug]: d.workflows || [] }))).catch(() => {})
    }
  }, [targets]) // eslint-disable-line react-hooks/exhaustive-deps

  const runPreview = useCallback(async (i, slug, plan) => {
    const k = key(i, slug)
    setPlans(prev => ({ ...prev, [k]: { ...plan, loading: true, error: '', result: null } }))
    try {
      const overrides = Object.fromEntries(Object.entries(plan.overrides || {}).filter(([, v]) => v))
      const { results } = await previewWorkflowTransfer(items[i].payload, [{
        club: slug, mode: plan.mode, targetWorkflowId: plan.targetWorkflowId, overrides,
      }], batchNames)
      const r = results[0]
      // First preview: default to overwriting the same-named workflow if there is one.
      if (!plan.touched && plan.mode === 'new' && r.sameName?.length) {
        return runPreview(i, slug, { ...plan, mode: 'overwrite', targetWorkflowId: r.sameName[0].id, touched: true })
      }
      setPlans(prev => ({ ...prev, [k]: { ...plan, preview: r, loading: false, touched: true } }))
    } catch (err) {
      setPlans(prev => ({ ...prev, [k]: { ...(prev[k] || plan), loading: false, error: err.message } }))
    }
  }, [items, batchNames]) // eslint-disable-line react-hooks/exhaustive-deps

  // New target club -> preview every workflow into it.
  useEffect(() => {
    items.forEach((_, i) => {
      for (const slug of targets) {
        if (!plans[key(i, slug)]) runPreview(i, slug, { mode: 'new', targetWorkflowId: null, overrides: {} })
      }
    })
  }, [targets, items]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (i, slug, patch) => {
    const cur = plans[key(i, slug)] || { mode: 'new', overrides: {} }
    runPreview(i, slug, { ...cur, ...patch, touched: true })
  }

  const toggleTarget = slug => setTargets(prev => { const n = new Set(prev); n.has(slug) ? n.delete(slug) : n.add(slug); return n })

  const pairs = items.flatMap((item, i) => [...targets].map(slug => ({ i, slug, item, plan: plans[key(i, slug)] })))
  const ready = pairs.length > 0 && pairs.every(p => p.plan?.preview && !p.plan.loading)
  const overwrites = pairs.filter(p => p.plan?.mode === 'overwrite').length

  const push = async () => {
    setConfirm(false)
    if (!session) { onNeedSession(); return }
    setPushing({ done: 0, total: pairs.length })
    const folder = sameFolder ? 'source' : 'keep'
    // Club by club. Every NEW copy in a club gets an empty draft first, so
    // workflows in this batch that add/remove each other link to the club's
    // new copies; then each one is filled in.
    clubs: for (const slug of targets) {
      const clubPairs = pairs.filter(p => p.slug === slug)
      const draftIds = {}
      const news = clubPairs.filter(p => p.plan.mode === 'new')
      if (news.length) {
        try {
          const { drafts } = await prepareWorkflowDrafts(session.token, slug, news.map(p => ({
            name: p.plan.preview?.name || p.item.name,
            folderPath: p.item.payload.folderPath || [],
          })), folder)
          news.forEach((p, n) => { if (drafts[n]) draftIds[key(p.i, slug)] = drafts[n].id })
        } catch (err) {
          for (const p of clubPairs) setPlans(prev => ({ ...prev, [key(p.i, slug)]: { ...prev[key(p.i, slug)], result: { error: err.message } } }))
          setPushing(s => ({ ...s, done: s.done + clubPairs.length }))
          if (isSessionError(err)) { onNeedSession(); break clubs }
          continue
        }
      }
      for (const { i, plan } of clubPairs) {
        const k = key(i, slug)
        try {
          const overrides = Object.fromEntries(Object.entries(plan.overrides || {}).filter(([, v]) => v))
          const isNew = plan.mode === 'new'
          if (isNew && !draftIds[k]) throw new Error('No draft was created for this copy')
          const r = await pushWorkflowTransfer(session.token, items[i].payload, {
            club: slug,
            mode: isNew ? 'fill' : plan.mode,
            targetWorkflowId: isNew ? draftIds[k] : plan.targetWorkflowId,
            overrides, folder, publish: publishNew,
          })
          setPlans(prev => ({ ...prev, [k]: { ...prev[k], result: { ...r, mode: isNew ? 'new' : r.mode } } }))
        } catch (err) {
          setPlans(prev => ({ ...prev, [k]: { ...prev[k], result: { error: err.message } } }))
          if (isSessionError(err)) { onNeedSession(); break clubs }
        }
        setPushing(p => ({ ...p, done: p.done + 1 }))
      }
    }
    setPushing(null)
    setClubLists({})
    onPushed()
  }

  if (!items.length) {
    return (
      <div className={`${CARD} p-4`}>
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Copy to clubs</h3>
        <EmptyState title="Nothing picked yet" hint="Tick workflows on the left and press Copy to clubs, or load an exported JSON file." />
      </div>
    )
  }

  return (
    <div className={`${CARD} p-4 flex flex-col min-h-0`}>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">Copy to clubs</h3>
        <button onClick={onClear} className="text-xs text-text-muted hover:text-text-primary">Clear</button>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        {clubs.map(c => {
          const on = targets.has(c.slug)
          return (
            <button
              key={c.slug}
              onClick={() => toggleTarget(c.slug)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg border-border text-text-muted hover:text-text-primary'}`}
              title={sourceClubs.has(c.slug) ? 'Source club' : undefined}
            >{c.name}{sourceClubs.has(c.slug) ? ' (source)' : ''}</button>
          )
        })}
        <button
          onClick={() => setTargets(new Set(clubs.filter(c => !sourceClubs.has(c.slug)).map(c => c.slug)))}
          className="px-3 py-1 rounded-full text-xs font-semibold text-wcs-red hover:underline"
        >All other clubs</button>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-3 text-xs text-text-primary">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={sameFolder} onChange={e => setSameFolder(e.target.checked)} />
          Same folder as the source (created if missing)
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={publishNew} onChange={e => setPublishNew(e.target.checked)} />
          Publish new copies
          <span className="text-text-muted">(only if nothing is "not found")</span>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
        {items.map((item, i) => (
          <div key={i}>
            <p className="text-sm font-bold text-text-primary mb-1.5">
              {item.name}
              <span className="ml-2 text-xs font-normal text-text-muted">
                {(item.payload.workflow?.workflowData?.templates || []).length} steps · {(item.payload.triggers || []).length} triggers
                {item.payload.sourceClub ? ` · from ${clubs.find(c => c.slug === item.payload.sourceClub)?.name || item.payload.sourceClub}` : ''}
                {item.payload.folderPath?.length ? ` · 📁 ${item.payload.folderPath.join(' › ')}` : ''}
              </span>
            </p>
            {targets.size === 0 ? (
              <p className="text-xs text-text-muted">Pick the clubs to copy into.</p>
            ) : (
              <div className="space-y-2">
                {[...targets].map(slug => (
                  <PairCard
                    key={slug}
                    item={item}
                    club={clubs.find(c => c.slug === slug)}
                    plan={plans[key(i, slug)] || { mode: 'new', loading: true }}
                    clubWorkflows={clubLists[slug]}
                    onChange={patch => change(i, slug, patch)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border">
        <p className="text-xs text-text-muted">
          {pushing ? `Pushing ${pushing.done} / ${pushing.total}…`
            : pairs.length ? `${pairs.length} push${pairs.length > 1 ? 'es' : ''}${overwrites ? `, ${overwrites} overwrite${overwrites > 1 ? 's' : ''} (backed up first)` : ''}. New ones land as ${publishNew ? "published (when fully matched)" : "drafts"}${sameFolder ? ", in the source folder" : ""}.` : ''}
        </p>
        <Button onClick={() => (session ? setConfirm(true) : onNeedSession())} disabled={!ready || !!pushing}>Push to GHL</Button>
      </div>

      {confirm && (
        <Modal
          title="Push to GHL?"
          subtitle={`${pairs.length} workflow write${pairs.length > 1 ? 's' : ''} across ${targets.size} club${targets.size > 1 ? 's' : ''}`}
          onClose={() => setConfirm(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button onClick={push}>Push</Button>
          </>}
        >
          <ul className="text-sm text-text-primary space-y-1">
            {pairs.map(({ i, slug, item, plan }) => {
              const club = clubs.find(c => c.slug === slug)
              const tgt = plan.mode === 'overwrite' ? (clubLists[slug] || []).find(w => w.id === plan.targetWorkflowId)?.name || plan.targetWorkflowId : null
              return (
                <li key={key(i, slug)}>
                  <b>{club?.name}</b>: {plan.mode === 'overwrite' ? <>overwrite "{tgt}"</> : <>new draft "{item.name}"</>}
                  {plan.preview?.unmatched?.length ? <span className="text-amber-700"> · {plan.preview.unmatched.length} id(s) left as is</span> : null}
                </li>
              )
            })}
          </ul>
        </Modal>
      )}
    </div>
  )
}

// ── Backups ───────────────────────────────────────────────────────────────
function BackupsPanel({ clubs, refreshKey, onRestore }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  useEffect(() => {
    getWorkflowSnapshots().then(d => setRows(d.snapshots || [])).catch(err => setError(err.message))
  }, [refreshKey])

  const fetchOne = async (id) => (await getWorkflowSnapshot(id)).snapshot

  const download = async (row) => {
    setBusy(row.id)
    try {
      const s = await fetchOne(row.id)
      downloadJson(`backup-${row.club_slug}-${slugify(row.workflow_name)}-${row.created_at.slice(0, 10)}.json`, s.payload)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  const restore = async (row) => {
    setBusy(row.id)
    try {
      const s = await fetchOne(row.id)
      onRestore(s)
    } catch (err) { setError(err.message) } finally { setBusy('') }
  }

  const clubName = slug => clubs.find(c => c.slug === slug)?.name || slug

  return (
    <div className={`${CARD} p-4`}>
      <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted mb-2">Backups</h3>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      {rows === null ? <Spinner /> : rows.length === 0 ? (
        <p className="text-xs text-text-muted">Every overwrite saves the workflow here first. None yet.</p>
      ) : (
        <div className="max-h-56 overflow-y-auto divide-y divide-border/50">
          {rows.map(r => (
            <div key={r.id} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="text-text-muted text-xs w-32 shrink-0">{new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              <span className="text-xs font-semibold text-text-primary w-24 shrink-0">{clubName(r.club_slug)}</span>
              <span className="flex-1 truncate text-text-primary">{r.workflow_name || r.workflow_id}</span>
              <span className="text-[10px] uppercase text-text-muted">{r.reason === 'manual' ? 'manual' : 'before overwrite'}</span>
              <button disabled={busy === r.id} onClick={() => download(r)} className="text-xs text-text-muted hover:text-text-primary">Download</button>
              <button disabled={busy === r.id} onClick={() => restore(r)} className="text-xs font-semibold text-wcs-red hover:underline">Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function WorkflowTransferView({ onBack }) {
  const session = useGhlSession()
  const [clubs, setClubs] = useState(null)
  const [error, setError] = useState('')
  const [items, setItems] = useState([])
  const [restore, setRestore] = useState(null)
  const [restoring, setRestoring] = useState(false)
  const [backupKey, setBackupKey] = useState(0)
  const [nudge, setNudge] = useState(false)

  useEffect(() => {
    getWorkflowTransferClubs().then(d => setClubs(d.clubs || [])).catch(err => setError(err.message))
  }, [])

  useEffect(() => { if (session) setNudge(false) }, [session])

  const loadItems = (payloads) => {
    setItems(payloads.map(p => ({ uid: ++itemSeq, name: p.name || p.workflow?.name || 'Workflow', payload: p })))
  }

  const doRestore = async () => {
    if (!session) { setNudge(true); return }
    setRestoring(true)
    try {
      await pushWorkflowTransfer(session.token, restore.payload, {
        club: restore.club_slug, mode: 'overwrite', targetWorkflowId: restore.workflow_id,
      })
      setRestore(null)
      setBackupKey(k => k + 1)
    } catch (err) {
      setError(err.message)
      if (isSessionError(err)) setNudge(true)
      setRestore(null)
    } finally { setRestoring(false) }
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-6 py-6 flex flex-col gap-4 min-h-[calc(100vh-2rem)]">
      <div className={`${CARD} p-5`}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="redundant-back text-text-muted hover:text-text-primary text-sm">← Back</button>
            <h2 className="text-xl font-bold text-text-primary">Workflow Transfer</h2>
            <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-[10px] font-bold uppercase tracking-wider border border-wcs-red/20">GHL</span>
          </div>
          {clubs && <SessionBar session={session} clubs={clubs} />}
        </div>
        {nudge && !session && (
          <p className="mt-3 text-xs text-amber-700">That needs your GHL session. Open GHL, click <b>Send to portal</b> at the bottom left, then try again.</p>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError('')} />

      {!clubs ? <div className={CARD}><Spinner /></div> : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,2fr)_3fr] gap-4 lg:h-[calc(100vh-17rem)] min-h-[480px]">
            <SourcePanel clubs={clubs} session={session} onUse={loadItems} onNeedSession={() => setNudge(true)} />
            <CopyPanel
              clubs={clubs}
              session={session}
              items={items}
              onClear={() => setItems([])}
              onNeedSession={() => setNudge(true)}
              onPushed={() => setBackupKey(k => k + 1)}
            />
          </div>
          <BackupsPanel clubs={clubs} refreshKey={backupKey} onRestore={setRestore} />
        </>
      )}

      {restore && (
        <Modal
          title="Restore this backup?"
          subtitle={`${clubs?.find(c => c.slug === restore.club_slug)?.name}: ${restore.workflow_name}`}
          onClose={() => setRestore(null)}
          footer={<>
            <Button variant="secondary" onClick={() => setRestore(null)}>Cancel</Button>
            <Button onClick={doRestore} disabled={restoring}>{restoring ? 'Restoring…' : 'Restore'}</Button>
          </>}
        >
          <p className="text-sm text-text-primary">
            Puts the workflow back the way it was on {new Date(restore.created_at).toLocaleString()}. Its current version is backed up first.
          </p>
        </Modal>
      )}
    </div>
  )
}
