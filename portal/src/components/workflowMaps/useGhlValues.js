// Live GHL custom values for a workflow map. Steps linked to a custom value
// (node.data.cv = { key, name }) show its current copy from GHL. Read only:
// copy is edited in GHL or the Workflows & Scripts tile and shows up here on
// the next load or refresh.
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

export default function useGhlValues({ nodes, enabled }) {
  const [values, setValues] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const links = useMemo(() => {
    const seen = new Map()
    for (const n of nodes) if (n.data?.cv) seen.set(norm(n.data.cv.key) || n.data.cv.name, n.data.cv)
    return [...seen.values()]
  }, [nodes])
  const linksRef = useRef(links)
  linksRef.current = links

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await getWorkflowGhlValues(linksRef.current)
      setValues(res.values || [])
    } catch (err) {
      setError(err.message || 'Could not load custom values from GHL')
    } finally {
      setLoading(false)
    }
  }, [])

  // Once the map has loaded.
  useEffect(() => { if (enabled) load() }, [enabled, load])

  return {
    values, loading, error, refresh: load, hasLinks: links.length > 0,
    liveFor: (link) => findLinked(values, link),
  }
}
