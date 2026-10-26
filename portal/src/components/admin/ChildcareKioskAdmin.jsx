import { useState, useEffect } from 'react'
import { childcareLinks } from '../../lib/api'

// Admin -> Childcare Kiosk. Two secret, login-free links per club:
//   Check-in form  the childcare iPad: check children in and out
//   Room view      read-only: who is in the room now (no phones, no actions)
// Whoever has a URL can use it, so Regenerate kills a leaked one.

const KINDS = [
  { kind: 'form', label: 'Check-in form', param: 'token', field: 'form_token' },
  { kind: 'view', label: 'Room view (read-only)', param: 'view', field: 'view_token' },
]

function linkUrl(param, token) {
  return token ? `${window.location.origin}/childcare.html?${param}=${token}` : ''
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

export default function ChildcareKioskAdmin() {
  const [links, setLinks] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    childcareLinks.list()
      .then(r => setLinks(r.links || []))
      .catch(e => setError(e.message))
  }, [])

  async function regenerate(link, k) {
    const existing = link[k.field]
    if (existing && !window.confirm(`Regenerate the ${link.name} ${k.label.toLowerCase()} link? The old link stops working immediately.`)) return
    setBusy(`${link.club_number}:${k.kind}`)
    setError(null)
    try {
      const r = await childcareLinks.regenerate(link.club_number, k.kind)
      setLinks(ls => ls.map(l => (l.club_number === link.club_number ? { ...l, [k.field]: r.token } : l)))
    } catch (e) {
      setError(`${existing ? 'Regenerate' : 'Create'} failed: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-text-primary">Childcare Kiosk</h3>
        <span className="text-xs text-text-muted">
          No login needed. Open the check-in form on the childcare iPad and Add to Home Screen.
          The room view only shows who is checked in right now.
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {links.map(l => KINDS.map((k, i) => {
              const url = linkUrl(k.param, l[k.field])
              return (
                <tr key={`${l.club_number}:${k.kind}`} className={i === 0 ? 'border-t border-border first:border-t-0' : ''}>
                  <td className="py-2 pr-3 font-medium text-text-primary whitespace-nowrap align-top">{i === 0 ? l.name : ''}</td>
                  <td className="py-2 pr-3 text-text-muted whitespace-nowrap align-top">{k.label}</td>
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
                        disabled={busy === `${l.club_number}:${k.kind}`}
                        onClick={() => regenerate(l, k)}
                        className="px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg whitespace-nowrap disabled:opacity-50"
                      >
                        {url ? 'Regenerate' : 'Create'}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            }))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
