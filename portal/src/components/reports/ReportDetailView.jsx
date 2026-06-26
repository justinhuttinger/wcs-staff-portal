import { useMemo } from 'react'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { getReportDetail } from '../../lib/reportDetail'
import DesktopLoading from '../DesktopLoading'
import ReportDetailTable from './ReportDetailTable'

// The "See Detail" tab body for a report. Looks up the report's adapter, fetches
// the same endpoint the summary view uses (so the client cache usually serves it
// instantly), flattens the response into flat line items, and hands them to the
// generic grid.
export default function ReportDetailView({ reportKey, startDate, endDate, locationSlug }) {
  const config = getReportDetail(reportKey)
  const params = config ? config.buildParams({ startDate, endDate, locationSlug }) : null

  const { data, loading, error } = useCancellableFetch(
    (signal) => config.fetch(params, { cache: true, signal }),
    [reportKey, startDate, endDate, locationSlug]
  )

  const rows = useMemo(() => (config && data ? config.flatten(data) : []), [config, data])

  if (!config) return null
  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  return (
    <ReportDetailTable
      columns={config.columns}
      rows={rows}
      filename={config.filename({ startDate, endDate, locationSlug })}
    />
  )
}
