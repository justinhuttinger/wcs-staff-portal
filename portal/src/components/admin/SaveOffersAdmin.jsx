import { useEffect, useState } from 'react'
import { saveAdmin } from '../../lib/api'
import { Card } from './save/shared'
import OffersTab from './save/OffersTab'
import ReasonsTab from './save/ReasonsTab'
import RulesTab from './save/RulesTab'
import SettingsTab from './save/SettingsTab'
import ActivityTab from './save/ActivityTab'

// Admin -> Save Offers. Config + review for WCS Save, the member cancel and
// retention flow (Click2Save replacement). The member side is the wcs-save
// Cloudflare Worker; it reads what is saved here straight from Supabase, so a
// change here is live for members right away. Backend: routes/saveAdmin.js.
const TABS = [
  { key: 'offers', label: 'Offers' },
  { key: 'reasons', label: 'Reasons' },
  { key: 'rules', label: 'Cancel Rules' },
  { key: 'settings', label: 'Settings' },
  { key: 'activity', label: 'Activity' },
]

export default function SaveOffersAdmin() {
  const [tab, setTab] = useState('offers')
  // Reasons are needed by both the Offers tab (targeting) and the Reasons tab,
  // so they are loaded once here and refreshed when the Reasons tab edits them.
  const [reasons, setReasons] = useState([])
  const [reasonsError, setReasonsError] = useState('')

  async function loadReasons() {
    try {
      const r = await saveAdmin.listReasons()
      setReasons(r.reasons || [])
      setReasonsError('')
    } catch (e) {
      setReasonsError(e.message || 'Failed to load reasons')
    }
  }

  useEffect(() => { loadReasons() }, [])

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-sm text-text-muted">
          What members see when they cancel online: the reasons they pick from, the offers that try to keep
          them, what they owe to cancel, and the wording on each screen. Changes are live for members as soon as you save.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                tab === t.key
                  ? 'bg-wcs-red text-white'
                  : 'border border-border text-text-primary hover:bg-bg'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </Card>

      {reasonsError && (tab === 'offers' || tab === 'reasons') && (
        <Card className="border-wcs-red">
          <p className="text-sm text-wcs-red">{reasonsError}</p>
        </Card>
      )}

      {tab === 'offers' && <OffersTab reasons={reasons} />}
      {tab === 'reasons' && <ReasonsTab reasons={reasons} onChange={loadReasons} />}
      {tab === 'rules' && <RulesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'activity' && <ActivityTab />}
    </div>
  )
}
