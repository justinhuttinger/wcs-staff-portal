import { useEffect, useState } from 'react'
import { saveAdmin } from '../../../lib/api'
import { Card, CLUB_NAME, CLUBS, Toggle, TypeBadge, Badge, btnPrimary, btnSecondary, describeConfig } from './shared'
import OfferForm from './OfferForm'

function reasonSummary(offer, reasons) {
  const ids = offer.reason_ids || []
  if (!ids.length) return 'All reasons'
  if (ids.length === 1) {
    const r = reasons.find(x => x.id === ids[0])
    return r ? r.label : '1 reason'
  }
  return `${ids.length} reasons`
}

function clubSummary(offer) {
  const nums = offer.club_numbers || []
  if (!nums.length || nums.length === CLUBS.length) return 'All clubs'
  return nums.map(n => CLUB_NAME[n] || n).join(', ')
}

function scheduleNote(offer) {
  const today = new Date().toISOString().slice(0, 10)
  if (offer.ends_on && offer.ends_on < today) return { text: 'Ended', tone: 'gray' }
  if (offer.starts_on && offer.starts_on > today) return { text: `Starts ${offer.starts_on}`, tone: 'blue' }
  if (offer.ends_on) return { text: `Ends ${offer.ends_on}`, tone: 'gray' }
  return null
}

export default function OffersTab({ reasons }) {
  const [offers, setOffers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | 'new' | offer object
  const [busy, setBusy] = useState(null)

  async function load() {
    setError('')
    try {
      const r = await saveAdmin.listOffers()
      setOffers(r.offers || [])
    } catch (e) {
      setError(e.message || 'Failed to load offers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function toggleActive(offer, active) {
    setBusy(offer.id)
    setError('')
    try {
      const r = await saveAdmin.updateOffer(offer.id, { active })
      setOffers(prev => prev.map(o => (o.id === offer.id ? r.offer : o)))
    } catch (e) {
      setError(e.message || 'Failed to update offer')
    } finally {
      setBusy(null)
    }
  }

  async function remove(offer) {
    if (!window.confirm(`Delete "${offer.headline}"? Past activity keeps its copy of the offer.`)) return
    setBusy(offer.id)
    setError('')
    try {
      await saveAdmin.deleteOffer(offer.id)
      setOffers(prev => prev.filter(o => o.id !== offer.id))
    } catch (e) {
      setError(e.message || 'Failed to delete offer')
    } finally {
      setBusy(null)
    }
  }

  if (editing) {
    return (
      <OfferForm
        offer={editing === 'new' ? null : editing}
        reasons={reasons}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load() }}
      />
    )
  }

  const activeCount = offers.filter(o => o.active).length

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-text-primary">Save offers</h3>
            <p className="text-xs text-text-muted mt-1">
              Members see active offers that match their reason and club, lowest priority number first.
              {offers.length > 0 && ` ${activeCount} of ${offers.length} active.`}
            </p>
          </div>
          <button onClick={() => setEditing('new')} className={btnPrimary}>New offer</button>
        </div>
        {error && <p className="text-sm text-wcs-red mt-3">{error}</p>}
      </Card>

      <Card>
        {loading ? (
          <p className="text-sm text-text-muted">Loading offers…</p>
        ) : offers.length === 0 ? (
          <p className="text-sm text-text-muted">
            No offers yet. Members who start a cancel go straight to the review screen until you add one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-text-muted border-b border-border">
                  <th className="py-2 pr-3 font-semibold">Active</th>
                  <th className="py-2 pr-3 font-semibold">Offer</th>
                  <th className="py-2 pr-3 font-semibold">Type</th>
                  <th className="py-2 pr-3 font-semibold">Reasons</th>
                  <th className="py-2 pr-3 font-semibold">Clubs</th>
                  <th className="py-2 pr-3 font-semibold text-right">Priority</th>
                  <th className="py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {offers.map(o => {
                  const sched = scheduleNote(o)
                  return (
                    <tr key={o.id} className="border-b border-border last:border-0 align-top">
                      <td className="py-3 pr-3">
                        <Toggle
                          checked={o.active}
                          disabled={busy === o.id}
                          onChange={v => toggleActive(o, v)}
                          label={`Active: ${o.headline}`}
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <button onClick={() => setEditing(o)} className="text-left">
                          <span className="font-medium text-text-primary hover:text-wcs-red">{o.headline}</span>
                          <span className="block text-xs text-text-muted">{describeConfig(o.offer_type, o.config)}</span>
                        </button>
                        {sched && <span className="inline-block mt-1"><Badge tone={sched.tone}>{sched.text}</Badge></span>}
                      </td>
                      <td className="py-3 pr-3"><TypeBadge type={o.offer_type} /></td>
                      <td className="py-3 pr-3 text-text-muted">{reasonSummary(o, reasons)}</td>
                      <td className="py-3 pr-3 text-text-muted">{clubSummary(o)}</td>
                      <td className="py-3 pr-3 text-right tabular-nums text-text-primary">{o.priority}</td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <button onClick={() => setEditing(o)} className={btnSecondary}>Edit</button>
                        <button
                          onClick={() => remove(o)}
                          disabled={busy === o.id}
                          className="ml-2 px-3 py-2 rounded-lg text-sm text-wcs-red hover:bg-bg disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
