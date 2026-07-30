import { useState } from 'react'

// Where the public board is served from. The board lives on the auth API, not
// the portal, so this is derived from VITE_API_URL rather than window.location.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function boardUrl(slug) {
  return `${API_URL}/public/group-x/board?club=${slug}`
}

function embedCode(slug, name) {
  return `<iframe src="${boardUrl(slug)}" title="${name} Group X class schedule" style="width:100%;height:820px;border:0" loading="lazy"></iframe>`
}

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard API needs a secure context. Fall back to a hidden textarea so
      // the button still works over plain http on the kiosk machines.
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
      {copied ? 'Copied!' : label}
    </button>
  )
}

export default function BoardLinks({ clubs }) {
  const [showEmbed, setShowEmbed] = useState(false)

  return (
    <div className="bg-surface rounded-xl border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-text-primary">Class board links</h3>
        <span className="text-xs text-text-muted">
          Point a gym TV at these, or embed them on the website.
        </span>
        <button
          type="button"
          onClick={() => setShowEmbed(v => !v)}
          className="ml-auto px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg"
        >
          {showEmbed ? 'Show URLs' : 'Show embed code'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {clubs.map(c => {
              const value = showEmbed ? embedCode(c.slug, c.name) : boardUrl(c.slug)
              return (
                <tr key={c.slug} className="border-t border-border first:border-t-0">
                  <td className="py-2 pr-3 font-medium text-text-primary whitespace-nowrap align-top">
                    {c.name}
                  </td>
                  <td className="py-2 pr-3 w-full align-top">
                    <code className="block text-xs text-text-muted break-all font-mono">{value}</code>
                  </td>
                  <td className="py-2 align-top">
                    <div className="flex gap-1.5 justify-end">
                      {!showEmbed && (
                        <a
                          href={value}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 text-xs rounded-md border border-border text-text-primary hover:bg-bg whitespace-nowrap"
                        >
                          Open
                        </a>
                      )}
                      <CopyButton value={value} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">
        The board shows Monday to Sunday and re-reads the date on every refresh, so a screen
        left running rolls over to the new week on its own.
      </p>
    </div>
  )
}
