import { useState } from 'react'
import MetaAdsView from './MetaAdsView'

export default function MarketingView({ onBack }) {
  const [activeReport, setActiveReport] = useState(null)

  if (activeReport === 'meta') {
    return <MetaAdsView onBack={() => setActiveReport(null)} />
  }

  if (activeReport === 'google') {
    return (
      <div className="max-w-3xl mx-auto w-full px-8 py-6">
        <div className="mb-6">
          <button
            onClick={() => setActiveReport(null)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Marketing
          </button>
          <h2 className="text-xl font-bold text-text-primary">Google Ads</h2>
          <p className="text-sm text-text-muted">Coming soon</p>
        </div>
        <div className="bg-surface border border-border rounded-xl p-8 text-center">
          <p className="text-text-muted text-sm">Google Ads integration is not yet configured.</p>
          <p className="text-text-muted text-xs mt-2">Requires: Google Ads Customer ID, Developer Token, and OAuth credentials.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
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
        <h2 className="text-xl font-bold text-text-primary">Marketing</h2>
        <p className="text-sm text-text-muted">Ad Reports</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Meta / Facebook Ads */}
        <button
          onClick={() => setActiveReport('meta')}
          className="group relative flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
            </svg>
          </div>
          <div className="text-center">
            <span className="block text-base font-semibold text-text-primary">Meta Ads</span>
            <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">Facebook & Instagram</span>
          </div>
        </button>

        {/* Google Ads */}
        <button
          onClick={() => setActiveReport('google')}
          className="group relative flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
          </div>
          <div className="text-center">
            <span className="block text-base font-semibold text-text-primary">Google Ads</span>
            <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">Search & Display</span>
          </div>
        </button>
      </div>
    </div>
  )
}
