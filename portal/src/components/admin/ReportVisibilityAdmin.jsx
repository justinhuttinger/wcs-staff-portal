import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { LOCATION_NAMES } from '../../config/locations'
import { reportOffKey } from '../analyticsReportCatalogue'
import { REPORT_META, REPORT_GROUPS } from '../AnalyticsView'

// ---------------------------------------------------------------------------
// Report Visibility — which Analytics reports each club can see.
//
// Not every report means something everywhere. A club with no childcare room
// has no childcare report to read, and leaving it on the menu is a standing
// invitation to open an empty page and wonder what broke.
//
// STORED AS "OFF", NOT "ON": report_off_<key>_<slug> = '1'. A new report is
// therefore visible everywhere the moment it ships, rather than invisible
// everywhere until somebody remembers to enable it seven times. Absence of a
// setting is the safe state.
//
// The report list comes from the shell's OWN registry rather than a copy typed
// here, so a report added to Analytics appears in this grid automatically and
// cannot be toggled into a key nothing reads. The audit toggles kept two lists
// and a comment asking the next person to keep them in step; this keeps one.
// ---------------------------------------------------------------------------

const CLUBS = LOCATION_NAMES.map(n => ({ slug: n.toLowerCase(), label: n }))

// Which section each report sits under, for the label beside its name.
const GROUP_OF = (() => {
  const m = new Map()
  for (const g of REPORT_GROUPS) {
    for (const key of g.reports) if (!m.has(key)) m.set(key, g.label)
  }
  return m
})()

const CATALOGUE = REPORT_META.map(r => ({ ...r, group: GROUP_OF.get(r.key) || null }))

export default function ReportVisibilityAdmin() {
  const [settings, setSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getAppSettings('report_off_')
      .then(map => setSettings(map || {}))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggle = (key) => {
    setSettings(prev => ({ ...prev, [key]: prev[key] === '1' ? '' : '1' }))
    setMessage(null)
  }

  /** Turn a whole row on or off in one go — seven clicks is not a feature. */
  const setRow = (reportKey, off) => {
    setSettings(prev => {
      const next = { ...prev }
      for (const c of CLUBS) next[reportOffKey(reportKey, c.slug)] = off ? '1' : ''
      return next
    })
    setMessage(null)
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings(settings)
      setMessage({ type: 'success', text: 'Saved' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-text-muted py-4">Loading…</p>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary">Report Visibility</h2>
        <p className="text-xs text-text-muted mt-1 max-w-3xl">
          Untick a club to hide that report from it. Reports are visible by default, so a
          new one appears everywhere until you hide it here. When several clubs are selected
          in Analytics, a report shows if it is on for at least one of them — otherwise a
          report hidden at a single club would disappear company-wide.
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-2 px-3 min-w-[220px]">Report</th>
              {CLUBS.map(c => (
                <th key={c.slug} className="font-semibold py-2 px-2 text-center whitespace-nowrap">
                  {c.label}
                </th>
              ))}
              <th className="font-semibold py-2 px-3 text-right whitespace-nowrap">All / None</th>
            </tr>
          </thead>
          <tbody>
            {CATALOGUE.map(r => (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 px-3 text-text-primary">
                  {r.label}
                  {r.group && <span className="text-[11px] text-text-muted ml-2">{r.group}</span>}
                </td>
                {CLUBS.map(c => {
                  const key = reportOffKey(r.key, c.slug)
                  const on = settings[key] !== '1'
                  return (
                    <td key={c.slug} className="py-1.5 px-2 text-center">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(key)}
                        aria-label={`${r.label} at ${c.label}`}
                        className="h-4 w-4 accent-wcs-red cursor-pointer"
                      />
                    </td>
                  )
                })}
                <td className="py-1.5 px-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => setRow(r.key, false)}
                    className="text-[11px] font-semibold text-text-muted hover:text-wcs-red">All</button>
                  <span className="text-text-muted mx-1">/</span>
                  <button type="button" onClick={() => setRow(r.key, true)}
                    className="text-[11px] font-semibold text-text-muted hover:text-wcs-red">None</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && (
          <span className={`text-sm ${message.type === 'error' ? 'text-wcs-red' : 'text-green-600'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
