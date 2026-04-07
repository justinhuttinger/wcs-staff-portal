import { useState } from 'react'
import AdminStaffTab from './AdminStaffTab'
import AdminTilesTab from './AdminTilesTab'
import AdminRolesTab from './AdminRolesTab'
import AdminReferencesTab from './AdminReferencesTab'

const TABS = [
  { key: 'staff', label: 'Staff' },
  { key: 'tiles', label: 'Tiles' },
  { key: 'roles', label: 'Roles' },
  { key: 'references', label: 'References' },
]

export default function AdminPanel({ onBack }) {
  const [activeTab, setActiveTab] = useState('staff')

  return (
    <div className="max-w-4xl mx-auto w-full px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text-primary">Admin Panel</h2>
        <button onClick={onBack}
          className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary transition-colors">
          Back to Portal
        </button>
      </div>
      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key ? 'border-wcs-red text-wcs-red' : 'border-transparent text-text-muted hover:text-text-primary'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>
      {activeTab === 'staff' && <AdminStaffTab />}
      {activeTab === 'tiles' && <AdminTilesTab />}
      {activeTab === 'roles' && <AdminRolesTab />}
      {activeTab === 'references' && <AdminReferencesTab />}
    </div>
  )
}
