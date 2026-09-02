import React from 'react'
import MobileEmptyState from '../MobileEmptyState'

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
    key: 'cancels',
    label: 'Cancels',
    description: 'Cancellations and pending cancels',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
    key: 'pt-roster',
    label: 'PT Roster',
    description: 'Active PT clients by trainer',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  {
    key: 'checkins',
    label: 'Check-ins',
    description: 'Traffic & popular times',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M9 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-1.5a1.125 1.125 0 0 1-1.125-1.125V17.25m7.5 0v3.375c0 .621.504 1.125 1.125 1.125h1.5a1.125 1.125 0 0 0 1.125-1.125V17.25m-7.5 0h7.5M3 8.25v6a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3Z" />
      </svg>
    ),
  },
  {
    key: 'marketing',
    label: 'Meta Ads',
    description: 'Facebook & Instagram ads',
    icon: (
      // Cursor-arrow-rays: clicks + impressions
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zM12 2.25V4.5m5.834.166l-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243l-1.59-1.59" />
      </svg>
    ),
  },
  {
    key: 'google-marketing',
    label: 'Google Marketing',
    description: 'Business Profile & Analytics',
    icon: (
      // Magnifying glass: search + visibility
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
    ),
  },
  {
    key: 'operations',
    label: 'Operational Compliance',
    description: 'Operandio checklist tracking',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
      </svg>
    ),
  },
  {
    key: 'pt-sessions',
    label: 'Trainer Load',
    description: 'Session count by trainer',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    key: 'pt-new-clients',
    label: 'New Clients',
    description: 'New + Resign PT sales',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
      </svg>
    ),
  },
  {
    key: 'session-frequency',
    label: 'Session Frequency',
    description: 'Sessions per member per week',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
      </svg>
    ),
  },
  {
    key: 'deactivated-pt',
    label: 'Deactivated PT',
    description: 'Cancels + Burned PIFs',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
  },
  {
    key: 'pt-health',
    label: 'PT Health',
    description: 'Overall PT dashboard',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
      </svg>
    ),
  },
  {
    key: 'pt-projections',
    label: 'PT Projections',
    description: 'Projected vs collected PT revenue',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
      </svg>
    ),
  },
  {
    key: 'payroll',
    label: 'Payroll',
    description: 'Monthly commissions',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z" />
      </svg>
    ),
  },
  {
    key: 'revenue',
    label: 'Revenue',
    description: 'Dollars & profit centers',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18 9 11.25l4.306 4.307a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941" />
      </svg>
    ),
  },
  {
    key: 'kpis',
    label: 'KPIs',
    description: 'Goals vs. actuals',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
      </svg>
    ),
  },
  {
    key: 'audits',
    label: 'Audits',
    description: 'Operandio scores',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586" />
      </svg>
    ),
  },
]

function defaultTileKeysForRole(role) {
  switch (role) {
    case 'team_member':
      return []
    case 'lead':
      return ['membership', 'cancels', 'pt', 'pt-roster', 'checkins', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'pt-health']
    case 'manager':
      return ['membership', 'cancels', 'pt', 'club-health', 'pt-roster', 'checkins', 'operations', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt', 'pt-health', 'pt-projections', 'payroll', 'revenue']
    case 'marketing':
      return REPORT_TILES.map(t => t.key).filter(k => k !== 'kpis' && k !== 'audits')
    default: // corporate, admin, director
      return REPORT_TILES.map(t => t.key)
  }
}

// Role defaults plus any report granted via the roles grid (report:<key> in
// visible_tools), so a fully customizable role can be given any report.
function getTilesForRole(role, visibleTools) {
  const allowed = new Set(defaultTileKeysForRole(role))
  for (const key of (visibleTools || [])) {
    if (typeof key === 'string' && key.startsWith('report:')) allowed.add(key.slice('report:'.length))
  }
  return REPORT_TILES.filter(t => allowed.has(t.key))
}

// Reports shown as a standalone full-width tile above the group sections
// (mirrors desktop, where KPIs leads the report list).
const STANDALONE_REPORTS = ['kpis']

// Mirrors desktop ReportingView's REPORT_GROUPS. The third Marketing group is
// mobile-only because desktop houses those reports on a separate Marketing
// tile rather than under Reporting.
const REPORT_GROUPS = [
  {
    key: 'health',
    label: 'Club Health',
    description: 'Health, activity & compliance',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z" />
      </svg>
    ),
    reports: ['club-health', 'membership', 'cancels', 'operations', 'audits', 'checkins', 'payroll', 'revenue'],
  },
  {
    key: 'training',
    label: 'Training',
    description: 'PT reports',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
      </svg>
    ),
    reports: ['pt-health', 'pt', 'pt-roster', 'pt-sessions', 'pt-new-clients', 'session-frequency', 'deactivated-pt'],
  },
  {
    key: 'marketing-group',
    label: 'Marketing',
    description: 'Ads & online presence',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46" />
      </svg>
    ),
    reports: ['marketing', 'google-marketing'],
  },
]

function getVisibleGroups(role, visibleTools) {
  const visibleSet = new Set(getTilesForRole(role, visibleTools).map(t => t.key))
  return REPORT_GROUPS
    .map(g => ({ ...g, reports: g.reports.filter(k => visibleSet.has(k)) }))
    .filter(g => g.reports.length > 0)
}

export default function ReportsHome({ onNavigate, user, activeGroup, onSelectGroup }) {
  const role = user?.staff?.role || 'team_member'
  const visibleGroups = getVisibleGroups(role, user?.visible_tools)

  if (visibleGroups.length === 0) {
    return (
      <div className="p-4">
        <MobileEmptyState>No reports available for your role.</MobileEmptyState>
      </div>
    )
  }

  // Group detail view
  if (activeGroup) {
    const group = visibleGroups.find(g => g.key === activeGroup)
    if (!group) {
      // Asked-for group is empty or unknown for this role — fall back to home.
      return <ReportsHome onNavigate={onNavigate} user={user} onSelectGroup={onSelectGroup} />
    }
    const tilesById = Object.fromEntries(REPORT_TILES.map(t => [t.key, t]))
    return (
      <div className="p-4">
        <div className="grid grid-cols-2 gap-3">
          {group.reports.map(reportKey => {
            const tile = tilesById[reportKey]
            if (!tile) return null
            return (
              <button
                key={tile.key}
                onClick={() => onNavigate(tile.key)}
                className="bg-surface rounded-2xl border border-border p-4 text-left active:scale-[0.97] transition-transform"
              >
                <div className="text-wcs-red mb-2">{tile.icon}</div>
                <p className="text-sm font-semibold text-text-primary">{tile.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{tile.description}</p>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Top-level: standalone KPIs (full-width) + group section tiles
  const tilesById = Object.fromEntries(REPORT_TILES.map(t => [t.key, t]))
  const visibleKeys = new Set(getTilesForRole(role).map(t => t.key))
  const standalone = STANDALONE_REPORTS.filter(k => visibleKeys.has(k))
  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-3">
        {standalone.map(key => {
          const tile = tilesById[key]
          if (!tile) return null
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className="col-span-2 bg-surface rounded-2xl border border-border p-4 text-left active:scale-[0.97] transition-transform flex items-center gap-3"
            >
              <div className="text-wcs-red flex-shrink-0">{tile.icon}</div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">{tile.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{tile.description}</p>
              </div>
            </button>
          )
        })}
        {visibleGroups.map(group => (
          <button
            key={group.key}
            onClick={() => onSelectGroup(group.key)}
            className="bg-surface rounded-2xl border border-border p-4 text-left active:scale-[0.97] transition-transform"
          >
            <div className="text-wcs-red mb-2">{group.icon}</div>
            <p className="text-sm font-semibold text-text-primary">{group.label}</p>
            <p className="text-xs text-text-muted mt-0.5">{group.description}</p>
            <p className="text-[10px] text-text-muted mt-2 leading-snug">
              {group.reports.length} {group.reports.length === 1 ? 'report' : 'reports'}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

export { REPORT_GROUPS }
