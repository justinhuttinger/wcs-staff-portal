import { useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function boardUrl(clubSlug, facilitySlug) {
  return `${API_URL}/public/facility/board?club=${clubSlug}&facility=${facilitySlug}`
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard API needs a secure context. Fall back so the kiosk machines
      // on plain http still work.
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

export default function FacilityBoardLinks({ clubs, facilities }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-text-primary">Board links</h3>
        <p className="text-xs text-text-muted">
          Point a TV at these or embed them on the website. Each board shows seven days
          starting today.
        </p>
      </div>

      {facilities.map(f => (
        <div key={f.slug}>
          <div className="text-xs font-semibold text-text-primary uppercase tracking-wide mb-1">
            {f.label}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {clubs.map(c => {
                  const url = boardUrl(c.slug, f.slug)
                  return (
                    <tr key={c.slug} className="border-t border-border first:border-t-0">
                      <td className="py-2 pr-3 font-medium text-text-primary whitespace-nowrap align-top">
                        {c.name}
                      </td>
                      <td className="py-2 pr-3 w-full align-top">
                        <code className="block text-xs text-text-muted break-all font-mono">{url}</code>
                      </td>
                      <td className="py-2 align-top">
                        <div className="flex gap-1.5 justify-end">
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg whitespace-nowrap"
                          >
                            Open
                          </a>
                          <CopyButton value={url} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}
