import { useState } from 'react'
import AdminStaffTab from './AdminStaffTab'
import AdminTilesTab from './AdminTilesTab'
import AdminRolesTab from './AdminRolesTab'
import AdminReferencesTab from './AdminReferencesTab'
import AdminConfig from './AdminConfig'
import SyncStatusTile from './SyncStatusTile'
import WebhookLogs from './admin/WebhookLogs'
import BulkImportTab from './admin/BulkImportTab'
import SMSHistoryTab from './admin/SMSHistoryTab'

const ADMIN_TILES = [
  { key: 'staff', label: 'Staff', description: 'Manage staff accounts, roles, and locations', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { key: 'import', label: 'Import Staff', description: 'Bulk import staff from Excel template', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5' },
  { key: 'tiles', label: 'Tiles', description: 'Configure portal tiles, groups, and sections', icon: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z' },
  { key: 'roles', label: 'Roles', description: 'Set tool visibility per role', icon: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z' },
  { key: 'references', label: 'References', description: 'Webhook URLs, sync endpoints, service links', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.939a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757' },
  { key: 'config', label: 'App Config', description: 'Kiosk location, ABC URL settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z' },
  { key: 'sms', label: 'SMS History', description: 'View inbound SMS messages from Twilio', icon: 'M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z' },
  { key: 'webhooks', label: 'Webhooks', description: 'View Day One webhook history and payloads', icon: 'M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m-6 3.75 3 3m0 0 3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25H9' },
]

export default function AdminPanel({ onBack, isElectron }) {
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
        {activeSection === 'import' && <BulkImportTab />}
        {activeSection === 'tiles' && <AdminTilesTab />}
        {activeSection === 'roles' && <AdminRolesTab />}
        {activeSection === 'references' && <AdminReferencesTab />}
        {activeSection === 'config' && <AdminConfig isElectron={isElectron} onClose={() => setActiveSection(null)} embedded />}
        {activeSection === 'sms' && <SMSHistoryTab />}
        {activeSection === 'webhooks' && <WebhookLogs />}
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
