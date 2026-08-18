import { useEffect, useRef, useState } from 'react'
import { nps as npsApi } from '../../lib/api'

const inputClass = 'w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red disabled:opacity-60'
const labelClass = 'block text-xs font-semibold text-text-muted mb-1'

/**
 * Pick a member, hit go, watch it land.
 *
 * This runs the real path: it writes the GHL custom field, applies the tag, and
 * the workflow sends a real email to a real person. That is the point, because
 * the workflow is the one component no test reaches. Everything it writes is
 * flagged is_test so it never reaches the report.
 */
export default function TestFirePanel({ survey }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [member, setMember] = useState(null)
  const [firing, setFiring] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const debounce = useRef(null)

  const configured = Boolean(survey.ghl_tag && survey.ghl_field_key)

  useEffect(() => {
    if (member) return
    const term = query.trim()
    if (term.length < 2) { setResults([]); return }

    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await npsApi.searchMembers(term)
        setResults(res.members || [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(debounce.current)
  }, [query, member])

  async function fire() {
    if (!member || firing) return
    setFiring(true)
    setError('')
    setResult(null)
    try {
      const res = await npsApi.testFire({
        slug: survey.slug,
        member_id: member.member_id,
        force: true,
      })
      setResult(res)
    } catch (err) {
      setError(err.message)
    } finally {
      setFiring(false)
    }
  }

  function copyUrl() {
    if (!result?.url) return
    navigator.clipboard.writeText(result.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-text-primary">Send a test</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Pick someone and send them this survey now. This sends a real email and
          skips the 60-day cooldown. Test sends are excluded from the report.
        </p>
      </div>

      {!configured && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <p className="text-xs text-amber-800">
            Add a GHL tag and field key below before sending a test. Without them
            there is no workflow to fire.
          </p>
        </div>
      )}

      {/* Member picker */}
      {member ? (
        <div className="flex items-center justify-between gap-3 bg-bg border border-border rounded-lg px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">
              {member.first_name} {member.last_name}
            </p>
            <p className="text-xs text-text-muted truncate">
              {member.email} · club {member.club_number}
              {member.is_active ? '' : ' · inactive'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setMember(null); setQuery(''); setResult(null); setError('') }}
            className="text-xs font-semibold text-text-muted hover:text-text-primary shrink-0"
          >
            Change
          </button>
        </div>
      ) : (
        <div>
          <label className={labelClass}>Who is this going to?</label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email or member id"
            className={inputClass}
          />
          {searching && <p className="text-xs text-text-muted mt-1.5">Searching…</p>}
          {!searching && query.trim().length >= 2 && results.length === 0 && (
            <p className="text-xs text-text-muted mt-1.5">
              Nobody matches that. Members without an email cannot be surveyed and are not listed.
            </p>
          )}
          {results.length > 0 && (
            <ul className="mt-2 border border-border rounded-lg divide-y divide-border overflow-hidden">
              {results.map(m => (
                <li key={m.member_id}>
                  <button
                    type="button"
                    onClick={() => { setMember(m); setResults([]) }}
                    className="w-full text-left px-3 py-2 hover:bg-bg transition-colors"
                  >
                    <span className="block text-sm text-text-primary">
                      {m.first_name} {m.last_name}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {m.email} · club {m.club_number}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={fire}
        disabled={!member || firing || !configured}
        className="px-4 py-2 text-sm font-medium bg-wcs-red text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {firing ? 'Sending…' : 'Send it'}
      </button>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="bg-bg border border-border rounded-lg p-3 space-y-2">
          <p className="text-xs text-text-primary font-semibold">
            {result.ghl?.tagged
              ? `Tagged in GHL · ${result.contact?.location}`
              : 'Invite created, but GHL did not accept it'}
          </p>

          {result.ghl?.errors?.length > 0 && (
            <ul className="text-xs text-red-700 list-disc pl-4">
              {result.ghl.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}

          <div className="flex items-center gap-2">
            <a
              href={result.url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-wcs-red hover:underline truncate"
            >
              {result.url}
            </a>
            <button
              type="button"
              onClick={copyUrl}
              className="text-[10px] font-semibold text-wcs-red hover:text-wcs-red/70 shrink-0"
            >
              {copied ? <span className="text-green-600 animate-pulse">Copied!</span> : 'Copy'}
            </button>
          </div>

          <p className="text-[11px] text-text-muted">
            Open the link yourself to check the survey renders, or wait for the
            email to confirm the workflow fired.
          </p>
        </div>
      )}
    </div>
  )
}
