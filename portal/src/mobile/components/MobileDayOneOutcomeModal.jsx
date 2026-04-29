import React, { useState, useEffect } from 'react'
import { submitDayOneResult, getDayOneFieldOptions } from '../../lib/api'

function capitalize(str) {
  if (!str) return ''
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function isCancelled(apt) {
  const s = (apt?.status || '').toLowerCase().replace(/\s+/g, '')
  return s === 'cancelled'
}

export function isCompleted(apt) {
  if (!apt || isCancelled(apt)) return false
  const s = (apt.day_one_status || '').toLowerCase()
  return s === 'completed' || s === 'no show' || apt.show_or_no_show === 'No Show'
}

export default function MobileDayOneOutcomeModal({ apt, locationSlug, onClose, onSubmitted, readOnly = false }) {
  // Already-recorded outcomes open in review mode so users can read first; pending ones jump into the form.
  const initialStep = readOnly || isCompleted(apt) ? 'review' : 1
  const [step, setStep] = useState(initialStep)
  const [showOrNoShow, setShowOrNoShow] = useState(apt.show_or_no_show || '')
  const [saleOrNoSale, setSaleOrNoSale] = useState(apt.day_one_sale || '')
  const [saleType, setSaleType] = useState(apt.pt_sale_type || '')
  const [noSaleReason, setNoSaleReason] = useState(apt.why_no_sale || '')
  const [saleTypeOptions, setSaleTypeOptions] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getDayOneFieldOptions({ location_slug: locationSlug })
      .then(res => { if (!cancelled) setSaleTypeOptions(res.pt_sale_types || []) })
      .catch(() => { if (!cancelled) setSaleTypeOptions([]) })
    return () => { cancelled = true }
  }, [locationSlug])

  useEffect(() => {
    if (apt.show_or_no_show) setShowOrNoShow(apt.show_or_no_show)
    if (apt.day_one_sale) setSaleOrNoSale(apt.day_one_sale)
    if (apt.pt_sale_type) setSaleType(apt.pt_sale_type)
    if (apt.why_no_sale) setNoSaleReason(apt.why_no_sale)
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
        pt_sale_type: saleOrNoSale === 'Sale' ? saleType : null,
        why_no_sale: saleOrNoSale === 'No Sale' ? noSaleReason : null,
      })
    } catch (err) {
      setError(err.message || 'Failed to submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleShowNoShow(val) {
    setShowOrNoShow(val)
    if (val === 'No Show') setStep(4)
    else setStep(2)
  }

  const contactName = capitalize(apt.contact_name || apt.name || 'Unknown')

  function startEdit() {
    setStep(1)
  }

  return (
    <div className="fixed inset-0 bg-surface z-[60] flex flex-col">
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

      <div className="flex-1 overflow-y-auto px-4 py-6">
        {/* Read-only summary mode for already-completed Day Ones */}
        {step === 'review' && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl bg-bg p-4 space-y-3">
              <DetailRow label="Status" value={apt.day_one_status || (apt.show_or_no_show === 'No Show' ? 'No Show' : 'Completed')} />
              {apt.show_or_no_show && <DetailRow label="Attendance" value={apt.show_or_no_show} />}
              {apt.day_one_sale && <DetailRow label="Outcome" value={apt.day_one_sale} />}
              {apt.pt_sale_type && <DetailRow label="Sale Type" value={apt.pt_sale_type} />}
              {apt.why_no_sale && (
                <div className="text-sm">
                  <span className="text-text-muted">Why No Sale</span>
                  <p className="mt-1 text-text-primary whitespace-pre-wrap">{apt.why_no_sale}</p>
                </div>
              )}
              {apt.assigned_user_name && <DetailRow label="Trainer" value={apt.assigned_user_name} />}
              {apt.day_one_booking_team_member && <DetailRow label="Booked By" value={apt.day_one_booking_team_member} />}
            </div>

            {!readOnly && (
              <button
                onClick={startEdit}
                className="w-full py-3 rounded-xl border-2 border-wcs-red text-wcs-red text-sm font-semibold active:bg-wcs-red/5"
              >
                Update Outcome
              </button>
            )}
          </div>
        )}

        {/* Existing status banner when re-submitting */}
        {step !== 'review' && isCompleted(apt) && (
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
              <DetailRow label="Contact" value={contactName} />
              <DetailRow label="Appointment" value={formatDateTime(apt.appointment_time)} />
              <div className="border-t border-border" />
              <DetailRow
                label="Attendance"
                value={showOrNoShow}
                valueClassName={showOrNoShow === 'No Show' ? 'text-red-600 font-semibold' : 'text-green-700 font-semibold'}
              />
              {showOrNoShow !== 'No Show' && (
                <>
                  <DetailRow label="Outcome" value={saleOrNoSale} />
                  {saleOrNoSale === 'Sale' && <DetailRow label="Sale Type" value={saleType} />}
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

function DetailRow({ label, value, valueClassName }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={valueClassName || 'text-text-primary font-medium'}>{value || '—'}</span>
    </div>
  )
}
