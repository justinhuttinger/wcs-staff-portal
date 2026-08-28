import { useEffect, useRef, useState, useCallback } from 'react'
import { isRetryable, backoffFor, MAX_ATTEMPTS } from '../lib/retryPolicy'

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
//
// AUTOMATIC RETRY ON TRANSIENT FAILURES.
//
// Reports were intermittently failing to load, and clicking away and back
// fixed them — the signature of a transient failure, not a broken report. The
// auth service is on Render and a request landing on a cold or restarting
// instance returns 502/503 or drops the connection outright. The user was doing
// the retrying by hand; now the hook does it.
//
// WHAT IS AND IS NOT RETRIED MATTERS. A 4xx will fail identically three times,
// so retrying it only makes the failure slower to appear. Retries are limited
// to genuine transport faults:
//
//   no httpStatus   the fetch itself rejected — DNS, connection reset, offline
//   5xx             the server broke, and may not next time
//   429             rate limited, which is what backoff is for
//
// Anything else surfaces immediately.

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms)
  if (!signal) return
  const onAbort = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')) }
  if (signal.aborted) return onAbort()
  signal.addEventListener('abort', onAbort, { once: true })
})

export function useCancellableFetch(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null, attempt: 0, retrying: false })
  // Latest fn in a ref so refetch() never closes over a stale callback.
  const fnRef = useRef(fn)
  fnRef.current = fn

  // bump to force a refetch without changing the caller-controlled deps.
  const [refetchTick, setRefetchTick] = useState(0)
  const refetch = useCallback(() => setRefetchTick(t => t + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    setState(s => ({ ...s, loading: true, error: null, attempt: 0, retrying: false }))

    const run = async () => {
      let lastErr = null

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const value = await fnRef.current(controller.signal)
          if (cancelled || controller.signal.aborted) return
          setState({ data: value, loading: false, error: null, attempt, retrying: false })
          return
        } catch (err) {
          if (cancelled || controller.signal.aborted) return
          if (err?.name === 'AbortError') return // expected on unmount
          lastErr = err

          const canRetry = attempt < MAX_ATTEMPTS && isRetryable(err)
          if (!canRetry) break

          // Surfaced so the loader can say it is retrying rather than looking
          // frozen for the length of the backoff.
          setState(s => ({ ...s, loading: true, error: null, attempt, retrying: true }))
          try {
            await sleep(backoffFor(attempt), controller.signal)
          } catch {
            return // aborted mid-backoff
          }
          if (cancelled || controller.signal.aborted) return
        }
      }

      if (cancelled || controller.signal.aborted) return
      setState({ data: null, loading: false, error: lastErr, attempt: MAX_ATTEMPTS, retrying: false })
    }

    run()

    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...(deps || []), refetchTick])

  return { ...state, refetch }
}
