import { useState } from 'react'

// Where the public board is served from. The board lives on the auth API, not
// the portal, so this is derived from VITE_API_URL rather than window.location.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function boardUrl(slug, areaKey) {
  return `${API_URL}/public/group-x/board?club=${slug}${areaKey ? `&area=${areaKey}` : ''}`
}

// One row per board. A club split by area (Group X / Ultimate) gets its plain
// URL, which shows a switch between the two and is the one for the website,
// plus a pinned URL per area for the TV in each room.
function rowsFor(clubs) {
  return clubs.flatMap(c => {
    const plain = { key: c.slug, slug: c.slug, name: c.name, label: c.name }
    if (!Array.isArray(c.areas) || c.areas.length < 2) return [plain]
    return [
      { ...plain, label: `${c.name} (website, both)` },
      ...c.areas.map(a => ({ key: `${c.slug}:${a.key}`, slug: c.slug, name: `${c.name} ${a.label}`, label: `${c.name} - ${a.label} TV`, areaKey: a.key })),
    ]
  })
}

function embedCode(slug, name, areaKey) {
  return `<iframe src="${boardUrl(slug, areaKey)}" title="${name} Group X class schedule" style="width:100%;height:820px;border:0" loading="lazy"></iframe>`
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
            {rowsFor(clubs).map(c => {
              const value = showEmbed ? embedCode(c.slug, c.name, c.areaKey) : boardUrl(c.slug, c.areaKey)
              return (
                <tr key={c.key} className="border-t border-border first:border-t-0">
                  <td className="py-2 pr-3 font-medium text-text-primary whitespace-nowrap align-top">
                    {c.label}
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
