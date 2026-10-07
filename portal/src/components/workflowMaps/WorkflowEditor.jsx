import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, MarkerType,
  applyNodeChanges, applyEdgeChanges, addEdge, useReactFlow, useNodesInitialized,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { getWorkflowMap, saveWorkflowMap } from '../../lib/api'
import { KINDS, KIND_KEYS, WORKFLOW_STATUSES, blankData, newId } from './kinds'
import StepNode, { KindIcon } from './StepNode'
import NodePanel from './NodePanel'
import { tidyLayout } from './layout'
import useGhlValues from './useGhlValues'
import { Modal, MapDetailsForm, downloadJson } from './MapDetails'
import { btnGhost, STATUS_CLS } from './ui'

const CLUB_KEY = 'wcs.workflowMaps.club'

const nodeTypes = Object.fromEntries(KIND_KEYS.map(k => [k, StepNode]))
const META_FIELDS = ['name', 'description', 'category', 'status', 'clubs', 'ghl_workflow_url']
const HISTORY_LIMIT = 100
const SAVE_DELAY_MS = 800
// Below this zoom, fitting a whole map makes the cards unreadable.
const MIN_READABLE_ZOOM = 0.75
const START_ZOOM = 0.85

const defaultEdgeOptions = {
  type: 'smoothstep',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  style: { strokeWidth: 2 },
}

// What gets stored: React Flow adds selection/measurement props we don't keep.
const stripNodes = (nodes) => nodes.map(({ id, type, position, data }) => ({ id, type, position: { x: Math.round(position.x), y: Math.round(position.y) }, data }))
const stripEdges = (edges) => edges.map(({ id, source, target, sourceHandle }) => (sourceHandle ? { id, source, target, sourceHandle } : { id, source, target }))
const graphSig = (nodes, edges) => JSON.stringify([stripNodes(nodes), stripEdges(edges)])

const canLeadOut = (type) => type !== 'goal' && type !== 'note' && type !== 'condition'
const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

function SaveIndicator({ state, onRetry }) {
  if (state === 'saving') return <span className="text-[11px] font-semibold text-text-muted">Saving...</span>
  if (state === 'pending') return <span className="text-[11px] font-semibold text-text-muted">Unsaved changes</span>
  if (state === 'error') return <button onClick={onRetry} className="text-[11px] font-semibold text-wcs-red underline">Save failed, retry</button>
  if (state === 'conflict') return <span className="text-[11px] font-semibold text-amber-600">Not saved</span>
  return <span className="text-[11px] font-semibold text-emerald-600">Saved</span>
}

function ToolbarButton({ onClick, disabled, title, children, active }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors disabled:opacity-40 ${active ? 'bg-wcs-red text-white border-wcs-red' : 'border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted'}`}>
      {children}
    </button>
  )
}

function AddMenu({ onAdd, onClose }) {
  useEffect(() => {
    const close = (e) => { if (!e.target.closest?.('[data-add-menu]')) onClose() }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [onClose])
  return (
    <div data-add-menu className="absolute right-0 top-full mt-1 z-20 w-64 rounded-xl border border-border bg-surface shadow-xl p-1.5">
      {KIND_KEYS.map(k => (
        <button key={k} onClick={() => { onAdd(k); onClose() }}
          className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-lg text-left hover:bg-bg">
          <span className="flex items-center justify-center w-7 h-7 rounded-md text-white shrink-0" style={{ background: KINDS[k].color }}>
            <KindIcon type={k} className="w-4 h-4" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-text-primary">{KINDS[k].label}</span>
            <span className="block text-[11px] text-text-muted">{KINDS[k].hint}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

function Editor({ id, onClose }) {
  const rf = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const openedRef = useRef(false)
  const [viewReady, setViewReady] = useState(false)
  const wrapperRef = useRef(null)
  const [meta, setMeta] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [present, setPresent] = useState(() => window.innerWidth < 768)
  // Only admins edit maps; everyone else gets the read-only Present view.
  const [canEdit, setCanEdit] = useState(false)
  const [saveState, setSaveState] = useState('saved')
  const [conflict, setConflict] = useState(null)
  const [showDetails, setShowDetails] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [, setHistoryTick] = useState(0)

  // Whose GHL copy linked steps show: '' = the base copy, or a club slug.
  // Remembered per browser.
  const [club, setClub] = useState(() => { try { return localStorage.getItem(CLUB_KEY) || '' } catch { return '' } })
  const pickClub = (slug) => {
    setClub(slug)
    try { slug ? localStorage.setItem(CLUB_KEY, slug) : localStorage.removeItem(CLUB_KEY) } catch { /* storage blocked */ }
  }
  const ghl = useGhlValues({ nodes, enabled: !!meta, club })
  // A remembered club that no longer exists falls back to the base copy.
  useEffect(() => {
    if (club && ghl.clubs.length && !ghl.clubs.some(c => c.slug === club)) pickClub('')
  }, [club, ghl.clubs])

  const latest = useRef({ nodes, edges, meta })
  latest.current = { nodes, edges, meta }
  const history = useRef({ past: [], future: [] })
  const versionRef = useRef(null)
  const savedSigRef = useRef(null)
  const savingRef = useRef(false)
  const rerunRef = useRef(false)
  const retryTimer = useRef(null)

  // ── Load ────────────────────────────────────────────────────────────────
  const applyServerMap = useCallback((m) => {
    setMeta(Object.fromEntries(META_FIELDS.map(k => [k, m[k]])))
    setNodes(m.nodes || [])
    setEdges(m.edges || [])
    versionRef.current = m.version
    savedSigRef.current = graphSig(m.nodes || [], m.edges || [])
    history.current = { past: [], future: [] }
    setHistoryTick(t => t + 1)
    setSaveState('saved')
  }, [])

  useEffect(() => {
    let cancelled = false
    getWorkflowMap(id)
      .then(res => {
        if (cancelled) return
        setCanEdit(!!res.canEdit)
        if (!res.canEdit) setPresent(true)
        applyServerMap(res.map)
      })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Failed to load workflow') })
    return () => { cancelled = true }
  }, [id, applyServerMap])

  // Opening view: fit the whole map when it's readable that way, otherwise
  // start at a readable zoom with the top of the map (the trigger) in view,
  // centered across. Fit View in the corner still shows everything.
  const showStart = useCallback((duration = 0) => {
    const ns = rf.getNodes()
    const box = wrapperRef.current?.getBoundingClientRect()
    if (!ns.length || !box?.width) return
    const b = rf.getNodesBounds(ns)
    const pad = 60
    const fitZoom = Math.min(box.width / (b.width + pad * 2), box.height / (b.height + pad * 2))
    if (fitZoom >= MIN_READABLE_ZOOM) {
      rf.fitView({ padding: 0.15, maxZoom: 1, duration })
      return
    }
    const zoom = Math.max(0.4, Math.min(START_ZOOM, box.width / (b.width + pad * 2)))
    rf.setViewport({ x: box.width / 2 - (b.x + b.width / 2) * zoom, y: 40 - b.y * zoom, zoom }, { duration })
  }, [rf])

  useEffect(() => {
    if (!meta || !nodesInitialized || openedRef.current) return
    openedRef.current = true
    showStart()
    setViewReady(true)
  }, [meta, nodesInitialized, showStart])

  // ── Save ────────────────────────────────────────────────────────────────
  // The whole map is sent each time with the version it was based on; the
  // server bumps the version or answers 409 if someone else saved first.
  const save = useCallback(async () => {
    if (savingRef.current) { rerunRef.current = true; return }
    const { nodes: n, edges: e, meta: m } = latest.current
    if (!m) return
    clearTimeout(retryTimer.current)
    const sig = graphSig(n, e)
    savingRef.current = true
    setSaveState('saving')
    try {
      const res = await saveWorkflowMap(id, { ...m, nodes: stripNodes(n), edges: stripEdges(e), version: versionRef.current })
      versionRef.current = res.map.version
      savedSigRef.current = sig
      const cur = latest.current
      setSaveState(graphSig(cur.nodes, cur.edges) === sig ? 'saved' : 'pending')
    } catch (err) {
      if (err.httpStatus === 409 && err.map) {
        setConflict(err.map)
        setSaveState('conflict')
      } else {
        setSaveState('error')
        retryTimer.current = setTimeout(() => save(), 5000)
      }
      rerunRef.current = false
    } finally {
      savingRef.current = false
      if (rerunRef.current) { rerunRef.current = false; save() }
    }
  }, [id])

  useEffect(() => () => clearTimeout(retryTimer.current), [])

  useEffect(() => {
    if (!meta || conflict) return
    if (graphSig(nodes, edges) === savedSigRef.current) return
    setSaveState(s => (s === 'saving' ? s : 'pending'))
    const t = setTimeout(save, SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [nodes, edges, meta, conflict, save])

  const unsaved = saveState !== 'saved'
  useEffect(() => {
    if (!unsaved) return
    const warn = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  async function close() {
    if (saveState === 'pending' || saveState === 'saving') {
      await save()
    } else if (saveState === 'error' || saveState === 'conflict') {
      if (!window.confirm('Your latest changes are not saved. Leave anyway?')) return
    }
    onClose()
  }

  // ── History ─────────────────────────────────────────────────────────────
  const snapshot = useCallback(() => {
    const h = history.current
    h.past.push({ nodes: latest.current.nodes, edges: latest.current.edges })
    if (h.past.length > HISTORY_LIMIT) h.past.shift()
    h.future = []
    setHistoryTick(t => t + 1)
  }, [])

  const undo = useCallback(() => {
    const h = history.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push({ nodes: latest.current.nodes, edges: latest.current.edges })
    setNodes(prev.nodes)
    setEdges(prev.edges)
    setHistoryTick(t => t + 1)
  }, [])

  const redo = useCallback(() => {
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    h.past.push({ nodes: latest.current.nodes, edges: latest.current.edges })
    setNodes(next.nodes)
    setEdges(next.edges)
    setHistoryTick(t => t + 1)
  }, [])

  // ── Graph edits ─────────────────────────────────────────────────────────
  const onNodesChange = useCallback((changes) => {
    const allowed = present ? changes.filter(c => c.type === 'select' || c.type === 'dimensions') : changes
    if (allowed.length) setNodes(ns => applyNodeChanges(allowed, ns))
  }, [present])

  const onEdgesChange = useCallback((changes) => {
    const allowed = present ? changes.filter(c => c.type === 'select') : changes
    if (allowed.length) setEdges(es => applyEdgeChanges(allowed, es))
  }, [present])

  const onConnect = useCallback((conn) => {
    if (conn.source === conn.target) return
    snapshot()
    setEdges(es => addEdge({ ...conn, id: newId('e') }, es))
  }, [snapshot])

  const onBeforeDelete = useCallback(async () => {
    if (present) return false
    snapshot()
    return true
  }, [present, snapshot])

  const updateNodeData = useCallback((nodeId, patch) => {
    setNodes(ns => ns.map(n => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)))
    // Removing a condition branch drops the connection that hung off it.
    if (patch.branches) {
      const keep = new Set(patch.branches.map(b => b.id))
      setEdges(es => es.filter(e => e.source !== nodeId || !e.sourceHandle || keep.has(e.sourceHandle)))
    }
  }, [])

  const selectNode = (nodeId) => {
    setSelectedId(nodeId)
    setNodes(ns => ns.map(n => (n.selected === (n.id === nodeId) ? n : { ...n, selected: n.id === nodeId })))
  }

  const addStep = useCallback((type) => {
    snapshot()
    const { nodes: ns } = latest.current
    const sel = ns.find(n => n.id === selectedId)
    const nodeId = newId()
    let position
    let link = null
    if (sel && canLeadOut(sel.type) && type !== 'note' && type !== 'trigger') {
      position = { x: sel.position.x, y: sel.position.y + (sel.measured?.height || 110) + 50 }
      link = { id: newId('e'), source: sel.id, target: nodeId }
    } else {
      const box = wrapperRef.current?.getBoundingClientRect()
      const center = rf.screenToFlowPosition({ x: (box?.left || 0) + (box?.width || 600) / 2, y: (box?.top || 0) + (box?.height || 400) / 3 })
      position = { x: center.x - 130, y: center.y }
    }
    setNodes(cur => [...cur.map(n => (n.selected ? { ...n, selected: false } : n)), { id: nodeId, type, position, data: blankData(type), selected: true }])
    if (link) setEdges(es => [...es, link])
    setSelectedId(nodeId)
  }, [rf, selectedId, snapshot])

  const duplicateSelected = useCallback(() => {
    const sel = latest.current.nodes.find(n => n.id === selectedId)
    if (!sel) return
    snapshot()
    const nodeId = newId()
    const copy = {
      id: nodeId, type: sel.type, selected: true,
      position: { x: sel.position.x + 40, y: sel.position.y + 40 },
      data: { ...structuredClone(sel.data), title: (sel.data.title || KINDS[sel.type]?.label || '') + ' (copy)', ghl: undefined },
    }
    setNodes(ns => [...ns.map(n => (n.selected ? { ...n, selected: false } : n)), copy])
    setSelectedId(nodeId)
  }, [selectedId, snapshot])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    snapshot()
    setNodes(ns => ns.filter(n => n.id !== selectedId))
    setEdges(es => es.filter(e => e.source !== selectedId && e.target !== selectedId))
    setSelectedId(null)
  }, [selectedId, snapshot])

  const deleteSelectedEdges = () => {
    snapshot()
    setEdges(es => es.filter(e => !e.selected))
  }

  function tidy() {
    snapshot()
    setNodes(tidyLayout(latest.current.nodes, latest.current.edges))
    requestAnimationFrame(() => showStart(300))
  }

  function saveDetails(form) {
    const next = { ...latest.current.meta, ...form }
    // Meta changes don't touch the graph signature, so save directly. Update
    // the ref now so save() sends the new details without waiting for a render.
    latest.current = { ...latest.current, meta: next }
    setMeta(next)
    setShowDetails(false)
    save()
  }

  function resolveConflict(keepMine) {
    const theirs = conflict
    setConflict(null)
    if (keepMine) {
      versionRef.current = theirs.version
      save()
    } else {
      applyServerMap(theirs)
      setSelectedId(null)
    }
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (isTyping(e.target)) e.target.blur()
        else setSelectedId(null)
        return
      }
      if (present || isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
      else if (k === 'd') { e.preventDefault(); duplicateSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [present, undo, redo, duplicateSelected])

  // ── Render ──────────────────────────────────────────────────────────────
  const displayEdges = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    return edges.map(e => {
      if (!e.sourceHandle) return e
      const branch = byId.get(e.source)?.data?.branches?.find(b => b.id === e.sourceHandle)
      return branch ? {
        ...e, label: branch.label,
        labelStyle: { fontSize: 11, fontWeight: 700 },
        labelBgPadding: [6, 3], labelBgBorderRadius: 6,
      } : e
    })
  }, [nodes, edges])

  // What the canvas and panel show: linked steps carry the club's live GHL
  // value instead of the stored copy. A linked email ("<Name> HTML") also
  // takes its "<Name> Subject" value and renders as HTML.
  const displayNodes = useMemo(() => nodes.map(n => {
    if (!n.data?.cv) return n
    const live = ghl.liveFor(n.data.cv)
    const status = live ? 'live' : (ghl.values ? 'missing' : 'loading')
    const data = { ...n.data, body: live ? live.value : n.data.body, _ghl: status }
    if (live && n.type === 'email') {
      const subject = ghl.subjectFor(live)
      if (subject) data.subject = subject.value
      if (/<[a-z!]/i.test(live.value)) data.bodyFormat = 'html'
    }
    return { ...n, data }
  }), [nodes, ghl.values]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode = displayNodes.find(n => n.id === selectedId) || null
  const hasSelectedEdge = !present && edges.some(e => e.selected)

  if (loadError) {
    return (
      <div className="fixed inset-0 z-[900] bg-bg flex items-center justify-center p-6">
        <div className="bg-surface rounded-xl border border-border p-6 text-center max-w-sm">
          <p className="text-sm text-wcs-red mb-4">{loadError}</p>
          <button className={btnGhost} onClick={onClose}>Back to workflows</button>
        </div>
      </div>
    )
  }

  if (!meta) {
    return (
      <div className="fixed inset-0 z-[900] bg-bg flex items-center justify-center">
        <p className="loading-card">Loading workflow...</p>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[900] bg-bg flex flex-col">
      {/* Top bar */}
      <div className="bg-surface border-b border-border px-3 py-2 flex flex-wrap items-center gap-2">
        <button onClick={close} className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-semibold text-text-muted hover:text-text-primary hover:bg-bg">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
          Workflows
        </button>
        <button onClick={() => !present && setShowDetails(true)} className={`min-w-0 text-left ${present ? 'cursor-default' : 'hover:opacity-80'}`} title={present ? undefined : 'Edit name and details'}>
          <span className="block text-sm font-bold text-text-primary truncate max-w-[40vw] sm:max-w-xs">{meta.name}</span>
        </button>
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${STATUS_CLS[meta.status] || STATUS_CLS.draft}`}>{WORKFLOW_STATUSES[meta.status] || meta.status}</span>
        {!present && <SaveIndicator state={saveState} onRetry={save} />}
        {ghl.hasLinks && ghl.clubs.length > 1 && (
          <select value={club} onChange={e => pickClub(e.target.value)} disabled={ghl.loading && !ghl.values}
            title="Show the SMS, call and email copy one club actually sends"
            className="px-2 py-1 rounded-md border border-border bg-surface text-[11px] font-semibold text-text-primary">
            <option value="">Standard copy</option>
            {ghl.clubs.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        )}
        {ghl.hasLinks && (
          <button type="button" onClick={ghl.refresh} disabled={ghl.loading} title="Reload linked copy from GHL"
            className="px-2 py-1 rounded-md border border-border bg-surface text-[11px] font-semibold text-text-muted hover:text-text-primary disabled:opacity-50">
            {ghl.loading ? 'Loading GHL copy...' : '↻ GHL copy'}
          </button>
        )}
        {ghl.error && <span className="text-[11px] font-semibold text-wcs-red" title={ghl.error}>GHL copy unavailable</span>}

        <div className="flex flex-wrap items-center gap-1.5 ml-auto">
          {meta.ghl_workflow_url && (
            <a href={meta.ghl_workflow_url} target="_blank" rel="noopener noreferrer" className={btnGhost}>Open in GHL</a>
          )}
          {!present && (
            <>
              <ToolbarButton onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">Undo</ToolbarButton>
              <ToolbarButton onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">Redo</ToolbarButton>
              {hasSelectedEdge && <ToolbarButton onClick={deleteSelectedEdges} title="Delete the selected connection">Delete connection</ToolbarButton>}
              <ToolbarButton onClick={tidy} title="Auto-arrange steps top to bottom">Tidy up</ToolbarButton>
              <ToolbarButton onClick={() => downloadJson({ ...meta, nodes: stripNodes(nodes), edges: stripEdges(edges) })} title="Download as JSON">Export</ToolbarButton>
              <div className="relative" data-add-menu>
                <button onClick={() => setAddOpen(o => !o)} className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90">+ Add step</button>
                {addOpen && <AddMenu onAdd={addStep} onClose={() => setAddOpen(false)} />}
              </div>
            </>
          )}
          {canEdit && <div className="flex gap-1 bg-bg rounded-lg p-1">
            {[[false, 'Edit'], [true, 'Present']].map(([val, label]) => (
              <button key={label} onClick={() => { setPresent(val); setAddOpen(false) }}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${present === val ? 'bg-white text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}>{label}</button>
            ))}
          </div>}
        </div>
      </div>

      {conflict && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex flex-wrap items-center gap-3 text-sm text-amber-900">
          <span><strong>{conflict.updated_by_name || 'Someone else'}</strong> saved this workflow while you were editing. Your latest changes are not saved.</span>
          <span className="flex gap-2 ml-auto">
            <button className={btnGhost} onClick={() => resolveConflict(false)}>Load their version</button>
            <button className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-semibold" onClick={() => resolveConflict(true)}>Keep mine</button>
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 flex relative">
        <div ref={wrapperRef} className="flex-1 min-w-0 relative" style={{ visibility: nodes.length && !viewReady ? 'hidden' : undefined }}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onBeforeDelete={onBeforeDelete}
            onNodesDelete={(deleted) => { if (deleted.some(n => n.id === selectedId)) setSelectedId(null) }}
            onNodeDragStart={() => snapshot()}
            onNodeClick={(_, n) => selectNode(n.id)}
            onPaneClick={() => { setSelectedId(null); setAddOpen(false) }}
            isValidConnection={c => c.source !== c.target}
            nodesDraggable={!present}
            nodesConnectable={!present}
            edgesFocusable={!present}
            deleteKeyCode={present ? null : ['Delete', 'Backspace']}
            snapToGrid
            snapGrid={[10, 10]}
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            style={{ background: 'var(--color-bg)' }}
          >
            <Background gap={20} size={1} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" className="!hidden sm:!block"
              nodeColor={n => KINDS[n.type]?.color || '#94a3b8'} nodeStrokeWidth={0} />
          </ReactFlow>

          {nodes.length === 0 && !present && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-surface rounded-xl border border-border p-5 text-center pointer-events-auto">
                <p className="text-sm text-text-muted mb-3">This workflow is empty.</p>
                <button className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold" onClick={() => addStep('trigger')}>+ Add a trigger</button>
              </div>
            </div>
          )}
        </div>

        {selectedNode && (
          <aside className="absolute inset-x-0 bottom-0 h-[65vh] rounded-t-2xl shadow-2xl md:static md:h-auto md:w-[380px] md:rounded-none md:shadow-none bg-surface border-t md:border-t-0 md:border-l border-border z-10 overflow-hidden">
            <NodePanel
              node={selectedNode}
              ghl={ghl}
              onLink={(v) => { snapshot(); updateNodeData(selectedNode.id, { cv: { key: v.fieldKey, name: v.name }, body: v.value }) }}
              onUnlink={() => { snapshot(); updateNodeData(selectedNode.id, { cv: null, body: selectedNode.data.body }) }}
              readOnly={present}
              onChange={updateNodeData}
              onBeforeEdit={snapshot}
              onDelete={deleteSelected}
              onDuplicate={duplicateSelected}
              onClose={() => setSelectedId(null)}
              edgesFromBranch={(branchId) => edges.some(e => e.source === selectedNode.id && e.sourceHandle === branchId)}
            />
          </aside>
        )}
      </div>

      {showDetails && (
        <Modal title="Workflow details" onClose={() => setShowDetails(false)}>
          <MapDetailsForm initial={meta} submitLabel="Save" onSubmit={saveDetails} onCancel={() => setShowDetails(false)} />
        </Modal>
      )}
    </div>
  )
}

// Full-screen editor, rendered on <body> so it sits above the portal chrome.
export default function WorkflowEditor(props) {
  return createPortal(
    <ReactFlowProvider>
      <Editor {...props} />
    </ReactFlowProvider>,
    document.body,
  )
}
