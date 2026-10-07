// Live GHL custom values for a workflow map. Steps linked to a custom value
// (node.data.cv = { key, name }) show the chosen club's current value from GHL,
// and edits write straight back to GHL, so the map, the Workflows & Scripts
// tile and GHL itself all show the same copy.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getWorkflowGhlLocations, getWorkflowGhlValues, saveWorkflowGhlValue } from '../../lib/api'

const WRITE_DELAY_MS = 900

const norm = (k) => String(k || '').replace(/[{}\s]/g, '').toLowerCase()

// Mirrors findLinkedValue in auth/src/lib/workflowMaps.js: key first, then name.
export function findLinked(values, link) {
  if (!link || !values) return null
  const key = norm(link.key)
  if (key) {
    const hit = values.find(v => norm(v.fieldKey) === key)
    if (hit) return hit
  }
  const name = String(link.name || '').trim().toLowerCase()
  return name ? values.find(v => String(v.name || '').trim().toLowerCase() === name) || null : null
}

export default function useGhlValues({ nodes, preferredClubs }) {
  const [locations, setLocations] = useState([])
  const [club, setClub] = useState(null)
  const [values, setValues] = useState(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Per custom value id: 'saving' | 'saved' | 'error'
  const [writeState, setWriteState] = useState({})
  const timers = useRef({})

  const links = useMemo(() => {
    const seen = new Map()
    for (const n of nodes) if (n.data?.cv) seen.set(norm(n.data.cv.key) || n.data.cv.name, n.data.cv)
    return [...seen.values()]
  }, [nodes])
  const hasLinks = links.length > 0
  const linksRef = useRef(links)
  linksRef.current = links

  useEffect(() => {
    getWorkflowGhlLocations()
      .then(res => setLocations(res.locations || []))
      .catch(err => setError(err.message || 'Could not load clubs'))
  }, [])

  // Default club: the map's first club, else Salem. Waits for the map to load
  // (preferredClubs undefined until then) so it doesn't settle on the wrong one.
  useEffect(() => {
    if (club || !locations.length || preferredClubs === undefined) return
    const pick = preferredClubs.find(c => locations.some(l => l.slug === c))
      || (locations.some(l => l.slug === 'salem') ? 'salem' : locations[0].slug)
    setClub(pick)
  }, [club, locations, preferredClubs])

  const load = useCallback(async () => {
    if (!club) return
    setLoading(true)
    setError('')
    try {
      const res = await getWorkflowGhlValues(club, linksRef.current)
      setValues(res.values || [])
      setCanEdit(!!res.canEdit)
    } catch (err) {
      setError(err.message || 'Could not load custom values from GHL')
    } finally {
      setLoading(false)
    }
  }, [club])

  // Load when the club changes. Linking a new step re-reads it by id through
  // refresh(), so the list's lag never shows a stale value for long.
  useEffect(() => { load() }, [load])

  // Closing the editor mid-typing must not drop the edit: send it now.
  useEffect(() => () => {
    for (const t of Object.values(timers.current)) { clearTimeout(t.handle); t.run() }
  }, [])

  const write = useCallback((cv, text) => {
    if (!club || !cv) return
    setValues(vs => (vs || []).map(v => (v.id === cv.id ? { ...v, value: text } : v)))
    setWriteState(s => ({ ...s, [cv.id]: 'pending' }))
    clearTimeout(timers.current[cv.id]?.handle)
    const target = club
    const run = async () => {
      delete timers.current[cv.id]
      setWriteState(s => ({ ...s, [cv.id]: 'saving' }))
      try {
        await saveWorkflowGhlValue(target, cv.id, { name: cv.name, value: text })
        setWriteState(s => ({ ...s, [cv.id]: 'saved' }))
      } catch {
        setWriteState(s => ({ ...s, [cv.id]: 'error' }))
      }
    }
    timers.current[cv.id] = { handle: setTimeout(run, WRITE_DELAY_MS), run }
  }, [club])

  const pendingWrites = Object.values(writeState).some(s => s === 'pending' || s === 'saving')
  const clubName = locations.find(l => l.slug === club)?.name || club

  return {
    locations, club, setClub, clubName, values, canEdit, loading, error, hasLinks,
    refresh: load, write, writeState, pendingWrites,
    liveFor: (link) => findLinked(values, link),
  }
}
