// Live GHL custom values for a workflow map. Steps linked to a custom value
// (node.data.cv = { key, name }) show its current copy from GHL. Read only:
// copy is edited in GHL or the Workflows & Scripts tile and shows up here on
// the next load or refresh. `club` picks whose copy to show ('' = the base
// copy, never named in the UI).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getWorkflowGhlValues } from '../../lib/api'

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

// Mirrors findEmailSubject: "<Name> HTML" pairs with "<Name> Subject".
export function findEmailSubject(values, linked) {
  const m = String(linked?.name || '').trim().match(/^(.*\S)\s+html$/i)
  if (!m || !values) return null
  const want = (m[1] + ' subject').toLowerCase()
  return values.find(v => String(v.name || '').trim().toLowerCase() === want) || null
}

export default function useGhlValues({ nodes, enabled, club = '' }) {
  const [values, setValues] = useState(null)
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const links = useMemo(() => {
    const seen = new Map()
    for (const n of nodes) if (n.data?.cv) seen.set(norm(n.data.cv.key) || n.data.cv.name, n.data.cv)
    return [...seen.values()]
  }, [nodes])
  const linksRef = useRef(links)
  linksRef.current = links

  // Switching clubs while a load is in flight: only the latest one lands.
  const reqRef = useRef(0)
  const load = useCallback(async () => {
    const req = ++reqRef.current
    setLoading(true)
    setError('')
    try {
      const res = await getWorkflowGhlValues(linksRef.current, club)
      if (req !== reqRef.current) return
      setValues(res.values || [])
      if (res.clubs) setClubs(res.clubs)
    } catch (err) {
      if (req !== reqRef.current) return
      setValues(null)
      setError(err.message || 'Could not load custom values from GHL')
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [club])

  // Once the map has loaded, and again whenever the club changes.
  useEffect(() => {
    if (!enabled) return
    setValues(null)
    load()
  }, [enabled, load])

  return {
    values, clubs, loading,
    clubName: club ? (clubs.find(c => c.slug === club)?.name || '') : '', error, refresh: load, hasLinks: links.length > 0,
    liveFor: (link) => findLinked(values, link),
    subjectFor: (live) => findEmailSubject(values, live),
  }
}
