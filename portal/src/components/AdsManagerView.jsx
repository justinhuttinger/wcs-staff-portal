import { useState, useEffect, useCallback } from 'react'
import {
  getAdsManagerAccount, getAdsManagerCampaigns, getAdsManagerAdsets, getAdsManagerAds,
  updateAdsManagerCampaign, updateAdsManagerAdset, updateAdsManagerAd,
  deleteAdsManagerCampaign, deleteAdsManagerAdset, deleteAdsManagerAd,
  duplicateAdsManagerAd,
} from '../lib/api'
import { formatBudget, prettyStatus } from './adsmanager/constants'
import { Button, StatusPill, ErrorBanner, EmptyState, Spinner, Modal } from './adsmanager/ui'
import { MediaThumb } from './adsmanager/MediaPicker'
import CampaignModal from './adsmanager/CampaignModal'
import AdsetModal from './adsmanager/AdsetModal'
import AdVariantsModal from './adsmanager/AdVariantsModal'
import AdEditModal from './adsmanager/AdEditModal'

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
  const [showAll, setShowAll] = useState(false)

  const [campaigns, setCampaigns] = useState([])
  const [adsets, setAdsets] = useState([])
  const [ads, setAds] = useState([])
  const [loading, setLoading] = useState({ campaigns: true, adsets: false, ads: false })

  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [selectedAdset, setSelectedAdset] = useState(null)
  const [modal, setModal] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const statusParam = showAll ? 'all' : undefined

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
      .catch(err => setError(err.message))
      .finally(() => setLoading(l => ({ ...l, campaigns: false })))
  }, [statusParam])

  const loadAdsets = useCallback(campaignId => {
    if (!campaignId) { setAdsets([]); return Promise.resolve() }
    setLoading(l => ({ ...l, adsets: true }))
    return getAdsManagerAdsets({ campaign_id: campaignId, status: statusParam })
      .then(res => setAdsets(res.data || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(l => ({ ...l, adsets: false })))
  }, [statusParam])

  const loadAds = useCallback(adsetId => {
    if (!adsetId) { setAds([]); return Promise.resolve() }
    setLoading(l => ({ ...l, ads: true }))
    return getAdsManagerAds({ adset_id: adsetId, status: statusParam })
      .then(res => setAds(res.data || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(l => ({ ...l, ads: false })))
  }, [statusParam])

  useEffect(() => { loadCampaigns() }, [loadCampaigns])
  useEffect(() => { loadAdsets(selectedCampaign && selectedCampaign.id) }, [selectedCampaign, loadAdsets])
  useEffect(() => { loadAds(selectedAdset && selectedAdset.id) }, [selectedAdset, loadAds])

  function pickCampaign(c) {
    setSelectedCampaign(c)
    setSelectedAdset(null)
    setAds([])
  }

  // Status toggles write straight through — pausing an ad is the one action
  // that needs to be one click and not a modal.
  async function toggleStatus(level, entity) {
    const next = entity.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    try {
      if (level === 'campaign') { await updateAdsManagerCampaign(entity.id, { status: next }); loadCampaigns() }
      else if (level === 'adset') { await updateAdsManagerAdset(entity.id, { status: next }); loadAdsets(selectedCampaign.id) }
      else { await updateAdsManagerAd(entity.id, { status: next }); loadAds(selectedAdset.id) }
    } catch (err) {
      setError(err.message)
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
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer">
              <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="accent-wcs-red" />
              Show archived &amp; completed
            </label>
            <p className="text-xs text-text-muted">
              {account.name} · {account.currency}
              {account.status !== 1 && <span className="text-amber-600 font-semibold ml-2">Account not active</span>}
            </p>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 shrink-0"><ErrorBanner error={error} onDismiss={() => setError('')} /></div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_1.3fr] gap-4 flex-1 min-h-0">
        {/* Campaigns */}
        <Column
          title="Campaigns"
          count={campaigns.length}
          addLabel="+ New"
          onAdd={() => setModal({ type: 'campaign' })}
        >
          {loading.campaigns ? <Spinner /> : campaigns.length === 0 ? (
            <EmptyState
              title="No campaigns"
              hint="A campaign holds the objective and overall budget."
              action={<Button onClick={() => setModal({ type: 'campaign' })}>Create one</Button>}
            />
          ) : campaigns.map(c => (
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
          count={selectedCampaign ? adsets.length : undefined}
          addLabel="+ New"
          disabled={!selectedCampaign}
          onAdd={() => selectedCampaign && setModal({ type: 'adset' })}
        >
          {!selectedCampaign ? (
            <EmptyState title="Pick a campaign" hint="Ad sets hold the audience, budget and schedule." />
          ) : loading.adsets ? <Spinner /> : adsets.length === 0 ? (
            <EmptyState
              title="No ad sets"
              hint="Add one to define who sees the ads."
              action={<Button onClick={() => setModal({ type: 'adset' })}>Create one</Button>}
            />
          ) : adsets.map(a => (
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
          count={selectedAdset ? ads.length : undefined}
          addLabel="+ New ads"
          disabled={!selectedAdset}
          onAdd={() => selectedAdset && setModal({ type: 'ads' })}
        >
          {!selectedAdset ? (
            <EmptyState title="Pick an ad set" hint="Then build as many creative variants in it as you want." />
          ) : loading.ads ? <Spinner /> : ads.length === 0 ? (
            <EmptyState
              title="No ads yet"
              hint="Drop in a batch of images and get one ad each, sharing the same copy."
              action={<Button onClick={() => setModal({ type: 'ads' })}>Create ads</Button>}
            />
          ) : ads.map(ad => {
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
