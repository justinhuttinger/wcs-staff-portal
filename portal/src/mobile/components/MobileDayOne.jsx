import React, { useState, useEffect, useCallback } from 'react'
import { getDayOneTrackerAppointments, submitDayOneResult, getDayOneFieldOptions } from '../../lib/api'

const LOCATIONS = [
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}
function isPast(iso) { return iso ? new Date(iso) < new Date() : false }
function isPending(apt) {
  const s = (apt.day_one_status || '').toLowerCase()
  return (!s || s === 'scheduled') && isPast(apt.appointment_time)
}
function isCompleted(apt) {
  const s = (apt.day_one_status || '').toLowerCase()
  return s === 'completed' || s === 'no show' || apt.show_or_no_show === 'No Show'
}
function formatDateTime(iso) {
  if (!iso) return '\u2014'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ apt }) {
  const status = (apt.day_one_status || '').toLowerCase()
  const showNoShow = apt.show_or_no_show

  let label, colorClass
  if (status === 'no show' || showNoShow === 'No Show') {
    label = 'No Show'
    colorClass = 'bg-red-50 text-red-600 border-red-200'
  } else if (status === 'completed' && apt.sale_type) {
    label = 'Sale'
    colorClass = 'bg-green-50 text-green-700 border-green-200'
  } else if (status === 'completed' && apt.no_sale_reason) {
    label = 'No Sale'
    colorClass = 'bg-gray-50 text-gray-500 border-gray-200'
  } else if (status === 'completed') {
    label = 'Completed'
    colorClass = 'bg-green-50 text-green-700 border-green-200'
  } else {
    label = 'Pending'
    colorClass = 'bg-yellow-50 text-yellow-700 border-yellow-200'
  }

  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${colorClass}`}>
      {label}
    </span>
  )
}

function OutcomeModal({ apt, locationSlug, onClose, onSubmitted }) {
  const [step, setStep] = useState(1)
  const [showOrNoShow, setShowOrNoShow] = useState(apt.show_or_no_show || '')
  const [saleOrNoSale, setSaleOrNoSale] = useState('')
  const [saleType, setSaleType] = useState('')
  const [noSaleReason, setNoSaleReason] = useState('')
  const [saleTypeOptions, setSaleTypeOptions] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadOptions() {
      try {
        const res = await getDayOneFieldOptions({ location_slug: locationSlug })
        setSaleTypeOptions(res.pt_sale_types || [])
      } catch {
        setSaleTypeOptions([])
      }
    }
    loadOptions()
  }, [locationSlug])

  // Pre-populate if already completed
  useEffect(() => {
    if (apt.show_or_no_show) setShowOrNoShow(apt.show_or_no_show)
    if (apt.day_one_sale === 'Sale') { setSaleOrNoSale('Sale') }
    if (apt.day_one_sale === 'No Sale') { setSaleOrNoSale('No Sale') }
  }, [apt])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      const result = await submitDayOneResult({
        contact_id: apt.contact_id,
        location_slug: locationSlug,
        show_no_show: showOrNoShow,
        sale_result: showOrNoShow === 'Show' ? saleOrNoSale : null,
        pt_sale_type: saleOrNoSale === 'Sale' ? saleType : null,
        why_no_sale: saleOrNoSale === 'No Sale' ? noSaleReason : null,
      })
      onSubmitted(result.confirmed || {
        day_one_status: showOrNoShow === 'Show' ? 'Completed' : 'No Show',
        show_or_no_show: showOrNoShow,
        day_one_sale: showOrNoShow === 'Show' ? saleOrNoSale : null,
      })
    } catch (err) {
      setError(err.message || 'Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleShowNoShow(val) {
    setShowOrNoShow(val)
    if (val === 'No Show') {
      setStep(4) // skip to review
    } else {
      setStep(2)
    }
  }

  const contactName = capitalize(apt.contact_name || apt.name || 'Unknown')

  return (
    <div className="fixed inset-0 bg-surface z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-text-primary truncate">{contactName}</h2>
          <p className="text-xs text-text-muted">{formatDateTime(apt.appointment_time)}</p>
        </div>
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-lg active:bg-bg"
          aria-label="Close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-text-primary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        {/* Existing status banner */}
        {isCompleted(apt) && (
          <div className="mb-4 p-3 rounded-xl bg-blue-50 border border-blue-200">
            <p className="text-xs text-blue-700 font-medium">This appointment already has an outcome recorded. You can re-submit to update it.</p>
          </div>
        )}

        {/* Step 1: Show or No Show */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-semibold text-text-secondary text-center mb-2">Did the member show up?</p>
            <button
              onClick={() => handleShowNoShow('Show')}
              className={`w-full py-8 rounded-2xl text-lg font-bold border-2 transition-colors ${
                showOrNoShow === 'Show'
                  ? 'bg-green-50 border-green-400 text-green-700'
                  : 'bg-surface border-border text-text-primary active:bg-bg'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 mx-auto mb-2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Show
            </button>
            <button
              onClick={() => handleShowNoShow('No Show')}
              className={`w-full py-8 rounded-2xl text-lg font-bold border-2 transition-colors ${
                showOrNoShow === 'No Show'
                  ? 'bg-red-50 border-red-400 text-red-600'
                  : 'bg-surface border-border text-text-primary active:bg-bg'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 mx-auto mb-2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              No Show
            </button>
          </div>
        )}

        {/* Step 2: Sale or No Sale */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => { setStep(1); setSaleOrNoSale('') }}
              className="self-start flex items-center gap-1 text-sm text-text-muted active:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
            <p className="text-sm font-semibold text-text-secondary text-center mb-2">Was there a sale?</p>
            <button
              onClick={() => { setSaleOrNoSale('Sale'); setStep(3) }}
              className={`w-full py-8 rounded-2xl text-lg font-bold border-2 transition-colors ${
                saleOrNoSale === 'Sale'
                  ? 'bg-green-50 border-green-400 text-green-700'
                  : 'bg-surface border-border text-text-primary active:bg-bg'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 mx-auto mb-2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
              Sale
            </button>
            <button
              onClick={() => { setSaleOrNoSale('No Sale'); setStep(3) }}
              className={`w-full py-8 rounded-2xl text-lg font-bold border-2 transition-colors ${
                saleOrNoSale === 'No Sale'
                  ? 'bg-gray-100 border-gray-400 text-gray-600'
                  : 'bg-surface border-border text-text-primary active:bg-bg'
              }`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 mx-auto mb-2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              No Sale
            </button>
          </div>
        )}

        {/* Step 3: Sale type or No-sale reason */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setStep(2)}
              className="self-start flex items-center gap-1 text-sm text-text-muted active:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>

            {saleOrNoSale === 'Sale' ? (
              <>
                <p className="text-sm font-semibold text-text-secondary text-center mb-2">What type of sale?</p>
                <select
                  value={saleType}
                  onChange={e => setSaleType(e.target.value)}
                  className="w-full px-4 py-4 rounded-xl border border-border bg-surface text-text-primary text-base focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
                >
                  <option value="">Select sale type...</option>
                  {saleTypeOptions.map(opt => (
                    <option key={typeof opt === 'string' ? opt : opt.value} value={typeof opt === 'string' ? opt : opt.value}>
                      {typeof opt === 'string' ? opt : opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setStep(4)}
                  disabled={!saleType}
                  className={`w-full py-4 rounded-xl text-base font-semibold transition-colors ${
                    saleType
                      ? 'bg-wcs-red text-white active:opacity-80'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Continue
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-text-secondary text-center mb-2">Reason for no sale</p>
                <textarea
                  value={noSaleReason}
                  onChange={e => setNoSaleReason(e.target.value)}
                  placeholder="Enter the reason..."
                  rows={4}
                  className="w-full px-4 py-3 rounded-xl border border-border bg-surface text-text-primary text-base resize-none focus:outline-none focus:ring-2 focus:ring-wcs-red/30"
                />
                <button
                  onClick={() => setStep(4)}
                  disabled={!noSaleReason.trim()}
                  className={`w-full py-4 rounded-xl text-base font-semibold transition-colors ${
                    noSaleReason.trim()
                      ? 'bg-wcs-red text-white active:opacity-80'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Continue
                </button>
              </>
            )}
          </div>
        )}

        {/* Step 4: Review & Submit */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <button
              onClick={() => setStep(showOrNoShow === 'No Show' ? 1 : 3)}
              className="self-start flex items-center gap-1 text-sm text-text-muted active:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>

            <p className="text-sm font-semibold text-text-secondary text-center mb-2">Review & Submit</p>

            <div className="bg-bg rounded-2xl p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Contact</span>
                <span className="font-semibold text-text-primary">{contactName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Appointment</span>
                <span className="text-text-primary">{formatDateTime(apt.appointment_time)}</span>
              </div>
              <div className="border-t border-border" />
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Attendance</span>
                <span className={`font-semibold ${showOrNoShow === 'No Show' ? 'text-red-600' : 'text-green-700'}`}>
                  {showOrNoShow}
                </span>
              </div>
              {showOrNoShow !== 'No Show' && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Outcome</span>
                    <span className="font-semibold text-text-primary">{saleOrNoSale}</span>
                  </div>
                  {saleOrNoSale === 'Sale' && (
                    <div className="flex justify-between text-sm">
                      <span className="text-text-muted">Sale Type</span>
                      <span className="font-semibold text-text-primary">{saleType}</span>
                    </div>
                  )}
                  {saleOrNoSale === 'No Sale' && (
                    <div className="text-sm">
                      <span className="text-text-muted">Reason</span>
                      <p className="mt-1 text-text-primary">{noSaleReason}</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full py-4 rounded-xl bg-wcs-red text-white text-base font-semibold active:opacity-80 disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MobileDayOne({ user }) {
  const [tab, setTab] = useState('pending')
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedApt, setSelectedApt] = useState(null)

  const isAdmin = user?.staff?.role === 'admin' || user?.staff?.role === 'director'
  const defaultSlug = (
    user?.staff?.locations?.find(l => l.is_primary)?.name ||
    user?.staff?.locations?.[0]?.name ||
    'salem'
  ).toLowerCase()
  const [locationSlug, setLocationSlug] = useState(defaultSlug)

  const fetchAppointments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getDayOneTrackerAppointments({ location_slug: locationSlug })
      setAppointments(res.appointments || res.data || res || [])
    } catch (err) {
      console.error('Failed to fetch day one appointments:', err)
      setAppointments([])
    } finally {
      setLoading(false)
    }
  }, [locationSlug])

  useEffect(() => { fetchAppointments() }, [fetchAppointments])

  const pendingList = appointments.filter(isPending)
  const completedList = appointments.filter(isCompleted)
  const displayList = tab === 'pending' ? pendingList : completedList

  function handleSubmitted(confirmedFields) {
    setAppointments(prev => prev.map(a =>
      a.id === selectedApt.id ? { ...a, ...confirmedFields } : a
    ))
    setSelectedApt(null)
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Tab toggle */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab('pending')}
            className={`flex-1 pb-3 text-sm font-semibold text-center transition-colors ${
              tab === 'pending'
                ? 'text-wcs-red border-b-2 border-wcs-red'
                : 'text-text-muted'
            }`}
          >
            Pending ({pendingList.length})
          </button>
          <button
            onClick={() => setTab('completed')}
            className={`flex-1 pb-3 text-sm font-semibold text-center transition-colors ${
              tab === 'completed'
                ? 'text-wcs-red border-b-2 border-wcs-red'
                : 'text-text-muted'
            }`}
          >
            Completed ({completedList.length})
          </button>
        </div>
      </div>

      {/* Location selector (admin/director only) */}
      {isAdmin && (
        <div className="px-4 pb-2 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            {LOCATIONS.map(loc => (
              <button
                key={loc.slug}
                onClick={() => setLocationSlug(loc.slug)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border whitespace-nowrap transition-colors ${
                  locationSlug === loc.slug
                    ? 'bg-wcs-red text-white border-wcs-red'
                    : 'bg-surface text-text-secondary border-border'
                }`}
              >
                {loc.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Appointment list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <svg className="animate-spin h-6 w-6 text-wcs-red" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
        ) : displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10 mb-2 opacity-40">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">
              {tab === 'pending' ? 'No pending appointments' : 'No completed appointments'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-2">
            {displayList.map((apt, i) => (
              <button
                key={apt.id || i}
                onClick={() => setSelectedApt(apt)}
                className="w-full text-left bg-surface rounded-2xl border border-border p-4 flex items-start gap-3 active:bg-bg transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary truncate">
                    {capitalize(apt.contact_name || apt.name || 'Unknown')}
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {formatDateTime(apt.appointment_time)}
                  </p>
                  {apt.trainer_name && (
                    <p className="text-xs text-text-muted mt-0.5">
                      Trainer: {apt.trainer_name}
                    </p>
                  )}
                </div>
                <StatusBadge apt={apt} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Outcome modal */}
      {selectedApt && (
        <OutcomeModal
          apt={selectedApt}
          locationSlug={locationSlug}
          onClose={() => setSelectedApt(null)}
          onSubmitted={handleSubmitted}
        />
      )}
    </div>
  )
}
