import { useState, useEffect } from 'react'
import { getReferralRewards, resolveReferralReward } from '../../lib/api'

function StatusPill({ value, tone }) {
  const tones = {
    green: 'bg-green-100 text-green-700',
    orange: 'bg-orange-100 text-orange-700',
    red: 'bg-red-100 text-red-700',
    gray: 'bg-gray-100 text-gray-600',
  }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${tones[tone] || tones.gray}`}>{value}</span>
}

function duesTone(s) { return s === 'zeroed' ? 'green' : s === 'no_dues_invoice' ? 'orange' : 'red' }
function smsTone(s) { return s === 'tagged' ? 'green' : s === 'skipped' ? 'gray' : 'orange' }

export default function ReferralRewardsAdmin() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [resolving, setResolving] = useState(null)

  async function load() {
    try {
      const res = await getReferralRewards()
      setRows(res.rewards || [])
    } catch {
      // leave existing rows; surface nothing destructive
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleResolve(id) {
    setResolving(id)
    try {
      await resolveReferralReward(id)
      await load()
    } finally {
      setResolving(null)
    }
  }

  if (loading) return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5">
      <p className="text-sm text-text-muted">Loading referral rewards…</p>
    </div>
  )

  const needsReview = rows.filter(r => r.needs_review)
  const recent = rows

  return (
    <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 space-y-6">
      {/* Needs review */}
      <div>
        <p className="text-xs text-orange-600 uppercase font-semibold mb-2">
          Needs Review {needsReview.length > 0 && `(${needsReview.length})`}
        </p>
        {needsReview.length === 0 ? (
          <p className="text-sm text-text-muted">Nothing needs manual handling.</p>
        ) : (
          <div className="space-y-2">
            {needsReview.map(r => (
              <div key={r.id} className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary font-medium">{r.new_member_name || r.new_member_id}</p>
                  <p className="text-xs text-text-muted">
                    Referrer ABC #{r.referrer_abc_id} · {r.club_number} ·{' '}
                    {r.dues_status === 'no_dues_invoice' ? 'no upcoming DUES invoice' :
                     r.sms_status === 'no_referrer_contact' ? 'dues zeroed, no GHL contact for SMS' :
                     r.sms_status === 'error' ? 'dues zeroed, SMS tag failed' : (r.error || 'review')}
                  </p>
                </div>
                <button
                  onClick={() => handleResolve(r.id)}
                  disabled={resolving === r.id}
                  className="text-xs px-3 py-1.5 rounded-lg bg-wcs-red text-white hover:opacity-90 disabled:opacity-50"
                >
                  {resolving === r.id ? 'Saving…' : 'Mark resolved'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent rewards */}
      <div>
        <p className="text-xs text-text-muted uppercase font-semibold mb-2">Recent ({recent.length})</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="py-1 pr-4 font-medium">New member</th>
                <th className="py-1 pr-4 font-medium">Referrer ABC #</th>
                <th className="py-1 pr-4 font-medium">Club</th>
                <th className="py-1 pr-4 font-medium">Dues</th>
                <th className="py-1 pr-4 font-medium">SMS</th>
                <th className="py-1 pr-4 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map(r => (
                <tr key={r.id} className="border-t border-border">
                  <td className="py-1.5 pr-4 text-text-primary">{r.new_member_name || r.new_member_id}</td>
                  <td className="py-1.5 pr-4 text-text-muted">{r.referrer_abc_id}</td>
                  <td className="py-1.5 pr-4 text-text-muted">{r.club_number}</td>
                  <td className="py-1.5 pr-4"><StatusPill value={r.dues_status} tone={duesTone(r.dues_status)} /></td>
                  <td className="py-1.5 pr-4"><StatusPill value={r.sms_status} tone={smsTone(r.sms_status)} /></td>
                  <td className="py-1.5 pr-4 text-text-muted">{new Date(r.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
