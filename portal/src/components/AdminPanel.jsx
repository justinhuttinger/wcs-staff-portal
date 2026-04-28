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
import PaychexAdmin from './admin/PaychexAdmin'
import TicketEmbedsAdmin from './admin/TicketEmbedsAdmin'
import DriveFoldersAdmin from './admin/DriveFoldersAdmin'
import GoogleConnections from './admin/GoogleConnections'
import LayoutExplorer from './admin/LayoutExplorer'
import ABCSyncAdmin from './admin/ABCSyncAdmin'
import CustomFieldsAdmin from './admin/CustomFieldsAdmin'
import ActionLinksAdmin from './admin/ActionLinksAdmin'

const SETUP_TILES = [
  { key: 'staff', label: 'Staff', desc: 'Accounts & Roles', icon: 'M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z' },
  { key: 'import', label: 'Import Staff', desc: 'Bulk Excel Upload', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5' },
  { key: 'tiles', label: 'Tiles', desc: 'Portal Layout', icon: 'M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z' },
  { key: 'roles', label: 'Roles', desc: 'Tool Visibility', icon: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z' },
  { key: 'config', label: 'App Config', desc: 'Kiosk Settings', icon: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z' },
  { key: 'tickets', label: 'Tickets', desc: 'Embed Config', icon: 'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z' },
  { key: 'drive-folders', label: 'Drive Folders', desc: 'Shared Drive Tiles', icon: 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z' },
  { key: 'layouts', label: 'Layouts', desc: 'Explore UI Options', icon: 'M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 0 1-1.125-1.125v-3.75ZM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-8.25ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 0 1-1.125-1.125v-2.25Z' },
  { key: 'action-links', label: 'Action Links', desc: 'Day One & VIP URLs', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.939a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757' },
]

const TECHNICAL_TILES = [
  { key: 'sync', label: 'GHL Sync', desc: 'Sync Health', icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182' },
  { key: 'abc-sync', label: 'ABC Sync', desc: 'Member Reconciliation', icon: 'M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
  { key: 'paychex', label: 'Paychex', desc: 'API & Companies', icon: 'M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z' },
  { key: 'references', label: 'References', desc: 'Links & URLs', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m9.86-4.939a4.5 4.5 0 0 0-1.242-7.244l4.5-4.5a4.5 4.5 0 0 1 6.364 6.364l-1.757 1.757' },
  { key: 'sms', label: 'SMS History', desc: 'Twilio Messages', icon: 'M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z' },
  { key: 'webhooks', label: 'Webhooks', desc: 'Webhook History', icon: 'M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m-6 3.75 3 3m0 0 3-3m-3 3V1.5m6 9h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-7.5a2.25 2.25 0 0 1 2.25-2.25H9' },
  { key: 'custom-fields', label: 'Custom Fields', desc: 'GHL Field Lookup', icon: 'M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 0 1 0 3.75H5.625a1.875 1.875 0 0 1 0-3.75Z' },
  { key: 'google-connections', label: 'Google Connections', desc: 'OAuth Scopes & Reconnect', icon: 'M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244' },
]

const ALL_TILES = [...SETUP_TILES, ...TECHNICAL_TILES]

const GROUPS = [
  { key: 'setup', label: 'Set Up', desc: 'Portal Configuration', icon: 'M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.049.58.025 1.193-.14 1.743', tiles: SETUP_TILES },
  { key: 'technical', label: 'Technical', desc: 'Syncs & Integrations', icon: 'M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5', tiles: TECHNICAL_TILES },
]

function TileButton({ tile, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
          <path strokeLinecap="round" strokeLinejoin="round" d={tile.icon} />
        </svg>
      </div>
      <div className="text-center">
        <span className="block text-base font-semibold text-text-primary">{tile.label}</span>
        <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{tile.desc}</span>
      </div>
    </button>
  )
}

export default function AdminPanel({ onBack, isElectron, onLocationChange }) {
  const [activeSection, setActiveSection] = useState(null)
  const [activeGroup, setActiveGroup] = useState(null)

  // Render active section content
  if (activeSection) {
    const tile = ALL_TILES.find(t => t.key === activeSection)
    return (
      <div className="w-full px-8 py-6">
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
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
        {activeSection === 'config' && <AdminConfig isElectron={isElectron} onClose={() => setActiveSection(null)} onLocationChange={onLocationChange} embedded />}
        {activeSection === 'sms' && <SMSHistoryTab />}
        {activeSection === 'webhooks' && <WebhookLogs />}
        {activeSection === 'sync' && <SyncStatusTile />}
        {activeSection === 'tickets' && <TicketEmbedsAdmin />}
        {activeSection === 'drive-folders' && <DriveFoldersAdmin />}
        {activeSection === 'google-connections' && <GoogleConnections />}
        {activeSection === 'paychex' && <PaychexAdmin />}
        {activeSection === 'layouts' && <LayoutExplorer />}
        {activeSection === 'abc-sync' && <ABCSyncAdmin />}
        {activeSection === 'custom-fields' && <CustomFieldsAdmin />}
        {activeSection === 'action-links' && <ActionLinksAdmin />}
      </div>
    )
  }

  // Render group sub-tiles
  if (activeGroup) {
    const group = GROUPS.find(g => g.key === activeGroup)
    return (
      <div className="w-full px-8 py-6">
        <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
          <button
            onClick={() => setActiveGroup(null)}
            className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to Admin
          </button>
          <h2 className="text-xl font-bold text-text-primary">{group?.label}</h2>
        </div>
        <div className="grid grid-cols-4 gap-4 max-w-5xl mx-auto">
          {group.tiles.map(tile => (
            <TileButton key={tile.key} tile={tile} onClick={() => setActiveSection(tile.key)} />
          ))}
        </div>
      </div>
    )
  }

  // Render top-level groups
  return (
    <div className="w-full px-8 py-6">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <h2 className="text-xl font-bold text-text-primary">Admin Panel</h2>
      </div>

      <div className="grid grid-cols-2 gap-6 max-w-3xl mx-auto">
        {GROUPS.map(group => (
          <button
            key={group.key}
            onClick={() => setActiveGroup(group.key)}
            className="group relative flex flex-col items-center justify-center gap-4 rounded-[14px] bg-surface border border-border p-10 min-h-[200px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
          >
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-wcs-red">
                <path strokeLinecap="round" strokeLinejoin="round" d={group.icon} />
              </svg>
            </div>
            <div className="text-center">
              <span className="block text-lg font-semibold text-text-primary">{group.label}</span>
              <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{group.desc}</span>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-1">
              {group.tiles.map(t => (
                <span key={t.key} className="text-[10px] text-text-muted bg-bg rounded-full px-2 py-0.5">{t.label}</span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
