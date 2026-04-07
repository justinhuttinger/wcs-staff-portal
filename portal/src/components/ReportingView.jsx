import { useState } from 'react'
import MembershipReport from './reports/MembershipReport'
import PTReport from './reports/PTReport'
import VIPReport from './reports/VIPReport'
import PipelineReport from './reports/PipelineReport'

const REPORT_TABS = [
  { key: 'membership', label: 'Membership' },
  { key: 'pt', label: 'PT' },
  { key: 'vip', label: 'VIP' },
  { key: 'pipelines', label: 'Pipelines' },
]

function getDateStr(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().split('T')[0]
}

function getMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

export default function ReportingView({ user, onBack }) {
  const [activeTab, setActiveTab] = useState('membership')
  const [startDate, setStartDate] = useState(getMonthStart())
  const [endDate, setEndDate] = useState(getDateStr())

  const locationId = user?.staff?.locations?.find(l => l.is_primary)?.id

  return (
    <div className="w-full px-8 py-6">
      <div className="mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">Reporting</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">From</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-text-muted">To</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        {REPORT_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-wcs-red text-wcs-red'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'membership' && <MembershipReport startDate={startDate} endDate={endDate} locationId={locationId} />}
      {activeTab === 'pt' && <PTReport startDate={startDate} endDate={endDate} locationId={locationId} />}
      {activeTab === 'vip' && <VIPReport startDate={startDate} endDate={endDate} locationId={locationId} />}
      {activeTab === 'pipelines' && <PipelineReport locationId={locationId} />}
    </div>
  )
}
