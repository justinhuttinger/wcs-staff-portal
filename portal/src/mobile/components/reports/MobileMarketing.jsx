import React, { useState } from 'react'

const TABS = [
  { key: 'meta', label: 'Meta Ads' },
  { key: 'google', label: 'Google' },
]

export default function MobileMarketing({ onNavigate }) {
  const [activeTab, setActiveTab] = useState(null)

  if (!activeTab) {
    return (
      <div className="p-4">
        <h2 className="text-lg font-bold text-text-primary mb-4">Marketing</h2>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setActiveTab('meta')}
            className="bg-surface rounded-2xl border border-border p-4 text-left active:scale-[0.97] transition-transform"
          >
            <div className="text-wcs-red mb-2">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-primary">Meta Ads</p>
            <p className="text-xs text-text-muted mt-0.5">Facebook & Instagram</p>
          </button>
          <button
            onClick={() => setActiveTab('google')}
            className="bg-surface rounded-2xl border border-border p-4 text-left active:scale-[0.97] transition-transform"
          >
            <div className="text-wcs-red mb-2">
              <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21.35 11.1h-9.18v2.73h5.51c-.24 1.28-.97 2.36-2.06 3.09v2.57h3.33c1.95-1.8 3.07-4.44 3.07-7.59 0-.52-.05-1.02-.14-1.5l-.53.7z" />
                <path d="M12.17 22c2.78 0 5.11-.92 6.82-2.51l-3.33-2.57c-.93.62-2.11.98-3.49.98-2.69 0-4.96-1.81-5.77-4.24H2.95v2.65A10.18 10.18 0 0012.17 22z" />
                <path d="M6.4 13.66a6.1 6.1 0 010-3.87V7.14H2.95a10.18 10.18 0 000 9.17l3.45-2.65z" />
                <path d="M12.17 5.55c1.52 0 2.88.52 3.95 1.54l2.96-2.96C17.27 2.49 14.95 1.45 12.17 1.45A10.18 10.18 0 002.95 7.14l3.45 2.65c.81-2.43 3.08-4.24 5.77-4.24z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-text-primary">Google</p>
            <p className="text-xs text-text-muted mt-0.5">Business Profile</p>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4">
      {/* Tab toggle */}
      <div className="flex bg-bg rounded-xl p-1 mb-4">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-muted'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Placeholder content */}
      <div className="bg-surface rounded-2xl border border-border p-8 text-center">
        <div className="text-text-muted mb-4">
          {activeTab === 'meta' ? (
            <svg className="w-12 h-12 mx-auto" viewBox="0 0 24 24" fill="currentColor" opacity={0.3}>
              <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 008.44-9.9c0-5.53-4.5-10.02-10-10.02z" />
            </svg>
          ) : (
            <svg className="w-12 h-12 mx-auto" viewBox="0 0 24 24" fill="currentColor" opacity={0.3}>
              <path d="M21.35 11.1h-9.18v2.73h5.51c-.24 1.28-.97 2.36-2.06 3.09v2.57h3.33c1.95-1.8 3.07-4.44 3.07-7.59 0-.52-.05-1.02-.14-1.5l-.53.7z" />
              <path d="M12.17 22c2.78 0 5.11-.92 6.82-2.51l-3.33-2.57c-.93.62-2.11.98-3.49.98-2.69 0-4.96-1.81-5.77-4.24H2.95v2.65A10.18 10.18 0 0012.17 22z" />
              <path d="M6.4 13.66a6.1 6.1 0 010-3.87V7.14H2.95a10.18 10.18 0 000 9.17l3.45-2.65z" />
              <path d="M12.17 5.55c1.52 0 2.88.52 3.95 1.54l2.96-2.96C17.27 2.49 14.95 1.45 12.17 1.45A10.18 10.18 0 002.95 7.14l3.45 2.65c.81-2.43 3.08-4.24 5.77-4.24z" />
            </svg>
          )}
        </div>
        <h3 className="text-base font-semibold text-text-primary mb-1">
          {activeTab === 'meta' ? 'Meta Ads' : 'Google Business Profile'}
        </h3>
        <p className="text-sm text-text-muted mb-4">
          {activeTab === 'meta'
            ? 'View Facebook & Instagram ad performance'
            : 'View Google Business Profile insights'}
        </p>
        <button
          disabled
          className="bg-bg text-text-muted rounded-xl px-6 py-2.5 text-sm font-medium cursor-not-allowed"
        >
          Coming Soon
        </button>
      </div>
    </div>
  )
}
