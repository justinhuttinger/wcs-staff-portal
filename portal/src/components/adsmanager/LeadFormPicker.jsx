import { useEffect, useState } from 'react'
import { getAdsManagerLeadForms } from '../../lib/api'
import { Field, Select } from './ui'

// An Instant Form ad set delivers its form inside Facebook, so its ads carry a
// lead form id instead of a destination URL. Meta records that two ways
// depending on how the ad set was built — the explicit ON_AD destination, or
// just the lead-generation optimisation goal — and either one means "no
// website". Getting this wrong is what makes the ad builder ask for a URL it
// will never use.
export function isInstantFormAdset(adset) {
  if (!adset) return false
  return adset.destination_type === 'ON_AD' || adset.optimization_goal === 'LEAD_GENERATION'
}

// Loads the Page's active Instant Forms. Re-runs on Page change because the
// forms belong to the Page, not the ad account.
export function useLeadForms(pageId, enabled) {
  const [forms, setForms] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!enabled || !pageId) {
      setForms([])
      return
    }
    let live = true
    setLoading(true)
    setError('')
    getAdsManagerLeadForms(pageId)
      .then(res => { if (live) setForms(res.data || []) })
      .catch(err => { if (live) setError(err.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [pageId, enabled])

  return { forms, loading, error }
}

export function LeadFormPicker({ pageId, forms, loading, error, value, onChange }) {
  let hint = 'The form that opens when someone taps the ad'
  if (!pageId) hint = 'Pick a Facebook Page first'
  else if (loading) hint = 'Loading forms…'
  else if (error) hint = error
  else if (!forms.length) hint = 'This Page has no active Instant Forms. Build one in Meta first, then reopen this.'

  return (
    <Field label="Instant form" required hint={hint} error={error || undefined}>
      <Select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={!pageId || loading || !forms.length}
        options={[
          { value: '', label: forms.length ? 'Select a form…' : 'No forms available' },
          ...forms.map(f => ({ value: f.id, label: f.name })),
        ]}
      />
    </Field>
  )
}
