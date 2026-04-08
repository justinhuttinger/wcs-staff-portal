import { useState } from 'react'

const AD_TABS = [
  { key: 'meta', label: 'Meta (Facebook)' },
  { key: 'google', label: 'Google Ads' },
]

const CAMPAIGN_FILTERS = [
  { key: 'all', label: 'All Campaigns' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
]

const TABLE_COLS = ['Campaign', 'Budget', 'Spend', 'Leads', 'CPL', 'Sales', 'ROAS', 'Last Updated']

export default function AdReports({ startDate, endDate, locationSlug }) {
  const [adTab, setAdTab] = useState('meta')
  const [campaignFilter, setCampaignFilter] = useState('all')

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-border">
        {AD_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setAdTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              adTab === tab.key
                ? 'border-wcs-red text-wcs-red'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Connection Placeholder */}
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-bg border border-border flex items-center justify-center mx-auto mb-4">
          {adTab === 'meta' ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-text-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6 text-text-muted">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 15.803M15.803 15.803L21 21" />
            </svg>
          )}
        </div>
        <p className="text-text-primary font-medium mb-1">
          Connect your {adTab === 'meta' ? 'Meta (Facebook)' : 'Google Ads'} account to see ad performance
        </p>
        <p className="text-sm text-text-muted">
          Ad reporting will show campaign performance, spend, leads, and ROAS once connected.
        </p>
        <button
          disabled
          className="mt-4 px-4 py-2 rounded-lg bg-bg border border-border text-text-muted text-sm cursor-not-allowed"
        >
          Connect {adTab === 'meta' ? 'Meta' : 'Google Ads'} — Coming Soon
        </button>
      </div>

      {/* Campaign Filter Pills */}
      <div className="flex gap-2">
        {CAMPAIGN_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setCampaignFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              campaignFilter === f.key
                ? 'bg-text-primary text-white border-text-primary'
                : 'bg-surface text-text-muted border-border hover:text-text-primary'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Empty Table Structure */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden opacity-50">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              {TABLE_COLS.map(col => (
                <th key={col} className="text-left px-4 py-3 text-xs font-semibold text-text-muted uppercase whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={TABLE_COLS.length} className="px-4 py-8 text-center text-text-muted text-sm italic">
                No campaigns to display — connect your ad account to get started
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
