import React from 'react'

const REPORT_TILES = [
  {
    key: 'club-health',
    label: 'Club Health',
    description: 'Overall club performance metrics',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v-5.5m3 5.5V8.25m3 3v-2" />
      </svg>
    ),
  },
  {
    key: 'membership',
    label: 'Membership',
    description: 'Sales, VIPs, and conversions',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
  {
    key: 'pt',
    label: 'PT / Day One',
    description: 'Training appointments and closes',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
      </svg>
    ),
  },
  {
    key: 'marketing',
    label: 'Marketing',
    description: 'Meta Ads and Google profiles',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38a.954.954 0 01-1.233-.21 23.905 23.905 0 01-3.212-6.027M10.34 15.84A23.653 23.653 0 019 12c0-1.35.11-2.674.34-3.96m0 7.8a23.745 23.745 0 011.966-5.822M10.34 8.16c1.544-2.206 3.594-3.94 5.966-5.073A.9.9 0 0117.25 3.9v.143a2.25 2.25 0 01.398 1.257l.09.898a23.98 23.98 0 000 11.604l-.09.898a2.25 2.25 0 01-.398 1.257v.143a.9.9 0 01-.944.813 15.6 15.6 0 01-5.966-5.073" />
      </svg>
    ),
  },
]

export default function ReportsHome({ onNavigate }) {
  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-text-primary mb-4">Reports</h2>
      <div className="grid grid-cols-2 gap-3">
        {REPORT_TILES.map(tile => (
          <button
            key={tile.key}
            onClick={() => onNavigate(tile.key)}
            className="bg-surface rounded-2xl border border-border p-4 text-left active:scale-[0.97] transition-transform"
          >
            <div className="text-wcs-red mb-2">{tile.icon}</div>
            <p className="text-sm font-semibold text-text-primary">{tile.label}</p>
            <p className="text-xs text-text-muted mt-0.5">{tile.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
