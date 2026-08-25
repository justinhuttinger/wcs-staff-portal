import { useState } from 'react'
import { duplicateAdsManagerAdset } from '../../lib/api'
import { Modal, Field, TextInput, Select, Button, ErrorBanner } from './ui'

// Copying an ad set is a setup step, so the copy always lands paused — see the
// route for why. The modal says so plainly rather than offering a choice that
// would let a duplicate start spending by itself.
export default function DuplicateAdsetModal({ adset, campaign, campaigns, onClose, onDuplicated }) {
  const [name, setName] = useState(`${adset.name} - Copy`)
  const [campaignId, setCampaignId] = useState(campaign ? campaign.id : '')
  const [includeAds, setIncludeAds] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Meta refuses a copy into a campaign with a different objective, so only
  // offer the ones that can actually take it.
  const targets = (campaigns || []).filter(c => !campaign || c.objective === campaign.objective)

  async function submit() {
    if (!name.trim()) return setError('Give the copy a name')
    setSaving(true)
    setError('')
    try {
      const res = await duplicateAdsManagerAdset(adset.id, {
        name: name.trim(),
        campaign_id: campaignId && campaign && campaignId !== campaign.id ? campaignId : undefined,
        include_ads: includeAds,
      })
      onDuplicated(res)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Duplicate ad set"
      subtitle={adset.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Copying…' : 'Duplicate'}</Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <Field label="Name" required>
        <TextInput value={name} onChange={e => setName(e.target.value)} />
      </Field>

      {targets.length > 1 && (
        <Field label="Campaign" hint="Only campaigns with the same objective can take this ad set">
          <Select
            value={campaignId}
            onChange={e => setCampaignId(e.target.value)}
            options={targets.map(c => ({
              value: c.id,
              label: campaign && c.id === campaign.id ? `${c.name} (same campaign)` : c.name,
            }))}
          />
        </Field>
      )}

      <label className="flex items-start gap-2 mt-4">
        <input
          type="checkbox"
          checked={includeAds}
          onChange={e => setIncludeAds(e.target.checked)}
          className="mt-0.5 accent-wcs-red"
        />
        <span className="text-xs text-text-muted">
          <span className="font-semibold text-text-primary block">Copy the ads inside it too</span>
          Every ad in this ad set is copied with it. Off gives you the targeting, budget and schedule with no ads.
        </span>
      </label>

      <p className="text-[11px] text-text-muted mt-4 rounded-lg bg-bg/60 border border-border px-3 py-2">
        The copy starts paused, ads included. Activate it when you have looked it over.
      </p>
    </Modal>
  )
}
