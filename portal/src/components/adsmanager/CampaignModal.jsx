import { useState } from 'react'
import { createAdsManagerCampaign, updateAdsManagerCampaign } from '../../lib/api'
import { OBJECTIVES, SPECIAL_AD_CATEGORIES, BID_STRATEGIES, budgetToDollars } from './constants'
import { Modal, Field, TextInput, Select, Button, ErrorBanner } from './ui'

export default function CampaignModal({ campaign, onClose, onSaved }) {
  const editing = !!campaign
  const [name, setName] = useState(campaign ? campaign.name : '')
  const [objective, setObjective] = useState(campaign ? campaign.objective : 'OUTCOME_LEADS')
  const [category, setCategory] = useState(
    campaign && campaign.special_ad_categories && campaign.special_ad_categories.length
      ? campaign.special_ad_categories[0]
      : 'NONE'
  )
  // Campaign-level budget is optional (Advantage campaign budget). When it is
  // set, the ad sets underneath must not carry their own.
  const [budgetType, setBudgetType] = useState(() => {
    if (campaign && campaign.daily_budget) return 'daily'
    if (campaign && campaign.lifetime_budget) return 'lifetime'
    return 'none'
  })
  const [budget, setBudget] = useState(
    campaign ? budgetToDollars(campaign.daily_budget || campaign.lifetime_budget) : ''
  )
  const [bidStrategy, setBidStrategy] = useState(campaign ? (campaign.bid_strategy || 'LOWEST_COST_WITHOUT_CAP') : 'LOWEST_COST_WITHOUT_CAP')
  const [status, setStatus] = useState(campaign ? campaign.status : 'PAUSED')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!name.trim()) return setError('Give the campaign a name')
    setSaving(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        status,
        daily_budget: budgetType === 'daily' ? budget : undefined,
        lifetime_budget: budgetType === 'lifetime' ? budget : undefined,
        bid_strategy: budgetType === 'none' ? undefined : bidStrategy,
      }
      if (editing) {
        await updateAdsManagerCampaign(campaign.id, body)
      } else {
        // Objective and special ad category are locked at creation by Meta.
        await createAdsManagerCampaign({
          ...body,
          objective,
          special_ad_categories: category === 'NONE' ? [] : [category],
        })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={editing ? 'Edit campaign' : 'New campaign'}
      subtitle={editing ? campaign.name : 'The top level — objective and overall budget'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}</Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <Field label="Campaign name" required>
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 7 Day Free Trial — Salem" />
      </Field>

      <Field
        label="Objective"
        required
        hint={editing ? 'Objective cannot be changed after a campaign is created.' : OBJECTIVES.find(o => o.value === objective)?.hint}
      >
        <Select
          value={objective}
          disabled={editing}
          onChange={e => setObjective(e.target.value)}
          options={OBJECTIVES.map(o => ({ value: o.value, label: o.label }))}
        />
      </Field>

      {!editing && (
        <Field
          label="Special ad category"
          hint="Gym promotions are almost always None. Picking wrong gets the campaign rejected."
        >
          <Select value={category} onChange={e => setCategory(e.target.value)} options={SPECIAL_AD_CATEGORIES} />
        </Field>
      )}

      <Field
        label="Campaign budget"
        hint="Leave off to set budgets per ad set instead. Meta splits a campaign budget across ad sets automatically."
      >
        <div className="flex gap-2">
          <Select
            value={budgetType}
            onChange={e => setBudgetType(e.target.value)}
            options={[
              { value: 'none', label: 'Set per ad set' },
              { value: 'daily', label: 'Daily' },
              { value: 'lifetime', label: 'Lifetime' },
            ]}
            className="!w-40"
          />
          {budgetType !== 'none' && (
            <TextInput
              type="number"
              min="1"
              step="0.01"
              value={budget}
              onChange={e => setBudget(e.target.value)}
              placeholder="50.00"
            />
          )}
        </div>
      </Field>

      {budgetType !== 'none' && (
        <Field label="Bid strategy">
          <Select value={bidStrategy} onChange={e => setBidStrategy(e.target.value)} options={BID_STRATEGIES} />
        </Field>
      )}

      <Field label="Status">
        <Select
          value={status}
          onChange={e => setStatus(e.target.value)}
          options={[{ value: 'PAUSED', label: 'Paused' }, { value: 'ACTIVE', label: 'Active' }]}
        />
      </Field>
    </Modal>
  )
}
