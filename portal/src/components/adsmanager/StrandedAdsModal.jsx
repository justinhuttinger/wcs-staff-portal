import { useState } from 'react'
import { pauseAdsManagerStrandedAds } from '../../lib/api'
import { Modal, Button, ErrorBanner, StatusPill } from './ui'

// A stranded ad is switched ON inside a paused campaign or ad set. Meta is not
// delivering it today, so it looks harmless — but its own status is ACTIVE, so
// the moment the parent is turned back on it starts spending with no further
// confirmation. This screen finds them and switches them off for real.

export default function StrandedAdsModal({ audit, onClose, onSwept }) {
  const [expanded, setExpanded] = useState(() => new Set())
  const [selected, setSelected] = useState(null) // null = everything
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const allIds = audit.groups.flatMap(g => g.ads.map(a => a.id))
  const chosen = selected === null ? allIds : [...selected]

  function toggleGroup(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Selection starts as "everything" (null) so the common case is one click.
  // The first deselect materialises the full set minus that ad.
  function toggleAd(id) {
    setSelected(prev => {
      const next = new Set(prev === null ? allIds : prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleWholeGroup(group) {
    const ids = group.ads.map(a => a.id)
    const current = new Set(selected === null ? allIds : selected)
    const allOn = ids.every(id => current.has(id))
    for (const id of ids) {
      if (allOn) current.delete(id); else current.add(id)
    }
    setSelected(current)
  }

  async function sweep() {
    if (!chosen.length) return
    setBusy(true)
    setError('')
    try {
      // Send explicit ids only when a subset is chosen; the server re-derives
      // the stranded set either way, so nothing legitimately live gets caught.
      const res = await pauseAdsManagerStrandedAds(selected === null ? null : chosen)
      setResult(res)
      onSwept()
    } catch (err) {
      setError(err.rate_limited && err.retry_after_minutes
        ? `${err.message} Nothing was left half-done — re-run this when the limit clears.`
        : err.message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const failures = (result.results || []).filter(r => !r.ok)
    return (
      <Modal
        title={result.failed ? `Paused ${result.paused}, ${result.failed} failed` : `Paused ${result.paused} ad${result.paused === 1 ? '' : 's'}`}
        onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <p className="text-sm text-text-primary">
          {result.paused > 0
            ? 'Those ads are switched off for real now. Turning their campaign or ad set back on will no longer bring them with it.'
            : 'Nothing was changed.'}
        </p>

        {result.stopped_early && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-900">Stopped early to protect the ad account</p>
            <p className="text-xs text-amber-800 mt-0.5">
              Meta meters every ad it pauses, and the account was approaching its hourly limit, so
              {' '}{result.remaining} ad{result.remaining === 1 ? '' : 's'} were left alone. Run this again
              in an hour to finish — already-paused ads are skipped, so nothing gets done twice.
            </p>
          </div>
        )}
        {failures.length > 0 && (
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {failures.map(f => (
              <li key={f.id} className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2">
                <p className="text-xs font-semibold text-text-primary">{f.name || f.id}</p>
                <p className="text-[11px] text-red-600">{f.error}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    )
  }

  const isChosen = id => (selected === null ? true : selected.has(id))

  return (
    <Modal
      title="Ads switched on inside paused parents"
      subtitle={`${audit.total} ads · ${audit.by_paused_adset} under a paused ad set, ${audit.by_paused_campaign} under a paused campaign`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="mr-auto text-xs text-text-muted">
            {chosen.length} of {audit.total} selected
          </span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={sweep} disabled={busy || !chosen.length}>
            {busy ? 'Pausing…' : `Pause ${chosen.length} ad${chosen.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} onDismiss={() => setError('')} />

      <p className="text-sm text-text-muted">
        These are not delivering right now, because Meta stops the whole tree when a parent is paused.
        But their own status is still <span className="font-semibold text-text-primary">Active</span>, so
        switching the campaign or ad set back on would start every one of them spending at once. Pausing
        them here makes off mean off.
      </p>

      {audit.total > 100 && (
        <p className="text-xs text-amber-800 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Meta counts every ad paused against this account's hourly API budget. A sweep this size may stop
          part-way and ask you to finish it later — that is expected, and nothing is left inconsistent.
        </p>
      )}

      <div className="rounded-xl border border-border divide-y divide-border max-h-[52vh] overflow-y-auto">
        {audit.groups.map(g => {
          const open = expanded.has(g.campaign_id)
          const chosenHere = g.ads.filter(a => isChosen(a.id)).length
          return (
            <div key={g.campaign_id}>
              <div className="flex items-center gap-3 px-4 py-3 bg-bg/40">
                <input
                  type="checkbox"
                  checked={chosenHere === g.ads.length}
                  ref={el => { if (el) el.indeterminate = chosenHere > 0 && chosenHere < g.ads.length }}
                  onChange={() => toggleWholeGroup(g)}
                  className="accent-wcs-red"
                />
                <button onClick={() => toggleGroup(g.campaign_id)} className="flex-1 min-w-0 text-left">
                  <p className="text-sm font-semibold text-text-primary truncate">{g.campaign_name}</p>
                  <p className="text-[11px] text-text-muted">
                    {g.ads.length} ad{g.ads.length === 1 ? '' : 's'} · campaign is {(g.campaign_status || '').toLowerCase() || 'unknown'}
                  </p>
                </button>
                <button onClick={() => toggleGroup(g.campaign_id)} className="text-text-muted text-xs px-2">
                  {open ? 'Hide' : 'Show'}
                </button>
              </div>
              {open && (
                <ul className="divide-y divide-border">
                  {g.ads.map(ad => (
                    <li key={ad.id} className="flex items-center gap-3 px-4 py-2 pl-10">
                      <input
                        type="checkbox"
                        checked={isChosen(ad.id)}
                        onChange={() => toggleAd(ad.id)}
                        className="accent-wcs-red"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-text-primary truncate">{ad.name}</p>
                        <p className="text-[10px] text-text-muted truncate">{ad.adset_name}</p>
                      </div>
                      <StatusPill status={ad.effective_status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
