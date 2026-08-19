import { useState } from 'react'
import EmailMarketingReport from './EmailMarketingReport'
import SmsMarketingReport from './SmsMarketingReport'

// Marketing Engagement: how automated outreach performs, per channel.
// Location and date range come from the Reporting shell as props, so both tabs
// stay in sync with the filters the user already set.

const TABS = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
]

export default function MarketingEngagementReport({ startDate, endDate, locationSlug, isAdmin }) {
  const [tab, setTab] = useState('email')

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-3 flex items-center gap-2">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              tab === t.key
                ? 'bg-wcs-red text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'email'
        ? <EmailMarketingReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} />
        : <SmsMarketingReport startDate={startDate} endDate={endDate} locationSlug={locationSlug} isAdmin={isAdmin} />}
    </div>
  )
}
