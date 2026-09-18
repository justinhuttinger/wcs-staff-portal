import { useEffect, useMemo, useState } from 'react'
import { getAdsManagerClubs, previewAdsManagerLaunch, launchAdsManagerToClubs } from '../../lib/api'
import { Modal, Field, Select, TextInput, TextArea, Button, ErrorBanner, Spinner } from './ui'
import { MediaPicker, useVideoProcessing, assetToVariantFields } from './MediaPicker'
import { OPTIMIZATION_GOALS, CALL_TO_ACTIONS } from './constants'

// Launch to clubs — build one ad set and its ads, then create them in every
// selected club at once.
//
// This is NOT "make one and copy it": each club is built directly from the same
// definition, with its own Page, geo, destination and rendered copy (Club
// setup holds those). Everything lands paused.

let keySeq = 0
const blankVariant = () => ({ key: ++keySeq, name: '', message: '', headline: '', description: '', asset: null })

function TokenHint() {
  return (
    <span>
      Use <code className="px-1 rounded bg-bg border border-border">{'{{club}}'}</code> for the club name, plus any token from Club setup
    </span>
  )
}

export default function LaunchToClubsModal({ campaigns = [], onClose, onLaunched }) {
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([])
  const [campaignFor, setCampaignFor] = useState({})

  const [adsetName, setAdsetName] = useState('{{club}} — ')
  const [goal, setGoal] = useState('')
  const [dailyBudget, setDailyBudget] = useState('')
  const [cta, setCta] = useState('LEARN_MORE')
  const [variants, setVariants] = useState([blankVariant()])

  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getAdsManagerClubs()
      .then(res => {
        if (!alive) return
        const list = res.clubs || []
        setClubs(list)
        // Club setup already knows each club's usual campaign; start there.
        setCampaignFor(Object.fromEntries(list.map(c => [c.location_id, c.campaign_id || ''])))
      })
      .catch(err => { if (alive) setError(err.message || 'Could not load clubs') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const campaignById = useMemo(() => new Map(campaigns.map(c => [c.id, c])), [campaigns])

  // An ad set's optimization goal is only legal for its campaign's objective,
  // so one launch cannot straddle two objectives. Meta would reject the odd
  // ones out; saying so up front beats a receipt full of failures.
  const objectives = useMemo(() => {
    const set = new Set()
    for (const id of selected) {
      const campaign = campaignById.get(campaignFor[id])
      if (campaign) set.add(campaign.objective)
    }
    return [...set]
  }, [selected, campaignFor, campaignById])

  const goalOptions = objectives.length === 1 ? (OPTIMIZATION_GOALS[objectives[0]] || []) : []

  const template = useMemo(() => ({
    adset: {
      name: adsetName,
      optimization_goal: goal || undefined,
      daily_budget: dailyBudget ? Number(dailyBudget) : undefined,
    },
    variants: variants.map(v => ({
      name: v.name,
      message: v.message,
      headline: v.headline,
      description: v.description,
      ...assetToVariantFields(v.asset),
    })),
  }), [adsetName, goal, dailyBudget, variants])

  const problems = useMemo(() => {
    const list = []
    if (!selected.length) list.push('Pick at least one club')
    if (selected.some(id => !campaignFor[id])) list.push('Every selected club needs a campaign')
    if (objectives.length > 1) list.push('All selected campaigns must share one objective')
    if (!adsetName.trim()) list.push('The ad set needs a name')
    if (!goal) list.push('Pick what the ad set optimizes for')
    variants.forEach((v, i) => {
      const label = v.name || `Variant ${i + 1}`
      if (!v.name.trim()) list.push(`${label}: needs a name`)
      if (!v.asset) list.push(`${label}: needs an image or video`)
      else if (v.asset.kind === 'video' && !v.asset.ready) list.push(`${label}: video is still processing`)
    })
    return list
  }, [selected, campaignFor, objectives, adsetName, goal, variants])

  // The preview is free (no Meta call), so it is a button rather than
  // something that fires on every keystroke.
  async function refreshPreview() {
    setPreviewing(true)
    setError('')
    try {
      setPreview(await previewAdsManagerLaunch({ location_ids: selected, ...template }))
    } catch (err) {
      setError(err.message)
    } finally {
      setPreviewing(false)
    }
  }

  async function launch(onlyClubs) {
    setLaunching(true)
    setError('')
    try {
      const res = await launchAdsManagerToClubs({
        location_ids: onlyClubs || selected,
        ...template,
        shared: {
          call_to_action: cta ? { type: cta } : undefined,
          campaign_overrides: campaignFor,
        },
      })
      setResults(res)
      if (res.created_clubs.length) onLaunched && onLaunched()
    } catch (err) {
      setError(err.message)
    } finally {
      setLaunching(false)
    }
  }

  function patchVariant(key, patch) {
    setVariants(list => list.map(v => v.key === key ? { ...v, ...patch } : v))
  }

  // Meta transcodes video after upload. Without this poll a freshly uploaded
  // clip stays "processing" and the launch button stays disabled forever.
  useVideoProcessing(
    variants.map(v => v.asset),
    ready => setVariants(list => list.map(v =>
      v.asset && v.asset.video_id === ready.video_id ? { ...v, asset: ready } : v
    )),
  )

  // After a launch the modal becomes a receipt: which clubs got built, which
  // failed and why, and a retry that touches only the failures.
  if (results) {
    const failed = results.failed_clubs.concat(results.skipped_clubs)
    return (
      <Modal
        title="Launch results"
        subtitle={`${results.created_clubs.length} club${results.created_clubs.length === 1 ? '' : 's'} built, everything paused`}
        onClose={onClose}
        footer={
          <>
            {!!failed.length && (
              <Button onClick={() => { setResults(null); launch(failed) }} disabled={launching}>
                Retry {failed.length} failed
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </>
        }
      >
        {results.stopped_early && (
          <ErrorBanner error={`Stopped early to protect the ad account's rate limit. ${results.skipped_clubs.length} club(s) were not attempted — retry in an hour.`} />
        )}
        <div className="space-y-2">
          {results.results.map(r => (
            <div key={r.location_id} className="border border-border rounded-lg px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text-primary">{r.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${r.ok ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {r.ok ? 'Created' : 'Failed'}
                </span>
              </div>
              {r.error && <p className="text-xs text-red-600 mt-1">{r.error}</p>}
              {!!(r.ads || []).length && (
                <ul className="mt-2 space-y-1">
                  {r.ads.map((ad, i) => (
                    <li key={i} className="text-xs text-text-muted">
                      {ad.ok ? '✓' : '✗'} {ad.name}{ad.error ? ` — ${ad.error}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Launch to clubs"
      subtitle="One ad set and its ads, created in every selected club. Everything lands paused."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={refreshPreview} disabled={previewing || !selected.length}>
            {previewing ? 'Checking…' : 'Preview'}
          </Button>
          <Button onClick={() => launch()} disabled={launching || !!problems.length || !(preview && preview.ready)}>
            {launching ? 'Launching…' : `Launch to ${selected.length || 0} club${selected.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {error && <ErrorBanner error={error} onDismiss={() => setError('')} />}

      {loading ? <Spinner /> : (
        <>
          <div>
            <span className="block text-xs font-semibold text-text-primary mb-1.5">Clubs</span>
            <div className="space-y-2">
              {clubs.map(club => {
                const on = selected.includes(club.location_id)
                const ready = !!(club.page_id && Object.keys(club.targeting || {}).length && (club.link || club.lead_form_id))
                return (
                  <div key={club.location_id} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!ready}
                      onChange={e => setSelected(list => e.target.checked
                        ? [...list, club.location_id]
                        : list.filter(id => id !== club.location_id))}
                      className="accent-wcs-red"
                    />
                    <span className="text-sm text-text-primary w-28">{club.name}</span>
                    {ready ? (
                      <Select
                        value={campaignFor[club.location_id] || ''}
                        onChange={e => setCampaignFor(m => ({ ...m, [club.location_id]: e.target.value }))}
                        options={[{ value: '', label: 'Pick a campaign…' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
                        className="flex-1"
                      />
                    ) : (
                      <span className="text-xs text-amber-700">Needs setup in Club setup first</span>
                    )}
                  </div>
                )
              })}
            </div>
            {objectives.length > 1 && (
              <p className="text-[11px] text-red-600 mt-2">
                The chosen campaigns have different objectives ({objectives.join(', ')}). One launch can only cover one.
              </p>
            )}
          </div>

          <Field label="Ad set name" required hint={<TokenHint />}>
            <TextInput value={adsetName} onChange={e => setAdsetName(e.target.value)} placeholder="{{club}} — Spring promo" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Optimize for" required hint={objectives.length === 1 ? '' : 'Pick campaigns first'}>
              <Select
                value={goal}
                onChange={e => setGoal(e.target.value)}
                options={[{ value: '', label: 'Select…' }, ...goalOptions]}
              />
            </Field>
            <Field label="Daily budget" hint="Per club, in dollars">
              <TextInput value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} placeholder="25" inputMode="decimal" />
            </Field>
          </div>

          <Field label="Button">
            <Select value={cta} onChange={e => setCta(e.target.value)} options={CALL_TO_ACTIONS} />
          </Field>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-text-primary">Ads</span>
              <Button variant="ghost" onClick={() => setVariants(list => [...list, blankVariant()])}>Add ad</Button>
            </div>
            <div className="space-y-3">
              {variants.map((v, i) => (
                <div key={v.key} className="border border-border rounded-lg p-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <TextInput
                      value={v.name}
                      onChange={e => patchVariant(v.key, { name: e.target.value })}
                      placeholder={`{{club}} ad ${i + 1}`}
                    />
                    {variants.length > 1 && (
                      <button onClick={() => setVariants(list => list.filter(x => x.key !== v.key))} className="text-text-muted hover:text-wcs-red px-1" aria-label="Remove ad">×</button>
                    )}
                  </div>
                  <Field label="Primary text" hint={<TokenHint />}>
                    <TextArea rows={3} value={v.message} onChange={e => patchVariant(v.key, { message: e.target.value })} placeholder="Train at WCS {{club}} — {{offer}}" />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Headline">
                      <TextInput value={v.headline} onChange={e => patchVariant(v.key, { headline: e.target.value })} />
                    </Field>
                    <Field label="Description">
                      <TextInput value={v.description} onChange={e => patchVariant(v.key, { description: e.target.value })} />
                    </Field>
                  </div>
                  <MediaPicker asset={v.asset} onChange={asset => patchVariant(v.key, { asset })} />
                </div>
              ))}
            </div>
          </div>

          {!!problems.length && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <p className="text-xs font-semibold text-amber-900 mb-1">Before launching</p>
              <ul className="text-xs text-amber-900 space-y-0.5">
                {problems.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            </div>
          )}

          {preview && (
            <div>
              <span className="block text-xs font-semibold text-text-primary mb-1.5">
                Preview {preview.ready ? '' : '— fix the blocked clubs below'}
              </span>
              <div className="space-y-2">
                {preview.clubs.map(c => (
                  <div key={c.location_id} className={`border rounded-lg px-3 py-2 ${c.ready ? 'border-border' : 'border-red-500/40 bg-red-500/5'}`}>
                    <p className="text-xs font-semibold text-text-primary">{c.name}</p>
                    <p className="text-xs text-text-muted mt-0.5">{c.rendered.adset.name}</p>
                    {(c.rendered.variants || []).map((v, i) => (
                      <p key={i} className="text-xs text-text-secondary mt-1">{v.name}: {v.message}</p>
                    ))}
                    {!!c.missing_tokens.length && (
                      <p className="text-xs text-red-600 mt-1">No value for: {c.missing_tokens.map(t => `{{${t}}}`).join(', ')}</p>
                    )}
                    {c.blockers.map((b, i) => <p key={i} className="text-xs text-red-600 mt-1">{b}</p>)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

    </Modal>
  )
}
