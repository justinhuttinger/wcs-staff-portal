import { useState, useEffect } from 'react'
import { getPipelineReport } from '../../lib/api'

export default function PipelineReport({ locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedPipeline, setExpandedPipeline] = useState(null)

  useEffect(() => { loadData() }, [locationSlug])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const res = await getPipelineReport(params)
      setData(res)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (loading) return <p className="text-text-muted text-sm py-8 text-center">Loading pipeline data...</p>
  if (error) return <p className="text-wcs-red text-sm py-4">{error}</p>
  if (!data) return null

  const pipelines = Object.entries(data.by_pipeline)

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-xl p-6 text-center">
        <p className="text-4xl font-bold text-text-primary">{data.total}</p>
        <p className="text-sm text-text-muted mt-1">Total Opportunities</p>
      </div>

      {pipelines.map(([pipeName, pipeData]) => {
        const stages = Object.entries(pipeData.stages)
        const isExpanded = expandedPipeline === pipeName

        return (
          <div key={pipeName} className="bg-surface border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setExpandedPipeline(isExpanded ? null : pipeName)}
              className="w-full px-6 py-4 flex items-center justify-between bg-bg hover:bg-border/30 transition-colors"
            >
              <div className="flex items-center gap-3">
                <h3 className="text-base font-semibold text-text-primary">{pipeName}</h3>
                <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-xs font-medium">{pipeData.total}</span>
              </div>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-5 h-5 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded && (
              <div className="px-6 pb-4">
                <div className="flex flex-wrap gap-3 my-4">
                  {stages.map(([stageName, opps]) => (
                    <div key={stageName} className="px-4 py-2 rounded-lg bg-bg border border-border">
                      <p className="text-lg font-bold text-text-primary">{opps.length}</p>
                      <p className="text-xs text-text-muted">{stageName}</p>
                    </div>
                  ))}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Contact</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Stage</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Status</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Assigned To</th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-text-muted">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stages.flatMap(([, opps]) => opps).map((opp, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-4 py-2 text-text-primary font-medium">{opp.contact_name || '—'}</td>
                          <td className="px-4 py-2">
                            <span className="px-2 py-0.5 rounded-full bg-bg border border-border text-xs text-text-muted">{opp.stage_name || '—'}</span>
                          </td>
                          <td className="px-4 py-2 text-text-muted text-xs">{opp.status || '—'}</td>
                          <td className="px-4 py-2 text-text-muted text-xs">{opp.assigned_to || '—'}</td>
                          <td className="px-4 py-2 text-right text-text-primary font-medium">
                            {opp.monetary_value ? '$' + Number(opp.monetary_value).toLocaleString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {pipelines.length === 0 && <p className="text-center text-text-muted text-sm py-8">No pipeline data. Run a sync first.</p>}
    </div>
  )
}
