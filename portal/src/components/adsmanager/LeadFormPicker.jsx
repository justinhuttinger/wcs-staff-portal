import { useEffect, useState } from 'react'
import { getAdsManagerLeadForms } from '../../lib/api'
import { Field, Select, TextInput } from './ui'

// An Instant Form ad set delivers its form inside Facebook, so its ads carry a
// lead form id instead of a destination URL.
//
// Only destination_type ON_AD counts. The LEAD_GENERATION goal alone does NOT:
// Meta lets an ad set optimise for leads while still pointing at a website, and
// then rejects every creative that carries a form with "Creative with lead form
// can only be used for Lead Generation objective and ON_AD destination". Ad
// sets built before the portal started sending ON_AD sit in exactly that state
// (destination_type "UNDEFINED"), which is why they have to be switched rather
// than guessed about.
export function isInstantFormAdset(adset) {
  return !!adset && adset.destination_type === 'ON_AD'
}

// Optimising for leads but not delivering the form on the ad: a form ad here is
// guaranteed to fail, and one PUT fixes it.
export function needsInstantFormSwitch(adset) {
  if (!adset) return false
  return adset.optimization_goal === 'LEAD_GENERATION' && adset.destination_type !== 'ON_AD'
}

// Loads the Page's active Instant Forms. Re-runs on Page change because the
// forms belong to the Page, not the ad account.
//
// `restricted` means the token is not allowed to LIST forms (pages_manage_ads).
// Creating the ad only needs the id, so that case falls back to typing one in
// rather than blocking the build.
export function useLeadForms(pageId, enabled) {
  const [state, setState] = useState({ forms: [], loading: false, error: '', restricted: false, message: '' })

  useEffect(() => {
    if (!enabled || !pageId) {
      setState({ forms: [], loading: false, error: '', restricted: false, message: '' })
      return
    }
    let live = true
    setState(s => ({ ...s, loading: true, error: '' }))
    getAdsManagerLeadForms(pageId)
      .then(res => {
        if (!live) return
        setState({
          forms: res.data || [],
          loading: false,
          error: '',
          restricted: !!res.restricted,
          message: res.message || '',
        })
      })
      .catch(err => {
        if (live) setState({ forms: [], loading: false, error: err.message, restricted: false, message: '' })
      })
    return () => { live = false }
  }, [pageId, enabled])

  return state
}

export function LeadFormPicker({ pageId, forms, loading, error, restricted, message, value, onChange }) {
  // No list to pick from, so take the id directly. Meta form ids are long
  // numeric strings, which is cheap to sanity-check before Create.
  if (restricted) {
    const looksValid = !value || /^\d{6,}$/.test(value.trim())
    return (
      <Field
        label="Instant form ID"
        required
        hint={looksValid ? message : undefined}
        error={looksValid ? undefined : 'A form ID is all digits — copy it from the Instant Forms list in Meta.'}
      >
        <TextInput
          value={value}
          onChange={e => onChange(e.target.value.trim())}
          placeholder="e.g. 1234567890123456"
          inputMode="numeric"
        />
      </Field>
    )
  }

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
