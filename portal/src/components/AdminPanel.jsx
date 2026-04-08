import { useState } from 'react'
import AdminStaffTab from './AdminStaffTab'
import AdminTilesTab from './AdminTilesTab'
import AdminRolesTab from './AdminRolesTab'
import AdminReferencesTab from './AdminReferencesTab'
import SyncStatusTile from './SyncStatusTile'

const ADMIN_TILES = [
  { key: 'staff', label: 'Staff', description: 'Manage staff accounts, roles, and locations', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { key: 'tiles', label: 'Tiles', description: 'Configure portal tiles, groups, and sections', icon: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z' },
  { key: 'roles', label: 'Roles', description: 'Set tool visibility per role', icon: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z' },
  { key: 'references', label: 'References', description: 'Webhook URLs, sync endpoints, service links', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.939a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757' },
]

export default function AdminPanel({ onBack }) {
  const [activeSection, setActiveSection] = useState(null)

  if (activeSection) {
    const tile = ADMIN_TILES.find(t => t.key === activeSection)
    return (
      <div className="w-full px-8 py-6">
        <div className="mb-6">
          <button
            onClick={() => setActiveSection(null)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </button>
          <h2 className="text-xl font-bold text-text-primary">{tile?.label}</h2>
        </div>
        {activeSection === 'staff' && <AdminStaffTab />}
        {activeSection === 'tiles' && <AdminTilesTab />}
        {activeSection === 'roles' && <AdminRolesTab />}
        {activeSection === 'references' && <AdminReferencesTab />}
      </div>
    )
  }

  return (
    <div className="w-full px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text-primary">Admin Panel</h2>
        <button onClick={onBack}
          className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary transition-colors">
          Back to Portal
        </button>
      </div>

      {/* Admin Tiles Grid */}
      <div className="grid grid-cols-2 gap-4 max-w-2xl mb-6">
        {ADMIN_TILES.map(tile => (
          <button
            key={tile.key}
            onClick={() => setActiveSection(tile.key)}
            className="bg-surface rounded-xl border border-border p-5 text-left hover:border-wcs-red hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-bg flex items-center justify-center flex-shrink-0 group-hover:bg-wcs-red/10 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-text-muted group-hover:text-wcs-red transition-colors">
                  <path strokeLinecap="round" strokeLinejoin="round" d={tile.icon} />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary group-hover:text-wcs-red transition-colors">{tile.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{tile.description}</p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Sync Status */}
      <div className="max-w-2xl">
        <p className="text-xs text-text-muted uppercase tracking-wide font-semibold mb-3">System Status</p>
        <SyncStatusTile />
      </div>
    </div>
  )
}
