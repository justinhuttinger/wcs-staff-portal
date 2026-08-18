import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getAdsManagerAccount, getAdsManagerCampaigns, getAdsManagerAdsets, getAdsManagerAds,
  updateAdsManagerCampaign, updateAdsManagerAdset, updateAdsManagerAd,
  deleteAdsManagerCampaign, deleteAdsManagerAdset, deleteAdsManagerAd,
  duplicateAdsManagerAd, getAdsManagerStrandedAds,
} from '../lib/api'
import { formatBudget, prettyStatus } from './adsmanager/constants'
import {
  CAMPAIGN_LOCATIONS, CAMPAIGN_TYPES, STATUS_FILTERS, NO_LOCATION,
  classifyCampaign, matchesLocationFilter, matchesStatusFilter,
} from './adsmanager/filters'
import { Button, StatusPill, ErrorBanner, EmptyState, Spinner, Modal } from './adsmanager/ui'
import { MediaThumb } from './adsmanager/MediaPicker'
import CampaignModal from './adsmanager/CampaignModal'
import AdsetModal from './adsmanager/AdsetModal'
import AdVariantsModal from './adsmanager/AdVariantsModal'
import AdEditModal from './adsmanager/AdEditModal'
import StrandedAdsModal from './adsmanager/StrandedAdsModal'

// Admin-only Meta ad builder. Three linked columns mirroring Meta's own
// hierarchy — campaign → ad set → ad — because that is the structure the API
// enforces and the one Ads Manager teaches. Reporting deliberately lives
// elsewhere (Reporting → Meta Ads); this screen only creates and edits.

function Column({ title, count, onAdd, addLabel, disabled, children }) {
  return (
    <div className="flex flex-col min-h-0 rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h3 className="text-xs font-bold uppercase tracking-wider text-text-muted">
          {title}{count !== undefined && <span className="ml-2 text-text-primary">{count}</span>}
        </h3>
        {onAdd && (
          <button
            onClick={onAdd}
            disabled={disabled}
            className="text-xs font-semibold text-wcs-red hover:underline disabled:text-text-muted disabled:no-underline disabled:cursor-not-allowed"
          >{addLabel}</button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
    </div>
  )
}

function RowMenu({ items }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    // Defer so the click that opened the menu does not immediately close it.
    const id = setTimeout(() => window.addEventListener('click', close), 0)
    return () => { clearTimeout(id); window.removeEventListener('click', close) }
  }, [open])

  return (
    <div className="relative">
      <button
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        className="px-1.5 text-text-muted hover:text-text-primary text-lg leading-none"
        aria-label="Actions"
      >⋯</button>
      {open && (
        <div className="absolute right-0 top-6 z-20 w-40 rounded-lg border border-border bg-surface shadow-xl py-1">
          {items.map(item => (
            <button
              key={item.label}
              onClick={e => { e.stopPropagation(); setOpen(false); item.onClick() }}
              className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-bg ${item.danger ? 'text-red-600' : 'text-text-primary'}`}
            >{item.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ selected, onClick, children }) {
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-border cursor-pointer transition-colors ${selected ? 'bg-wcs-red/5 border-l-2 border-l-wcs-red' : 'hover:bg-bg/60 border-l-2 border-l-transparent'}`}
    >{children}</div>
  )
}

export default function AdsManagerView({ onBack }) {
  const [account, setAccount] = useState(null)
  const [loadingAccount, setLoadingAccount] = useState(true)
  const [error, setError] = useState('')
  // Location and type are parsed out of the campaign name, so they only apply
  // to the campaigns column. Status applies at every level.
  const [locationFilter, setLocationFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')

  const [campaigns, setCampaigns] = useState([])
  const [adsets, setAdsets] = useState([])
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState({ campaigns: true, adsets: false, ads: false })

  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [selectedAdset, setSelectedAdset] = useState(null)
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)
  // Ads switched on inside a paused parent — see StrandedAdsModal.
  const [stranded, setStranded] = useState(null)
  const [showStranded, setShowStranded] = useState(false)
  // The audit is expensive, so it is not re-run after every pause. Pausing
  // something just marks it stale and the banner offers a recheck.
  const [strandedStale, setStrandedStale] = useState(false)
  // Short-lived note after a cascading pause, so the knock-on effect is visible.
  const [notice, setNotice] = useState('')
  // Set when Meta throttles the ad account, so the UI can say "wait N minutes"
  // instead of showing a generic failure.
  const [rateLimit, setRateLimit] = useState(null)

  // Always pull the full (non-deleted) set and filter in the browser — the
  // three-way Active/Inactive/All split does not map onto a single Meta
  // effective_status query, and these lists are small enough to filter here.
  const statusParam = 'all'

  useEffect(() => {
    getAdsManagerAccount()
      .then(setAccount)
      .catch(err => setError(err.message))
      .finally(() => setLoadingAccount(false))
  }, [])

  const loadCampaigns = useCallback(() => {
    setLoading(l => ({ ...l, campaigns: true }))
    return getAdsManagerCampaigns({ status: statusParam })
      .then(res => setCampaigns(res.data || []))
      .catch(reportError)
      .finally(() => setLoading(l => ({ ...l, campaigns: false })))
  }, [statusParam, reportError])

  const loadAdsets = useCallback(campaignId => {
    if (!campaignId) { setAdsets([]); return Promise.resolve() }
    setLoading(l => ({ ...l, adsets: true }))
    return getAdsManagerAdsets({ campaign_id: campaignId, status: statusParam })
      .then(res => setAdsets(res.data || []))
      .catch(reportError)
      .finally(() => setLoading(l => ({ ...l, adsets: false })))
  }, [statusParam, reportError])

  const loadAds = useCallback(adsetId => {
    if (!adsetId) { setAds([]); return Promise.resolve() }
    setLoading(l => ({ ...l, ads: true }))
    return getAdsManagerAds({ adset_id: adsetId, status: statusParam })
      .then(res => setAds(res.data || []))
      .catch(reportError)
      .finally(() => setLoading(l => ({ ...l, ads: false })))
  }, [statusParam, reportError])

  // Every catch funnels through here so a throttle is reported as a wait, not
  // as a broken screen.
  const reportError = useCallback(err => {
    if (err && err.rate_limited) setRateLimit({ minutes: err.retry_after_minutes || 0, message: err.message })
    else setError(err.message)
  }, [])

  const loadStranded = useCallback(force => {
    return getAdsManagerStrandedAds(force)
      .then(res => { setStranded(res); setStrandedStale(false) })
      // A failed audit must not take the whole screen down; the banner just
      // stays hidden.
      .catch(() => setStranded(null))
  }, [])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])
  useEffect(() => { loadStranded() }, [loadStranded])
  useEffect(() => { loadAdsets(selectedCampaign && selectedCampaign.id) }, [selectedCampaign, loadAdsets])
  useEffect(() => { loadAds(selectedAdset && selectedAdset.id) }, [selectedAdset, loadAds])

  // Location and type come from the campaign name; status is evaluated per
  // level so a paused ad inside an active campaign still reads as inactive.
  const visibleCampaigns = useMemo(() => campaigns.filter(c => {
    if (!matchesLocationFilter(c, locationFilter)) return false
    if (typeFilter !== 'all' && classifyCampaign(c) !== typeFilter) return false
    return matchesStatusFilter(c, statusFilter)
  }), [campaigns, locationFilter, typeFilter, statusFilter])

  const visibleAdsets = useMemo(
    () => adsets.filter(a => matchesStatusFilter(a, statusFilter)),
    [adsets, statusFilter]
  )

  const visibleAds = useMemo(
    () => ads.filter(a => matchesStatusFilter(a, statusFilter)),
    [ads, statusFilter]
  )

  // A campaign hidden by a filter change should not keep driving the other two
  // columns — clear the selection so the screen never shows orphaned children.
  useEffect(() => {
    if (selectedCampaign && !visibleCampaigns.some(c => c.id === selectedCampaign.id)) {
      setSelectedCampaign(null)
      setSelectedAdset(null)
      setAds([])
    }
  }, [visibleCampaigns, selectedCampaign])

  function pickCampaign(c) {
    setSelectedCampaign(c)
    setSelectedAdset(null)
    setAds([])
  }

  // Status toggles write straight through — pausing an ad is the one action
  // that needs to be one click and not a modal.
  async function toggleStatus(level, entity) {
    const next = entity.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setNotice('')
    try {
      let res
      if (level === 'campaign') {
        res = await updateAdsManagerCampaign(entity.id, { status: next })
        loadCampaigns()
        if (selectedCampaign && selectedCampaign.id === entity.id) loadAdsets(entity.id)
      } else if (level === 'adset') {
        res = await updateAdsManagerAdset(entity.id, { status: next })
        loadAdsets(selectedCampaign.id)
      } else {
        res = await updateAdsManagerAd(entity.id, { status: next })
      }
      // Children may have changed underneath the selection, so refresh the ads
      // column whenever one is open.
      if (selectedAdset) loadAds(selectedAdset.id)

      const c = res && res.cascade
      if (c && (c.adsets_paused || c.ads_paused)) {
        const bits = []
        if (c.adsets_paused) bits.push(`${c.adsets_paused} ad set${c.adsets_paused === 1 ? '' : 's'}`)
        if (c.ads_paused) bits.push(`${c.ads_paused} ad${c.ads_paused === 1 ? '' : 's'}`)
        setNotice(`Paused “${entity.name}” and everything under it — ${bits.join(' and ')}.`)
      }
      if (c && c.failures && c.failures.length) {
        setError(`${c.failures.length} child object(s) could not be paused: ${c.failures[0].error}`)
      }
      // Deliberately NOT re-running the audit here: it is the most expensive
      // query on the screen, and firing it after every pause is what pushed
      // Meta's total_time budget past 100 and throttled the whole ad account.
      if (next === 'PAUSED') setStrandedStale(true)
    } catch (err) {
      reportError(err)
    }
  }

  async function doDelete(level, entity) {
    try {
      if (level === 'campaign') {
        await deleteAdsManagerCampaign(entity.id)
        if (selectedCampaign && selectedCampaign.id === entity.id) pickCampaign(null)
        loadCampaigns()
      } else if (level === 'adset') {
        await deleteAdsManagerAdset(entity.id)
        if (selectedAdset && selectedAdset.id === entity.id) setSelectedAdset(null)
        loadAdsets(selectedCampaign.id)
      } else {
        await deleteAdsManagerAd(entity.id)
        loadAds(selectedAdset.id)
      }
      setConfirm(null)
    } catch (err) {
      setError(err.message)
      setConfirm(null)
    }
  }

  // One-click "make me three more of this" — the same creative, new names,
  // ready to have copy or media swapped in the edit modal.
  async function quickDuplicate(ad, times) {
    try {
      const variants = Array.from({ length: times }, (_, i) => ({ name: `${ad.name} v${i + 2}` }))
      await duplicateAdsManagerAd(ad.id, { adset_id: selectedAdset.id, variants })
      loadAds(selectedAdset.id)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loadingAccount) {
    return <div className="w-full max-w-7xl mx-auto px-8 py-6"><Spinner label="Connecting to Meta…" /></div>
  }

  if (!account) {
    return (
      <div className="w-full max-w-3xl mx-auto px-8 py-6 space-y-4">
        <ErrorBanner error={error || 'Could not reach the Meta ad account.'} />
        <Button variant="secondary" onClick={onBack}>Back</Button>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto px-6 py-6 flex flex-col h-[calc(100vh-2rem)]">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-4 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-text-muted hover:text-text-primary text-sm">← Back</button>
            <h2 className="text-xl font-bold text-text-primary">Ads Manager</h2>
            <span className="px-2 py-0.5 rounded-full bg-wcs-red/10 text-wcs-red text-[10px] font-bold uppercase tracking-wider border border-wcs-red/20">
              Admin only
            </span>
          </div>
          <p className="text-xs text-text-muted">
            {account.name} · {account.currency}
            {account.status !== 1 && <span className="text-amber-600 font-semibold ml-2">Account not active</span>}
          </p>
        </div>

        <div className="flex items-end gap-4 flex-wrap mt-4 pt-4 border-t border-border">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Location</span>
            <select
              value={locationFilter}
              onChange={e => setLocationFilter(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
            >
              <option value="all">All locations</option>
              {CAMPAIGN_LOCATIONS.map(l => <option key={l.slug} value={l.slug}>{l.label}</option>)}
              <option value={NO_LOCATION}>No location in name</option>
            </select>
          </label>

          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Campaign type</span>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="rounded-lg border border-border bg-bg px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
            >
              <option value="all">All types</option>
              {CAMPAIGN_TYPES.map(t => <option key={t.slug} value={t.slug}>{t.label}</option>)}
            </select>
          </label>

          <div>
            <span className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Status</span>
            <div className="flex gap-1 bg-bg rounded-lg p-1">
              {STATUS_FILTERS.map(f => (
                <button
                  key={f.slug}
                  onClick={() => setStatusFilter(f.slug)}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${statusFilter === f.slug ? 'bg-surface text-text-primary shadow-sm' : 'text-text-muted hover:text-text-primary'}`}
                >{f.label}</button>
              ))}
            </div>
          </div>

          {(locationFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'active') && (
            <button
              onClick={() => { setLocationFilter('all'); setTypeFilter('all'); setStatusFilter('active') }}
              className="text-xs text-text-muted hover:text-text-primary pb-1.5"
            >Reset</button>
          )}

          <p className="ml-auto text-xs text-text-muted pb-1.5">
            {visibleCampaigns.length} of {campaigns.length} campaigns
          </p>
        </div>
      </div>

      {rateLimit && (
        <div className="mb-4 shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">Meta is rate-limiting this ad account</p>
              <p className="text-xs text-amber-800 mt-0.5">
                {rateLimit.minutes
                  ? `Meta expects access back in about ${rateLimit.minutes} minute${rateLimit.minutes === 1 ? '' : 's'}. Nothing is broken — the limit is per ad account and resets on a rolling hour.`
                  : 'The limit is per ad account and resets on a rolling hour. Give it a few minutes.'}
              </p>
            </div>
            <button onClick={() => setRateLimit(null)} className="text-amber-800/60 hover:text-amber-800 text-lg leading-none">×</button>
          </div>
        </div>
      )}

      {error && <div className="mb-4 shrink-0"><ErrorBanner error={error} onDismiss={() => setError('')} /></div>}

      {notice && (
        <div className="mb-4 shrink-0 flex items-start justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          <p className="text-sm text-emerald-700">{notice}</p>
          <button onClick={() => setNotice('')} className="text-emerald-700/60 hover:text-emerald-700 text-lg leading-none">×</button>
        </div>
      )}

      {stranded && stranded.total > 0 && (
        <div className="mb-4 shrink-0 flex items-center justify-between gap-4 flex-wrap rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-amber-900">
              {stranded.total} ad{stranded.total === 1 ? ' is' : 's are'} still switched on inside a paused campaign or ad set
            </p>
            <p className="text-xs text-amber-800 mt-0.5">
              Not delivering now, but turning the parent back on would start every one of them spending at once.
              {strandedStale && <span className="font-semibold"> Count may be out of date since your last pause.</span>}
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {strandedStale && (
              <button onClick={() => loadStranded(true)} className="text-xs text-amber-900 underline hover:no-underline">
                Recheck
              </button>
            )}
            <Button onClick={() => setShowStranded(true)}>Review &amp; pause</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.3fr] gap-4 flex-1 min-h-0">
        {/* Campaigns */}
        <Column
          title="Campaigns"
          count={visibleCampaigns.length}
          addLabel="+ New"
          onAdd={() => setModal({ type: 'campaign' })}
        >
          {loading.campaigns ? <Spinner /> : visibleCampaigns.length === 0 ? (
            campaigns.length > 0 ? (
              <EmptyState
                title="Nothing matches these filters"
                hint={`${campaigns.length} campaigns are hidden. Try widening the location, type or status filter.`}
                action={<Button variant="secondary" onClick={() => { setLocationFilter('all'); setTypeFilter('all'); setStatusFilter('all') }}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                title="No campaigns"
                hint="A campaign holds the objective and overall budget."
                action={<Button onClick={() => setModal({ type: 'campaign' })}>Create one</Button>}
              />
            )
          ) : visibleCampaigns.map(c => (
            <Row key={c.id} selected={selectedCampaign && selectedCampaign.id === c.id} onClick={() => pickCampaign(c)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{c.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <StatusPill status={c.effective_status || c.status} />
                    <span className="text-[11px] text-text-muted">{prettyStatus(c.objective.replace('OUTCOME_', ''))}</span>
                    {(c.daily_budget || c.lifetime_budget) && (
                      <span className="text-[11px] text-text-muted">{formatBudget(c.daily_budget, c.lifetime_budget)}</span>
                    )}
                  </div>
                </div>
                <RowMenu items={[
                  { label: c.status === 'ACTIVE' ? 'Pause' : 'Activate', onClick: () => toggleStatus('campaign', c) },
                  { label: 'Edit', onClick: () => setModal({ type: 'campaign', campaign: c }) },
                  { label: 'Delete', danger: true, onClick: () => setConfirm({ level: 'campaign', entity: c }) },
                ]} />
              </div>
            </Row>
          ))}
        </Column>

        {/* Ad sets */}
        <Column
          title="Ad sets"
          count={selectedCampaign ? visibleAdsets.length : undefined}
          addLabel="+ New"
          disabled={!selectedCampaign}
          onAdd={() => selectedCampaign && setModal({ type: 'adset' })}
        >
          {!selectedCampaign ? (
            <EmptyState title="Pick a campaign" hint="Ad sets hold the audience, budget and schedule." />
          ) : loading.adsets ? <Spinner /> : adsets.length === 0 ? (
            <EmptyState
              title={adsets.length > 0 ? 'None match the status filter' : 'No ad sets'}
              hint={adsets.length > 0 ? `${adsets.length} hidden by the Status filter.` : 'Add one to define who sees the ads.'}
              action={<Button onClick={() => setModal({ type: 'adset' })}>Create one</Button>}
            />
          ) : visibleAdsets.map(a => (
            <Row key={a.id} selected={selectedAdset && selectedAdset.id === a.id} onClick={() => setSelectedAdset(a)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary truncate">{a.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <StatusPill status={a.effective_status || a.status} />
                    <span className="text-[11px] text-text-muted">{formatBudget(a.daily_budget, a.lifetime_budget)}</span>
                  </div>
                </div>
                <RowMenu items={[
                  { label: a.status === 'ACTIVE' ? 'Pause' : 'Activate', onClick: () => toggleStatus('adset', a) },
                  { label: 'Edit', onClick: () => setModal({ type: 'adset', adset: a }) },
                  { label: 'Delete', danger: true, onClick: () => setConfirm({ level: 'adset', entity: a }) },
                ]} />
              </div>
            </Row>
          ))}
        </Column>

        {/* Ads */}
        <Column
          title="Ads"
          count={selectedAdset ? visibleAds.length : undefined}
          addLabel="+ New ads"
          disabled={!selectedAdset}
          onAdd={() => selectedAdset && setModal({ type: 'ads' })}
        >
          {!selectedAdset ? (
            <EmptyState title="Pick an ad set" hint="Then build as many creative variants in it as you want." />
          ) : loading.ads ? <Spinner /> : ads.length === 0 ? (
            <EmptyState
              title={ads.length > 0 ? 'None match the status filter' : 'No ads yet'}
              hint={ads.length > 0 ? `${ads.length} hidden by the Status filter.` : 'Drop in a batch of images and get one ad each, sharing the same copy.'}
              action={<Button onClick={() => setModal({ type: 'ads' })}>Create ads</Button>}
            />
          ) : visibleAds.map(ad => {
            const spec = (ad.creative && ad.creative.object_story_spec) || {}
            const linkData = spec.link_data || spec.video_data || {}
            const thumb = ad.creative && (ad.creative.thumbnail_url || ad.creative.image_url)
            return (
              <Row key={ad.id} onClick={() => setModal({ type: 'editAd', ad })}>
                <div className="flex items-start gap-3">
                  <MediaThumb
                    asset={thumb ? { kind: spec.video_data ? 'video' : 'image', url: thumb, thumbnail_url: thumb, ready: true } : null}
                    className="w-12 h-12 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary truncate">{ad.name}</p>
                    {linkData.message && (
                      <p className="text-[11px] text-text-muted line-clamp-2 mt-0.5">{linkData.message}</p>
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <StatusPill status={ad.effective_status || ad.status} />
                      {(linkData.name || linkData.title) && (
                        <span className="text-[11px] text-text-muted truncate">{linkData.name || linkData.title}</span>
                      )}
                    </div>
                  </div>
                  <RowMenu items={[
                    { label: ad.status === 'ACTIVE' ? 'Pause' : 'Activate', onClick: () => toggleStatus('ad', ad) },
                    { label: 'Edit', onClick: () => setModal({ type: 'editAd', ad }) },
                    { label: 'Duplicate ×1', onClick: () => quickDuplicate(ad, 1) },
                    { label: 'Duplicate ×3', onClick: () => quickDuplicate(ad, 3) },
                    { label: 'Delete', danger: true, onClick: () => setConfirm({ level: 'ad', entity: ad }) },
                  ]} />
                </div>
              </Row>
            )
          })}
        </Column>
      </div>

      {modal && modal.type === 'campaign' && (
        <CampaignModal
          campaign={modal.campaign}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadCampaigns() }}
        />
      )}

      {modal && modal.type === 'adset' && selectedCampaign && (
        <AdsetModal
          adset={modal.adset}
          campaign={selectedCampaign}
          account={account}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadAdsets(selectedCampaign.id) }}
        />
      )}

      {modal && modal.type === 'ads' && selectedAdset && (
        <AdVariantsModal
          adset={selectedAdset}
          campaign={selectedCampaign}
          account={account}
          onClose={() => setModal(null)}
          onCreated={() => loadAds(selectedAdset.id)}
        />
      )}

      {modal && modal.type === 'editAd' && (
        <AdEditModal
          ad={modal.ad}
          account={account}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadAds(selectedAdset.id) }}
        />
      )}

      {showStranded && stranded && (
        <StrandedAdsModal
          audit={stranded}
          onClose={() => setShowStranded(false)}
          onSwept={() => {
            loadStranded(true)
            loadCampaigns()
            if (selectedCampaign) loadAdsets(selectedCampaign.id)
            if (selectedAdset) loadAds(selectedAdset.id)
          }}
        />
      )}

      {confirm && (
        <Modal
          title={`Delete this ${confirm.level}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => doDelete(confirm.level, confirm.entity)}>Delete</Button>
            </>
          }
        >
          <p className="text-sm text-text-primary">
            <span className="font-semibold">{confirm.entity.name}</span> will be removed from this screen.
          </p>
          <p className="text-xs text-text-muted">
            Meta keeps deleted objects recoverable in Ads Manager, and anything nested underneath goes with it.
          </p>
        </Modal>
      )}
    </div>
  )
}
