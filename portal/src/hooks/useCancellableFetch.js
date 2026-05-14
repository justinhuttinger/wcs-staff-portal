import { useEffect, useRef, useState, useCallback } from 'react'

// Run an async fetch tied to component lifecycle. Cancels in-flight requests
// on unmount or when deps change, so navigating away mid-load doesn't pile
// up zombie requests on the server.
//
// Usage:
//   const { data, loading, error, refetch } = useCancellableFetch(
//     (signal) => api('/reports/club-health?...', { cache: true, signal }),
//     [startDate, endDate, locationSlug]
//   )
//
// `fn` MUST accept an AbortSignal and pass it through to the underlying
// fetch. If it doesn't, the request will still resolve after unmount — the
// hook just won't update state from it.
export function useCancellableFetch(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  // Latest fn in a ref so refetch() never closes over a stale callback.
  const fnRef = useRef(fn)
  fnRef.current = fn

  // bump to force a refetch without changing the caller-controlled deps.
  const [refetchTick, setRefetchTick] = useState(0)
  const refetch = useCallback(() => setRefetchTick(t => t + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setState(s => ({ ...s, loading: true, error: null }))

    Promise.resolve()
      .then(() => fnRef.current(controller.signal))
      .then(value => {
        if (cancelled || controller.signal.aborted) return
        setState({ data: value, loading: false, error: null })
      })
      .catch(err => {
        if (cancelled || controller.signal.aborted) return
        if (err?.name === 'AbortError') return // expected on unmount
        setState({ data: null, loading: false, error: err })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...(deps || []), refetchTick])

  return { ...state, refetch }
}
