import { useState, useEffect, useRef } from 'react'
import {
  createAdsManagerAdset, updateAdsManagerAdset,
  searchAdsManagerLocations, getAdsManagerAudiences, getAdsManagerSavedAudiences,
} from '../../lib/api'
import {
  OPTIMIZATION_GOALS, BILLING_EVENTS, BID_STRATEGIES, CONVERSION_EVENTS,
  PLATFORMS, GENDERS, budgetToDollars,
} from './constants'
import { Modal, Field, TextInput, Select, Button, ErrorBanner } from './ui'
import { passthroughTargeting, describePassthrough, readGender, readGeoList } from './filters'

// Meta wants a datetime with an offset; <input type="datetime-local"> gives a
// bare local string. Round-tripping through Date fixes it up either way.
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toIso(localValue) {
  if (!localValue) return undefined
  const d = new Date(localValue)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

// A geo entry as Meta returns it, reduced to what targeting actually needs.
function geoKeyOf(item) {
  return `${item.type}:${item.key}`
}

export default function AdsetModal({ adset, campaign, account, onClose, onSaved }) {
  const editing = !!adset
  const goalOptions = OPTIMIZATION_GOALS[campaign.objective] || OPTIMIZATION_GOALS.OUTCOME_TRAFFIC
  const existingTargeting = (adset && adset.targeting) || {}
  const existingGeo = existingTargeting.geo_locations || {}

  const [name, setName] = useState(adset ? adset.name : '')
  const [goal, setGoal] = useState(adset ? adset.optimization_goal : goalOptions[0].value)
  const [billing, setBilling] = useState(adset ? adset.billing_event : 'IMPRESSIONS')
  const [bidStrategy, setBidStrategy] = useState(adset ? (adset.bid_strategy || 'LOWEST_COST_WITHOUT_CAP') : 'LOWEST_COST_WITHOUT_CAP')
  const [bidAmount, setBidAmount] = useState(adset && adset.bid_amount ? budgetToDollars(adset.bid_amount) : '')
  const [conversionEvent, setConversionEvent] = useState(
    (adset && adset.promoted_object && adset.promoted_object.custom_event_type) || 'LEAD'
  )

  // Campaign-level budget means the ad set must not carry one at all.
  const campaignHasBudget = !!(campaign.daily_budget || campaign.lifetime_budget)
  const [budgetType, setBudgetType] = useState(() => {
    if (campaignHasBudget) return 'none'
    if (adset && adset.lifetime_budget) return 'lifetime'
    return 'daily'
  })
  const [budget, setBudget] = useState(
    adset ? budgetToDollars(adset.daily_budget || adset.lifetime_budget) : '25'
  )

  const [startTime, setStartTime] = useState(adset ? toLocalInput(adset.start_time) : '')
  const [endTime, setEndTime] = useState(adset ? toLocalInput(adset.end_time) : '')
  const [status, setStatus] = useState(adset ? adset.status : 'PAUSED')

  // Targeting
  const [geo, setGeo] = useState(() => readGeoList(existingGeo))
  const [geoQuery, setGeoQuery] = useState('')
  const [geoResults, setGeoResults] = useState([])
  const [geoSearching, setGeoSearching] = useState(false)
  const [ageMin, setAgeMin] = useState(existingTargeting.age_min || 21)
  const [ageMax, setAgeMax] = useState(existingTargeting.age_max || 55)
  const [gender, setGender] = useState(() => readGender(existingTargeting))
  // Meta refuses an ad set write unless Advantage audience is explicitly on or
  // off. Off keeps delivery inside the targeting chosen below; on lets Meta
  // ignore it and go wider.
  const [advantageAudience, setAdvantageAudience] = useState(
    () => (existingTargeting.targeting_automation || {}).advantage_audience === 1
  )
  const [platforms, setPlatforms] = useState(
    existingTargeting.publisher_platforms || ['facebook', 'instagram']
  )
  const [audiences, setAudiences] = useState([])
  const [includedAudiences, setIncludedAudiences] = useState(
    (existingTargeting.custom_audiences || []).map(a => a.id)
  )
  const [excludedAudiences, setExcludedAudiences] = useState(
    (existingTargeting.excluded_custom_audiences || []).map(a => a.id)
  )

  // Targeting this form cannot render, carried through to Meta untouched.
  const [extraTargeting, setExtraTargeting] = useState(() => passthroughTargeting(existingTargeting))
  const [savedAudiences, setSavedAudiences] = useState([])
  const [appliedAudience, setAppliedAudience] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const searchTimer = useRef(null)

  useEffect(() => {
    getAdsManagerAudiences()
      .then(res => setAudiences(res.data || []))
      .catch(() => setAudiences([]))
    getAdsManagerSavedAudiences()
      .then(res => setSavedAudiences(res.data || []))
      .catch(() => setSavedAudiences([]))
  }, [])

  // Loading a saved audience replaces the whole targeting block: the parts
  // this form renders become editable form state, and the parts it cannot
  // render (interests, radius pins) ride along in extraTargeting.
  function applySavedAudience(id) {
    setAppliedAudience(id)
    if (!id) return
    const saved = savedAudiences.find(a => a.id === id)
    if (!saved || !saved.targeting) return
    const t = saved.targeting
    setGeo(readGeoList(t.geo_locations))
    setAgeMin(t.age_min || 18)
    setAgeMax(t.age_max || 65)
    setGender(readGender(t))
    if (Array.isArray(t.publisher_platforms) && t.publisher_platforms.length) {
      setPlatforms(t.publisher_platforms)
    }
    setIncludedAudiences((t.custom_audiences || []).map(a => a.id))
    setExcludedAudiences((t.excluded_custom_audiences || []).map(a => a.id))
    setAdvantageAudience((t.targeting_automation || {}).advantage_audience === 1)
    setExtraTargeting(passthroughTargeting(t))
  }

  // Debounced typeahead — Meta rate-limits /search hard on every keystroke.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = geoQuery.trim()
    if (q.length < 2) { setGeoResults([]); return }
    searchTimer.current = setTimeout(() => {
      setGeoSearching(true)
      searchAdsManagerLocations(q)
        .then(res => setGeoResults(res.data || []))
        .catch(() => setGeoResults([]))
        .finally(() => setGeoSearching(false))
    }, 350)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [geoQuery])

  function addGeo(item) {
    setGeo(list => {
      if (list.some(g => geoKeyOf(g) === geoKeyOf(item))) return list
      return [...list, {
        type: item.type,
        key: item.key,
        name: item.name,
        region: item.region,
        country_name: item.country_name,
        radius: item.type === 'city' ? 10 : undefined,
        distance_unit: item.type === 'city' ? 'mile' : undefined,
      }]
    })
    setGeoQuery('')
    setGeoResults([])
  }

  function buildTargeting() {
    const geo_locations = {}
    for (const g of geo) {
      if (g.type === 'city') {
        (geo_locations.cities = geo_locations.cities || []).push({
          key: g.key, radius: Number(g.radius) || 10, distance_unit: g.distance_unit || 'mile',
        })
      } else if (g.type === 'region') {
        (geo_locations.regions = geo_locations.regions || []).push({ key: g.key })
      } else if (g.type === 'zip') {
        (geo_locations.zips = geo_locations.zips || []).push({ key: g.key })
      } else if (g.type === 'country') {
        (geo_locations.countries = geo_locations.countries || []).push(g.key)
      }
    }

    // Passthrough first so the form's own controls always win, then merge the
    // geo blocks so a saved audience's radius pins survive alongside any city
    // added here.
    const { geo_locations: extraGeo, ...extraRest } = extraTargeting
    const targeting = {
      ...extraRest,
      geo_locations: { ...(extraGeo || {}), ...geo_locations },
      age_min: Number(ageMin),
      age_max: Number(ageMax),
      publisher_platforms: platforms,
    }
    // Meta reads an absent `genders` as "all"; sending [1,2] is not equivalent.
    if (gender !== 'all') targeting.genders = [Number(gender)]
    if (includedAudiences.length) targeting.custom_audiences = includedAudiences.map(id => ({ id }))
    if (excludedAudiences.length) targeting.excluded_custom_audiences = excludedAudiences.map(id => ({ id }))
    targeting.targeting_automation = {
      ...(extraRest.targeting_automation || {}),
      advantage_audience: advantageAudience ? 1 : 0,
    }
    return targeting
  }

  function buildPromotedObject() {
    // Only the conversion and lead goals take a promoted_object, and they take
    // different ones. Anything else must omit it entirely.
    if (goal === 'OFFSITE_CONVERSIONS') {
      if (!account.pixel_id) return undefined
      return { pixel_id: account.pixel_id, custom_event_type: conversionEvent }
    }
    if (goal === 'LEAD_GENERATION' || goal === 'QUALITY_CALL') {
      const page = (account.pages || [])[0]
      return page ? { page_id: page.id } : undefined
    }
    return undefined
  }

  async function submit() {
    if (!name.trim()) return setError('Give the ad set a name')
    const hasPinnedLocations = !!(extraTargeting.geo_locations && (extraTargeting.geo_locations.custom_locations || []).length)
    if (!geo.length && !hasPinnedLocations) return setError('Add at least one location to target')
    if (budgetType !== 'none' && !(Number(budget) > 0)) return setError('Set a budget above $0')

    setSaving(true)
    setError('')
    try {
      const body = {
        name: name.trim(),
        status,
        optimization_goal: goal,
        billing_event: billing,
        bid_strategy: bidStrategy,
        bid_amount: bidStrategy === 'LOWEST_COST_WITHOUT_CAP' ? undefined : bidAmount,
        daily_budget: budgetType === 'daily' ? budget : undefined,
        lifetime_budget: budgetType === 'lifetime' ? budget : undefined,
        targeting: buildTargeting(),
        promoted_object: buildPromotedObject(),
        // Instant form leads deliver the form inside Facebook. Saying so on the
        // ad set is what tells the ad builder to ask for a form instead of a
        // destination URL.
        destination_type: goal === 'LEAD_GENERATION' ? 'ON_AD' : undefined,
        start_time: toIso(startTime),
        end_time: toIso(endTime),
      }
      if (editing) await updateAdsManagerAdset(adset.id, body)
      else await createAdsManagerAdset({ ...body, campaign_id: campaign.id })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const needsPixel = goal === 'OFFSITE_CONVERSIONS'
  const passthroughNotes = describePassthrough(extraTargeting)

  return (
    <Modal
      title={editing ? 'Edit ad set' : 'New ad set'}
      subtitle={`Campaign: ${campaign.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create ad set'}</Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <Field label="Ad set name" required>
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Salem — 10mi — 25-45" />
      </Field>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Optimize for" required hint="What Meta tries to get you the most of">
          <Select value={goal} onChange={e => setGoal(e.target.value)} options={goalOptions} />
        </Field>
        <Field label="Charged on">
          <Select value={billing} onChange={e => setBilling(e.target.value)} options={BILLING_EVENTS} />
        </Field>
      </div>

      {needsPixel && (
        <Field
          label="Conversion event"
          hint={account.pixel_id ? `Pixel ${account.pixel_id}` : 'No META_PIXEL_ID configured — conversion optimization will fail.'}
          error={account.pixel_id ? '' : 'A pixel is required for conversion optimization.'}
        >
          <Select value={conversionEvent} onChange={e => setConversionEvent(e.target.value)} options={CONVERSION_EVENTS} />
        </Field>
      )}

      {/* Budget */}
      <section className="rounded-xl border border-border bg-bg/60 p-4 space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Budget &amp; schedule</h4>
        {campaignHasBudget ? (
          <p className="text-xs text-text-muted">
            This campaign holds the budget, so Meta distributes spend across its ad sets automatically.
            To budget per ad set instead, edit the campaign and switch Campaign budget to
            &ldquo;Set per ad set&rdquo;. Meta makes you set every ad set&rsquo;s budget in that one step.
          </p>
        ) : (
          <Field label="Budget" required>
            <div className="flex gap-2">
              <Select
                value={budgetType}
                onChange={e => setBudgetType(e.target.value)}
                options={[{ value: 'daily', label: 'Daily' }, { value: 'lifetime', label: 'Lifetime' }]}
                className="!w-36"
              />
              <TextInput type="number" min="1" step="0.01" value={budget} onChange={e => setBudget(e.target.value)} />
            </div>
          </Field>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Start" hint="Leave empty to start immediately">
            <TextInput type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </Field>
          <Field label="End" hint={budgetType === 'lifetime' ? 'Required for a lifetime budget' : 'Leave empty to run continuously'}>
            <TextInput type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Bid strategy">
            <Select value={bidStrategy} onChange={e => setBidStrategy(e.target.value)} options={BID_STRATEGIES} />
          </Field>
          {bidStrategy !== 'LOWEST_COST_WITHOUT_CAP' && (
            <Field label={bidStrategy === 'COST_CAP' ? 'Cost per result goal' : 'Bid cap'}>
              <TextInput type="number" min="0.01" step="0.01" value={bidAmount} onChange={e => setBidAmount(e.target.value)} placeholder="12.00" />
            </Field>
          )}
        </div>
      </section>

      {/* Targeting */}
      <section className="rounded-xl border border-border bg-bg/60 p-4 space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">Audience</h4>

        {savedAudiences.length > 0 && (
          <Field
            label="Start from a saved audience"
            hint="Fills in everything below. You can still edit it afterwards — this does not link the ad set to the saved audience."
          >
            <Select
              value={appliedAudience}
              onChange={e => applySavedAudience(e.target.value)}
              options={[
                { value: '', label: `Build from scratch (${savedAudiences.length} saved available)` },
                ...savedAudiences.map(a => ({ value: a.id, label: a.name })),
              ]}
            />
          </Field>
        )}

        {passthroughNotes.length > 0 && (
          <p className="text-[11px] text-text-muted rounded-lg border border-border bg-surface px-3 py-2">
            Carrying through {passthroughNotes.join(', ')} that this form does not show. They stay on the
            ad set exactly as saved.
          </p>
        )}

        <Field label="Locations" required hint="Cities get a radius; regions and ZIPs are exact.">
          <div className="relative">
            <TextInput
              value={geoQuery}
              onChange={e => setGeoQuery(e.target.value)}
              placeholder="Search a city, region or ZIP…"
            />
            {(geoResults.length > 0 || geoSearching) && (
              <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg">
                {geoSearching && <p className="px-3 py-2 text-xs text-text-muted">Searching…</p>}
                {geoResults.map(item => (
                  <button
                    key={geoKeyOf(item)}
                    onClick={() => addGeo(item)}
                    className="block w-full text-left px-3 py-2 text-sm text-text-primary hover:bg-bg"
                  >
                    {item.name}
                    <span className="text-text-muted text-xs ml-2">
                      {[item.region, item.country_name, item.type].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        {geo.length > 0 && (
          <ul className="space-y-2">
            {geo.map(g => (
              <li key={geoKeyOf(g)} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-primary truncate">{g.name}</p>
                  <p className="text-[11px] text-text-muted">{[g.region, g.type].filter(Boolean).join(' · ')}</p>
                </div>
                {g.type === 'city' && (
                  <label className="flex items-center gap-1 text-xs text-text-muted">
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={g.radius}
                      onChange={e => setGeo(list => list.map(x => (geoKeyOf(x) === geoKeyOf(g) ? { ...x, radius: e.target.value } : x)))}
                      className="w-16 rounded border border-border bg-bg px-2 py-1 text-text-primary"
                    />
                    mi
                  </label>
                )}
                <button
                  onClick={() => setGeo(list => list.filter(x => geoKeyOf(x) !== geoKeyOf(g)))}
                  className="text-text-muted hover:text-red-600 text-lg leading-none"
                >×</button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Age from">
            <Select
              value={String(ageMin)}
              onChange={e => setAgeMin(e.target.value)}
              options={Array.from({ length: 48 }, (_, i) => ({ value: String(i + 18), label: String(i + 18) }))}
            />
          </Field>
          <Field label="Age to">
            <Select
              value={String(ageMax)}
              onChange={e => setAgeMax(e.target.value)}
              options={[
                ...Array.from({ length: 47 }, (_, i) => ({ value: String(i + 18), label: String(i + 18) })),
                { value: '65', label: '65+' },
              ]}
            />
          </Field>
          <Field label="Gender">
            <Select value={gender} onChange={e => setGender(e.target.value)} options={GENDERS} />
          </Field>
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={advantageAudience}
            onChange={e => setAdvantageAudience(e.target.checked)}
            className="mt-0.5 accent-wcs-red"
          />
          <span className="text-xs text-text-muted">
            <span className="font-semibold text-text-primary block">Advantage audience</span>
            Lets Meta deliver outside the age, gender and interest targeting above when it thinks it will do better. Off holds delivery to exactly what is set here. Meta requires this to be answered either way.
          </span>
        </label>

        <Field label="Placements" hint="Meta usually delivers cheapest with all of them on.">
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => {
              const on = platforms.includes(p.value)
              return (
                <button
                  key={p.value}
                  onClick={() => setPlatforms(list => (on ? list.filter(x => x !== p.value) : [...list, p.value]))}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${on ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'}`}
                >{p.label}</button>
              )
            })}
          </div>
        </Field>

        {audiences.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Include audiences">
              <AudienceList
                audiences={audiences}
                selected={includedAudiences}
                onToggle={id => setIncludedAudiences(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]))}
              />
            </Field>
            <Field label="Exclude audiences">
              <AudienceList
                audiences={audiences}
                selected={excludedAudiences}
                onToggle={id => setExcludedAudiences(l => (l.includes(id) ? l.filter(x => x !== id) : [...l, id]))}
              />
            </Field>
          </div>
        )}
      </section>

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

function AudienceList({ audiences, selected, onToggle }) {
  return (
    <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-bg divide-y divide-border">
      {audiences.map(a => (
        <label key={a.id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface">
          <input
            type="checkbox"
            checked={selected.includes(a.id)}
            onChange={() => onToggle(a.id)}
            className="accent-wcs-red"
          />
          <span className="text-xs text-text-primary truncate">{a.name}</span>
        </label>
      ))}
    </div>
  )
}
