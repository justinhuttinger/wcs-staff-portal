import { useEffect, useRef, useState } from 'react'
import {
  getAdsManagerClubs, saveAdsManagerClub, searchAdsManagerLocations, getAdsManagerLeadForms,
} from '../../lib/api'
import { Modal, Field, Select, TextInput, Button, ErrorBanner, Spinner } from './ui'

// Club Setup — the per-club half of a multi-club launch.
//
// A launch writes the same ad set and ads into every selected club, so each
// club needs the things that cannot be shared: its Facebook Page, its geo
// targeting, where its ad points, and the words that differ ({{club}} and any
// other token). Those change rarely, so they live here instead of being
// retyped on every launch.
//
// Nothing here touches Meta except the geo typeahead and the lead-form list,
// both of which the ad set builder already uses.

function geoLabel(g) {
  const where = [g.name, g.region, g.country_name].filter(Boolean).join(', ')
  return g.radius ? `${where} + ${g.radius}mi` : where
}

// Targeting is stored exactly as Meta wants it, so a launch can send it
// unchanged. This reads that shape back into an editable list.
function readGeo(targeting) {
  const geo = (targeting || {}).geo_locations || {}
  return [
    ...(geo.cities || []).map(c => ({ type: 'city', key: c.key, name: c.name || c.key, region: c.region, radius: c.radius, distance_unit: c.distance_unit || 'mile' })),
    ...(geo.regions || []).map(r => ({ type: 'region', key: r.key, name: r.name || r.key })),
    ...(geo.zips || []).map(z => ({ type: 'zip', key: z.key, name: z.name || z.key })),
  ]
}

function writeGeo(list) {
  const geo_locations = {}
  for (const g of list) {
    if (g.type === 'city') {
      (geo_locations.cities = geo_locations.cities || []).push({
        key: g.key, name: g.name, region: g.region,
        radius: g.radius || 10, distance_unit: g.distance_unit || 'mile',
      })
    } else if (g.type === 'region') (geo_locations.regions = geo_locations.regions || []).push({ key: g.key, name: g.name })
    else if (g.type === 'zip') (geo_locations.zips = geo_locations.zips || []).push({ key: g.key, name: g.name })
  }
  return Object.keys(geo_locations).length ? { geo_locations } : {}
}

function tokensToRows(tokens) {
  return Object.entries(tokens || {}).map(([name, value]) => ({ name, value }))
}

function rowsToTokens(rows) {
  const out = {}
  for (const row of rows) {
    const name = (row.name || '').trim()
    if (name) out[name] = row.value ?? ''
  }
  return out
}

function ClubRow({ club, pages, campaigns, onSaved }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(club)
  const [geo, setGeo] = useState(() => readGeo(club.targeting))
  const [tokenRows, setTokenRows] = useState(() => tokensToRows(club.tokens))
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [leadForms, setLeadForms] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef(null)

  // Same debounce the ad set builder uses: Meta rate-limits /search hard, and
  // this screen is seven rows that could each be typing.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    timer.current = setTimeout(() => {
      searchAdsManagerLocations(q).then(res => setResults(res.data || [])).catch(() => setResults([]))
    }, 350)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [query])

  useEffect(() => {
    if (!draft.page_id) { setLeadForms([]); return }
    let alive = true
    getAdsManagerLeadForms(draft.page_id)
      .then(res => { if (alive) setLeadForms(res.data || []) })
      .catch(() => { if (alive) setLeadForms([]) })
    return () => { alive = false }
  }, [draft.page_id])

  const page = pages.find(p => p.id === draft.page_id) || null
  const configured = !!(draft.page_id && geo.length && (draft.link || draft.lead_form_id))

  async function save() {
    setSaving(true)
    setError('')
    try {
      // The Page carries its Instagram account, so a launch never has to
      // re-derive it and can never pair a Page with the wrong IG handle.
      const body = {
        campaign_id: draft.campaign_id || '',
        page_id: draft.page_id || '',
        instagram_id: page && page.instagram_id ? page.instagram_id : '',
        link: draft.link || '',
        lead_form_id: draft.lead_form_id || '',
        targeting: writeGeo(geo),
        tokens: rowsToTokens(tokenRows),
      }
      await saveAdsManagerClub(club.location_id, body)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved && onSaved({ ...club, ...body })
    } catch (err) {
      setError(err.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-border rounded-xl bg-surface">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">{club.name}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${configured ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
            {configured ? 'Ready' : 'Needs setup'}
          </span>
        </span>
        <span className="text-xs text-text-muted">
          {page ? page.name : 'No Page'} {open ? '▲' : '▼'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-border pt-4">
          {error && <ErrorBanner error={error} />}

          <Field label="Facebook Page" hint={page && page.instagram_id ? `Instagram: @${page.instagram_username}` : 'No Instagram account linked to this Page'}>
            <Select
              value={draft.page_id || ''}
              onChange={e => setDraft(d => ({ ...d, page_id: e.target.value, lead_form_id: '' }))}
              options={[{ value: '', label: 'Select a Page…' }, ...pages.map(p => ({ value: p.id, label: p.name }))]}
            />
          </Field>

          <Field label="Default campaign" hint="Pre-selected for this club on a launch; you can still change it per launch">
            <Select
              value={draft.campaign_id || ''}
              onChange={e => setDraft(d => ({ ...d, campaign_id: e.target.value }))}
              options={[{ value: '', label: 'No default' }, ...campaigns.map(c => ({ value: c.id, label: c.name }))]}
            />
          </Field>

          <Field label="Destination link" hint="Leave blank if this club's ads deliver an Instant Form instead">
            <TextInput
              value={draft.link || ''}
              onChange={e => setDraft(d => ({ ...d, link: e.target.value }))}
              placeholder="https://westcoaststrength.com/…"
            />
          </Field>

          {!!leadForms.length && (
            <Field label="Instant Form" hint="Used when the ad set delivers the form on the ad">
              <Select
                value={draft.lead_form_id || ''}
                onChange={e => setDraft(d => ({ ...d, lead_form_id: e.target.value }))}
                options={[{ value: '', label: 'No form' }, ...leadForms.map(f => ({ value: f.id, label: f.name }))]}
              />
            </Field>
          )}

          <div>
            <span className="block text-xs font-semibold text-text-primary mb-1.5">Geo targeting</span>
            <div className="flex flex-wrap gap-2 mb-2">
              {geo.map(g => (
                <span key={g.type + g.key} className="inline-flex items-center gap-1 bg-bg border border-border rounded-full px-2.5 py-1 text-xs">
                  {geoLabel(g)}
                  <button onClick={() => setGeo(list => list.filter(x => x.key !== g.key))} className="text-text-muted hover:text-wcs-red" aria-label={`Remove ${g.name}`}>×</button>
                </span>
              ))}
              {!geo.length && <span className="text-xs text-text-muted">Nothing targeted yet</span>}
            </div>
            <TextInput value={query} onChange={e => setQuery(e.target.value)} placeholder="Search a city, region or ZIP…" />
            {!!results.length && (
              <div className="mt-1 border border-border rounded-lg divide-y divide-border max-h-40 overflow-auto">
                {results.map(r => (
                  <button
                    key={r.type + r.key}
                    onClick={() => {
                      setGeo(list => list.some(g => g.key === r.key) ? list : [...list, {
                        type: r.type, key: r.key, name: r.name, region: r.region,
                        country_name: r.country_name,
                        radius: r.type === 'city' ? 10 : undefined,
                        distance_unit: r.type === 'city' ? 'mile' : undefined,
                      }])
                      setQuery('')
                      setResults([])
                    }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-bg"
                  >
                    {[r.name, r.region, r.country_name].filter(Boolean).join(', ')}
                    <span className="text-text-muted"> · {r.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <span className="block text-xs font-semibold text-text-primary mb-1.5">Tokens</span>
            <p className="text-[11px] text-text-muted mb-2">
              Used in ad copy as {'{{name}}'}. {'{{club}}'} is always available and defaults to {club.name}.
            </p>
            <div className="space-y-2">
              {tokenRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <TextInput
                    value={row.name}
                    onChange={e => setTokenRows(rows => rows.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))}
                    placeholder="offer"
                    className="w-1/3"
                  />
                  <TextInput
                    value={row.value}
                    onChange={e => setTokenRows(rows => rows.map((r, idx) => idx === i ? { ...r, value: e.target.value } : r))}
                    placeholder="first week free"
                  />
                  <button onClick={() => setTokenRows(rows => rows.filter((_, idx) => idx !== i))} className="text-text-muted hover:text-wcs-red px-1" aria-label="Remove token">×</button>
                </div>
              ))}
            </div>
            <Button variant="ghost" onClick={() => setTokenRows(rows => [...rows, { name: '', value: '' }])} className="mt-2">
              Add token
            </Button>
          </div>

          <div className="flex items-center justify-end gap-2">
            {saved && <span className="text-xs text-green-700">Saved</span>}
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save ' + club.name}</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClubSetupModal({ pages = [], campaigns = [], onClose }) {
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    getAdsManagerClubs()
      .then(res => { if (alive) setClubs(res.clubs || []) })
      .catch(err => { if (alive) setError(err.message || 'Could not load clubs') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <Modal
      title="Club setup"
      subtitle="Page, targeting, destination and token values for each club"
      onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Done</Button>}
    >
      {error && <ErrorBanner error={error} />}
      {loading
        ? <Spinner />
        : (
          <div className="space-y-2">
            {clubs.map(club => (
              <ClubRow
                key={club.location_id}
                club={club}
                pages={pages}
                campaigns={campaigns}
                onSaved={updated => setClubs(list => list.map(c => c.location_id === updated.location_id ? { ...c, ...updated } : c))}
              />
            ))}
            {!clubs.length && <p className="text-sm text-text-muted">No clubs found.</p>}
          </div>
        )}
    </Modal>
  )
}
