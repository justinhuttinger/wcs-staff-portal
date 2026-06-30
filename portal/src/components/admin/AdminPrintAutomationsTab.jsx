import { useEffect, useState } from 'react'
import { getPrintAutomations, updatePrintAutomation, getLocations } from '../../lib/api'

export default function AdminPrintAutomationsTab() {
  const [rows, setRows] = useState([])     // [{ location_slug, label, enabled }]
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')

  async function load() {
    setLoading(true)
    try {
      const [{ locations }, { automations }] = await Promise.all([getLocations(), getPrintAutomations()])
      const bySlug = Object.fromEntries((automations || []).map(a => [a.location_slug, a]))
      setRows((locations || []).map(l => {
        const slug = l.name.toLowerCase()
        return { location_slug: slug, label: l.name, enabled: !!(bySlug[slug] && bySlug[slug].enabled) }
      }))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function save(slug, patch) {
    setBusy(slug)
    try { await updatePrintAutomation(slug, patch); await load() }
    finally { setBusy('') }
  }

  if (loading) return <div className="p-4 text-text-muted">Loading...</div>

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-text-muted">Print a till-close receipt automatically when the PM drawer close is submitted in Operandio. Requires an enabled device with a printer for that location.</p>
      {rows.map(r => (
        <div key={r.location_slug} className="bg-surface border border-border rounded-lg p-3 flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-text-primary">{r.label}</div>
            <div className="text-xs text-text-muted">Prints when the drawer close count is submitted</div>
          </div>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" checked={r.enabled} disabled={busy === r.location_slug}
              onChange={e => save(r.location_slug, { enabled: e.target.checked })} />
            Print on close
          </label>
        </div>
      ))}
    </div>
  )
}
