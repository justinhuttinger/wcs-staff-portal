import { useState } from 'react'
import MembershipReport from './reports/MembershipReport'
import PTReport from './reports/PTReport'
import PipelineReport from './reports/PipelineReport'
import SalespersonStats from './reports/SalespersonStats'
import AdReports from './reports/AdReports'

const REPORT_TABS = [
  { key: 'salesperson', label: 'Salesperson Stats' },
  { key: 'membership', label: 'Membership' },
  { key: 'pt', label: 'PT' },
  { key: 'pipelines', label: 'Pipelines' },
  { key: 'ads', label: 'Ad Reports' },
]

const LOCATIONS = [
  { slug: 'all', label: 'All Locations' },
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

const QUICK_RANGES = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'ytd', label: 'YTD' },
]

function getQuickRange(key) {
  const now = new Date()
  const today = now.toISOString().split('T')[0]
  switch (key) {
    case 'this_month':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0], end: today }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { start: s.toISOString().split('T')[0], end: e.toISOString().split('T')[0] }
    }
    case 'last_30': {
      const s = new Date(now)
      s.setDate(s.getDate() - 30)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'last_90': {
      const s = new Date(now)
      s.setDate(s.getDate() - 90)
      return { start: s.toISOString().split('T')[0], end: today }
    }
    case 'ytd':
      return { start: new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0], end: today }
    default:
      return { start: today, end: today }
  }
}

function getMonthStart() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
}

function getToday() {
  return new Date().toISOString().split('T')[0]
}

export default function ReportingView({ user, onBack }) {
  const [activeTab, setActiveTab] = useState('salesperson')
  const [startDate, setStartDate] = useState(getMonthStart())
  const [endDate, setEndDate] = useState(getToday())
  const [locationSlug, setLocationSlug] = useState('all')
  const [activeQuick, setActiveQuick] = useState('this_month')

  function applyQuickRange(key) {
    setActiveQuick(key)
    const range = getQuickRange(key)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  function handleDateChange(field, value) {
    setActiveQuick(null)
    if (field === 'start') setStartDate(value)
    else setEndDate(value)
  }

  return (
    <div className="w-full px-8 py-6">
      {/* Header */}
      <div className="mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-xl font-bold text-text-primary">Reporting</h2>
      </div>

      {/* Location Selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {LOCATIONS.map(loc => (
          <button
            key={loc.slug}
            onClick={() => setLocationSlug(loc.slug)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              locationSlug === loc.slug
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {/* Date Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        {/* Quick range buttons */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_RANGES.map(qr => (
            <button
              key={qr.key}
              onClick={() => applyQuickRange(qr.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                activeQuick === qr.key
                  ? 'bg-text-primary text-white border-text-primary'
                  : 'bg-surface text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {qr.label}
            </button>
          ))}
        </div>
        {/* Manual date pickers */}
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-text-muted">From</label>
          <input
            type="date"
            value={startDate}
            onChange={e => handleDateChange('start', e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          <label className="text-xs text-text-muted">To</label>
          <input
            type="date"
            value={endDate}
            onChange={e => handleDateChange('end', e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
        </div>
      </div>

      {/* Tab Bar */}
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

      {/* Tab Content */}
      {activeTab === 'salesperson' && (
        <SalespersonStats startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
      )}
      {activeTab === 'membership' && (
        <MembershipReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
      )}
      {activeTab === 'pt' && (
        <PTReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
      )}
      {activeTab === 'pipelines' && (
        <PipelineReport locationSlug={locationSlug} />
      )}
      {activeTab === 'ads' && (
        <AdReports startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
      )}
    </div>
  )
}
