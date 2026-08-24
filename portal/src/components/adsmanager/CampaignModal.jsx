import { useEffect, useState } from 'react'
import { createAdsManagerCampaign, updateAdsManagerCampaign, getAdsManagerAdsets } from '../../lib/api'
import { OBJECTIVES, SPECIAL_AD_CATEGORIES, BID_STRATEGIES, budgetToDollars } from './constants'
import { Modal, Field, TextInput, Select, Button, ErrorBanner, Spinner } from './ui'

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
  // Meta has no way to simply unset a campaign budget. Handing budget control
  // back to the ad sets means naming a budget for every ad set under the
  // campaign, in the same write. Those live here, keyed by ad set id.
  const hadCampaignBudget = !!(campaign && (campaign.daily_budget || campaign.lifetime_budget))
  const removingCampaignBudget = editing && hadCampaignBudget && budgetType === 'none'
  const [adsets, setAdsets] = useState(null)
  const [adsetBudgets, setAdsetBudgets] = useState({})
  const [adsetsError, setAdsetsError] = useState('')

  const [bidStrategy, setBidStrategy] = useState(campaign ? (campaign.bid_strategy || 'LOWEST_COST_WITHOUT_CAP') : 'LOWEST_COST_WITHOUT_CAP')
  const [status, setStatus] = useState(campaign ? campaign.status : 'PAUSED')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Only fetched when the switch is actually being thrown, and only once —
  // the ads account is rate-limited hard enough that idle calls matter.
  useEffect(() => {
    if (!removingCampaignBudget || adsets) return
    let cancelled = false
    getAdsManagerAdsets({ campaign_id: campaign.id })
      .then(res => {
        if (cancelled) return
        const list = res.data || []
        setAdsets(list)
        // Split the campaign budget evenly as a starting point, so the common
        // case is one click. Any ad set that already had its own budget keeps
        // it instead.
        const total = Number(campaign.daily_budget || campaign.lifetime_budget) || 0
        const each = list.length ? Math.floor(total / list.length) : 0
        const seeded = {}
        for (const a of list) {
          seeded[a.id] = budgetToDollars(a.daily_budget || a.lifetime_budget || each)
        }
        setAdsetBudgets(seeded)
      })
      .catch(err => !cancelled && setAdsetsError(err.message))
    return () => { cancelled = true }
  }, [removingCampaignBudget, adsets, campaign])

  async function submit() {
    if (!name.trim()) return setError('Give the campaign a name')
    if (removingCampaignBudget && !adsets) return setError('Still loading this campaign’s ad sets')
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
      if (removingCampaignBudget) {
        const entries = (adsets || []).map(a => ({
          adset_id: a.id,
          name: a.name,
          budget: adsetBudgets[a.id],
        }))
        if (!entries.length) {
          throw new Error('This campaign has no ad sets yet, so there is nowhere to move the budget to. Create an ad set first.')
        }
        if (entries.some(e => !Number(e.budget))) {
          throw new Error('Give every ad set a budget before moving budget off the campaign')
        }
        body.adset_budgets = entries
        body.adset_budget_type = campaign.lifetime_budget ? 'lifetime' : 'daily'
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

      {removingCampaignBudget && (
        <Field
          label="Move the budget to the ad sets"
          hint="Meta cannot simply drop a campaign budget. Every ad set under this campaign has to be given its own, all in one go."
        >
          {adsetsError && <p className="text-xs text-wcs-red">{adsetsError}</p>}
          {!adsets && !adsetsError && <Spinner label="Loading ad sets…" />}
          {adsets && !adsets.length && (
            <p className="text-xs text-text-muted">
              This campaign has no ad sets yet, so there is nowhere to move the budget. Create an ad set first.
            </p>
          )}
          {adsets && adsets.length > 0 && (
            <div className="space-y-2">
              {adsets.map(a => (
                <div key={a.id} className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-text-primary truncate" title={a.name}>{a.name}</span>
                  <TextInput
                    type="number"
                    min="1"
                    step="0.01"
                    value={adsetBudgets[a.id] || ''}
                    onChange={e => setAdsetBudgets(b => ({ ...b, [a.id]: e.target.value }))}
                    placeholder="25.00"
                    className="!w-32"
                  />
                </div>
              ))}
              <p className="text-[11px] text-text-muted">
                {campaign.lifetime_budget ? 'Lifetime' : 'Daily'} budget per ad set, pre-filled with an even split of the campaign budget.
              </p>
            </div>
          )}
        </Field>
      )}

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
