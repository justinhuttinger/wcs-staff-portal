import { useState, useEffect } from 'react'
import { groupXAttendanceLinks } from '../../lib/api'

// Admin -> Group X -> Attendance links. One secret, login-free page per club
// where the desk logs how many came to each class. Same idea as the Tour
// Check-In links: whoever has the URL can use it, so Regenerate kills a leaked one.

function linkUrl(token) {
  return token ? `${window.location.origin}/groupx.html?token=${token}` : ''
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* nothing else to try */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`px-2.5 py-1 text-xs rounded-md border font-medium transition-all duration-200 whitespace-nowrap ${
        copied
          ? 'bg-green-50 border-green-300 text-green-800 scale-105'
          : 'border-border text-text-primary hover:bg-bg'
      }`}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

export default function AttendanceLinks() {
  const [links, setLinks] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    groupXAttendanceLinks.list()
      .then(r => setLinks(r.links || []))
      .catch(e => setError(e.message))
  }, [])

  async function regenerate(link) {
    const verb = link.public_token ? 'Regenerate' : 'Create'
    if (link.public_token && !window.confirm(`Regenerate the ${link.name} link? The old link stops working immediately.`)) return
    setBusy(link.club_number)
    setError(null)
    try {
      const r = await groupXAttendanceLinks.regenerate(link.club_number)
      setLinks(ls => ls.map(l => (l.club_number === link.club_number ? { ...l, public_token: r.public_token } : l)))
    } catch (e) {
      setError(`${verb} failed: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-text-primary">Attendance links</h3>
        <span className="text-xs text-text-muted">
          No login needed. Open one on the club's desk tablet to log class headcounts.
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {links.map(l => {
              const url = linkUrl(l.public_token)
              return (
                <tr key={l.club_number} className="border-t border-border first:border-t-0">
                  <td className="py-2 pr-3 font-medium text-text-primary whitespace-nowrap align-top">{l.name}</td>
                  <td className="py-2 pr-3 w-full align-top">
                    <code className="block text-xs text-text-muted break-all font-mono">{url || 'No link yet'}</code>
                  </td>
                  <td className="py-2 align-top">
                    <div className="flex gap-1.5 justify-end">
                      {url && (
                        <>
                          <a href={url} target="_blank" rel="noreferrer"
                            className="px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg whitespace-nowrap">
                            Open
                          </a>
                          <CopyButton value={url} />
                        </>
                      )}
                      <button
                        type="button"
                        disabled={busy === l.club_number}
                        onClick={() => regenerate(l)}
                        className="px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg whitespace-nowrap disabled:opacity-50"
                      >
                        {l.public_token ? 'Regenerate' : 'Create'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
