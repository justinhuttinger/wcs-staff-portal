// portal/src/components/BlogAutomationView.jsx
import { useState, useEffect, useCallback } from 'react'
import { blogAutomation } from '../lib/api'

const btnPrimary = 'px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnSecondary = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-sm font-semibold text-text-primary hover:border-wcs-red hover:text-wcs-red transition-colors disabled:opacity-50'

function StatusPill({ status }) {
  const map = {
    published:  'bg-green-100 text-green-800',
    failed:     'bg-red-100 text-red-800',
    skipped:    'bg-amber-100 text-amber-800',
    generating: 'bg-gray-100 text-gray-600',
  }
  const cls = map[status] || 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      {status}
    </span>
  )
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BlogAutomationView({ onBack, userRole }) {
  const isAdmin = userRole === 'admin'

  const [status, setStatus] = useState(null)
  const [posts, setPosts] = useState([])
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(true)
  const [statusError, setStatusError] = useState(null)
  const [postsError, setPostsError] = useState(null)

  // Per-location run state: { [location]: { running, error } }
  const [runState, setRunState] = useState({})
  // "Run all" state: sequential server-side run (fire-and-forget).
  const [runAllState, setRunAllState] = useState({ running: false, message: null, error: null })

  const loadStatus = useCallback(async () => {
    setLoadingStatus(true)
    setStatusError(null)
    try {
      const data = await blogAutomation.status()
      setStatus(data)
    } catch (err) {
      setStatusError(err.message)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  const loadPosts = useCallback(async () => {
    setLoadingPosts(true)
    setPostsError(null)
    try {
      const data = await blogAutomation.posts()
      setPosts(data.posts || [])
    } catch (err) {
      setPostsError(err.message)
    } finally {
      setLoadingPosts(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    loadPosts()
  }, [loadStatus, loadPosts])

  async function handleRun(location, publish) {
    setRunState(prev => ({ ...prev, [location]: { running: true, error: null } }))
    try {
      await blogAutomation.run(location, publish)
      await loadPosts()
    } catch (err) {
      setRunState(prev => ({ ...prev, [location]: { running: false, error: err.message } }))
      return
    }
    setRunState(prev => ({ ...prev, [location]: { running: false, error: null } }))
  }

  // Run every location sequentially on the server (one at a time, paced) instead of
  // firing N concurrent per-location requests. The endpoint is fire-and-forget, so it
  // returns immediately and results trickle into the Recent Posts table over a few minutes.
  async function handleRunAll(publish) {
    setRunAllState({ running: true, message: null, error: null })
    try {
      const data = await blogAutomation.runAll(publish)
      const count = data?.locations?.length || locations.length
      setRunAllState({
        running: false,
        message: `Started ${publish ? 'publishing' : 'a test run'} for ${count} location${count === 1 ? '' : 's'}, one at a time. This runs in the background (~1 min each) — use Refresh to see results.`,
        error: null,
      })
      await loadPosts()
    } catch (err) {
      setRunAllState({ running: false, message: null, error: err.message })
    }
  }

  // Derive sorted unique locations from status or posts
  const locations = status?.locations || []

  const wpOk = status?.wp?.success === true || status?.wp?.ok === true

  return (
    <div className="w-full max-w-5xl mx-auto px-8 pb-12">
      {/* Header card */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <button onClick={onBack} className="text-sm text-tile-sub hover:text-text-primary">&larr; Back</button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-text-primary">Blog Automation</h2>
            <p className="text-sm text-tile-sub mt-1">
              AI-generated weekly blog posts per location, published to WordPress.
            </p>
          </div>
          {!loadingStatus && status && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {/* WP connection indicator */}
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                wpOk
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-red-50 text-red-700 border-red-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${wpOk ? 'bg-green-500' : 'bg-red-500'}`} />
                WordPress {wpOk ? 'connected' : 'disconnected'}
              </span>
              {/* enabled/disabled badge */}
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
                status.enabled
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-gray-50 text-gray-500 border-gray-200'
              }`}>
                {status.enabled ? 'Enabled' : 'Disabled'}
              </span>
              {/* next run */}
              <span className="text-tile-sub text-xs">Next run: {status.nextRun || 'Mondays 8:00am PT'}</span>
            </div>
          )}
          {loadingStatus && <span className="text-xs text-tile-sub">Checking status...</span>}
          {statusError && <span className="text-xs text-wcs-red">{statusError}</span>}
        </div>
      </div>

      {/* Admin controls - one row per location */}
      {isAdmin && locations.length > 0 && (
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
          <h3 className="text-sm font-bold text-text-primary mb-3">Manual Run</h3>

          {/* Run all — sequential server-side run (safe under load; one location at a time) */}
          <div className="flex flex-wrap items-center gap-3 pb-3 mb-3 border-b border-border">
            <span className="text-sm font-semibold text-text-primary w-28 shrink-0">All locations</span>
            <button
              className={btnSecondary}
              disabled={runAllState.running}
              onClick={() => handleRunAll(false)}
            >
              {runAllState.running ? 'Starting...' : 'Test all (no publish)'}
            </button>
            <button
              className={btnPrimary}
              disabled={runAllState.running}
              onClick={() => handleRunAll(true)}
            >
              {runAllState.running ? 'Starting...' : 'Publish all now'}
            </button>
            {runAllState.error && <span className="text-xs text-wcs-red">{runAllState.error}</span>}
          </div>
          {runAllState.message && (
            <p className="text-xs text-tile-sub mb-3">{runAllState.message}</p>
          )}

          <div className="flex flex-col gap-2">
            {locations.map((loc) => {
              const rs = runState[loc] || {}
              return (
                <div key={loc} className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold text-text-primary w-28 shrink-0">{loc}</span>
                  <button
                    className={btnSecondary}
                    disabled={rs.running}
                    onClick={() => handleRun(loc, false)}
                  >
                    {rs.running ? 'Running...' : 'Test (no publish)'}
                  </button>
                  <button
                    className={btnPrimary}
                    disabled={rs.running}
                    onClick={() => handleRun(loc, true)}
                  >
                    {rs.running ? 'Running...' : 'Publish now'}
                  </button>
                  {rs.error && <span className="text-xs text-wcs-red">{rs.error}</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Posts table */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary">Recent Posts</h3>
          <button
            onClick={loadPosts}
            disabled={loadingPosts}
            className="text-xs text-tile-sub hover:text-wcs-red disabled:opacity-50"
          >
            {loadingPosts ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {postsError && (
          <div className="px-5 py-4 text-sm text-wcs-red">{postsError}</div>
        )}

        {!postsError && !loadingPosts && posts.length === 0 && (
          <div className="px-5 py-4 text-sm text-tile-sub">No posts found.</div>
        )}

        {!postsError && (loadingPosts || posts.length > 0) && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-bg/40">
                  <th className="px-5 py-2.5 text-left text-xs font-semibold text-tile-sub">Location</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-tile-sub">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-tile-sub">Title</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-tile-sub">Date</th>
                </tr>
              </thead>
              <tbody>
                {loadingPosts ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-sm text-tile-sub">Loading posts...</td>
                  </tr>
                ) : posts.map((post, i) => (
                  <tr key={post.id || i} className="border-b border-border last:border-0 hover:bg-bg/30 transition-colors">
                    <td className="px-5 py-3 text-text-primary font-medium whitespace-nowrap">{post.location}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <StatusPill status={post.status} />
                    </td>
                    <td className="px-3 py-3 text-text-primary max-w-xs">
                      {post.wp_url ? (
                        <a
                          href={post.wp_url}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-wcs-red hover:underline"
                        >
                          {post.title || '(untitled)'}
                        </a>
                      ) : (
                        <span className="text-text-primary">{post.title || '(untitled)'}</span>
                      )}
                      {post.status === 'failed' && post.error_message && (
                        <p className="text-xs text-wcs-red mt-0.5">{post.error_message}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-tile-sub whitespace-nowrap">{fmtDate(post.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
