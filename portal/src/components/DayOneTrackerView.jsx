import { useState, useEffect } from 'react'
import { getDayOneTrackerAppointments, submitDayOneResult, getDayOneFieldOptions } from '../lib/api'

const LOCATIONS = [
  { slug: 'salem', label: 'Salem' },
  { slug: 'keizer', label: 'Keizer' },
  { slug: 'eugene', label: 'Eugene' },
  { slug: 'springfield', label: 'Springfield' },
  { slug: 'clackamas', label: 'Clackamas' },
  { slug: 'milwaukie', label: 'Milwaukie' },
  { slug: 'medford', label: 'Medford' },
]

function StatusBadge({ appointment }) {
  const s = appointment.day_one_status
  const sale = appointment.day_one_sale
  if (s === 'No Show' || appointment.show_or_no_show === 'No Show') {
    return <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-xs border border-red-200">No Show</span>
  }
  if (s === 'Completed') {
    if (sale === 'Sale') {
      return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Sale</span>
    }
    if (sale === 'No Sale') {
      return <span className="px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 text-xs border border-gray-200">No Sale</span>
    }
    return <span className="px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs border border-green-200">Completed</span>
  }
  return <span className="px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 text-xs border border-yellow-200">Pending</span>
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function OutcomeModal({ appointment, locationSlug, onClose, onSubmitted }) {
  const [step, setStep] = useState(1)
  const [showNoShow, setShowNoShow] = useState(null)
  const [saleResult, setSaleResult] = useState(null)
  const [ptSaleType, setPtSaleType] = useState('')
  const [whyNoSale, setWhyNoSale] = useState('')
  const [fieldOptions, setFieldOptions] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getDayOneFieldOptions({ location_slug: locationSlug })
      .then(setFieldOptions)
      .catch(() => setFieldOptions({ pt_sale_types: [], no_sale_reasons: [] }))
  }, [locationSlug])

  async function handleSubmit(data) {
    setSubmitting(true)
    setError('')
    try {
      await submitDayOneResult({
        contact_id: appointment.contact_id,
        location_slug: locationSlug,
        ...data,
      })
      onSubmitted()
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  function handleShowNoShow(value) {
    setShowNoShow(value)
    if (value === 'No Show') {
      handleSubmit({ show_no_show: 'No Show', sale_result: null, pt_sale_type: null, why_no_sale: null })
    } else {
      setStep(2)
    }
  }

  function handleSaleResult(value) {
    setSaleResult(value)
    setStep(3)
  }

  function handleFinalSubmit() {
    handleSubmit({
      show_no_show: 'Show',
      sale_result: saleResult,
      pt_sale_type: saleResult === 'Sale' ? ptSaleType : null,
      why_no_sale: saleResult === 'No Sale' ? whyNoSale : null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface rounded-2xl border border-border w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-lg font-bold text-text-primary">{appointment.contact_name}</h3>
            <p className="text-xs text-text-muted">{formatDateTime(appointment.appointment_time)}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-2xl leading-none">&times;</button>
        </div>

        {error && <p className="text-wcs-red text-sm mb-4">{error}</p>}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Did they show up?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleShowNoShow('Show')}
                disabled={submitting}
                className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors disabled:opacity-50"
              >
                Show
              </button>
              <button
                onClick={() => handleShowNoShow('No Show')}
                disabled={submitting}
                className="py-6 rounded-xl bg-red-50 border-2 border-red-200 text-red-600 font-bold text-lg hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                No Show
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-text-primary text-center mb-4">Sale or No Sale?</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleSaleResult('Sale')}
                className="py-6 rounded-xl bg-green-50 border-2 border-green-200 text-green-700 font-bold text-lg hover:bg-green-100 transition-colors"
              >
                Sale
              </button>
              <button
                onClick={() => handleSaleResult('No Sale')}
                className="py-6 rounded-xl bg-gray-50 border-2 border-gray-200 text-gray-600 font-bold text-lg hover:bg-gray-100 transition-colors"
              >
                No Sale
              </button>
            </div>
            <button onClick={() => setStep(1)} className="text-xs text-text-muted hover:text-text-primary mt-2">Back</button>
          </div>
        )}

        {step === 3 && saleResult === 'Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">What did they sell?</p>
            <select
              value={ptSaleType}
              onChange={e => setPtSaleType(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Select sale type...</option>
              {(fieldOptions?.pt_sale_types || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              onClick={handleFinalSubmit}
              disabled={!ptSaleType || submitting}
              className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
            <button onClick={() => setStep(2)} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}

        {step === 3 && saleResult === 'No Sale' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-text-primary text-center">Why no sale?</p>
            <select
              value={whyNoSale}
              onChange={e => setWhyNoSale(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Select reason...</option>
              {(fieldOptions?.no_sale_reasons || []).map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              onClick={handleFinalSubmit}
              disabled={!whyNoSale || submitting}
              className="w-full py-3 rounded-xl bg-wcs-red text-white font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Submit'}
            </button>
            <button onClick={() => setStep(2)} className="text-xs text-text-muted hover:text-text-primary">Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DayOneTrackerView({ user, onBack }) {
  const [appointments, setAppointments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [locationSlug, setLocationSlug] = useState('salem')
  const [activeModal, setActiveModal] = useState(null)

  useEffect(() => { loadAppointments() }, [locationSlug])

  async function loadAppointments() {
    setLoading(true)
    setError('')
    try {
      const now = new Date()
      const start_date = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
      const end_date = now.toISOString().split('T')[0]
      const res = await getDayOneTrackerAppointments({ location_slug: locationSlug, start_date, end_date })
      setAppointments(res.appointments || [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  const pending = appointments.filter(a => !a.day_one_status && a.show_or_no_show !== 'No Show')
  const completed = appointments.filter(a => a.day_one_status || a.show_or_no_show === 'No Show')

  return (
    <div className="max-w-3xl mx-auto w-full px-8 py-6">
      <div className="mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-text-primary">Day One Tracker</h2>
          {pending.length > 0 && (
            <span className="px-3 py-1 rounded-full bg-yellow-50 text-yellow-700 text-sm font-medium border border-yellow-200">
              {pending.length} pending
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {LOCATIONS.map(loc => (
          <button
            key={loc.slug}
            onClick={() => setLocationSlug(loc.slug)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              locationSlug === loc.slug
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:text-text-primary hover:border-text-muted'
            }`}
          >
            {loc.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}
      {loading && <p className="text-text-muted text-sm py-8 text-center">Loading Day One appointments...</p>}

      {!loading && (
        <>
          {pending.length > 0 && (
            <div className="mb-6">
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Pending</h3>
              <div className="flex flex-col gap-2">
                {pending.map(apt => (
                  <button
                    key={apt.id}
                    onClick={() => setActiveModal(apt)}
                    className="w-full flex items-center justify-between p-4 rounded-xl bg-surface border border-border hover:border-wcs-red/50 transition-colors text-left"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{apt.contact_name}</p>
                      <p className="text-xs text-text-muted mt-0.5">{formatDateTime(apt.appointment_time)}</p>
                      {apt.assigned_user_name && (
                        <p className="text-xs text-text-muted">Trainer: {apt.assigned_user_name}</p>
                      )}
                    </div>
                    <StatusBadge appointment={apt} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Completed</h3>
              <div className="flex flex-col gap-2">
                {completed.map(apt => (
                  <div
                    key={apt.id}
                    className="flex items-center justify-between p-4 rounded-xl bg-surface border border-border opacity-75"
                  >
                    <div>
                      <p className="font-medium text-text-primary">{apt.contact_name}</p>
                      <p className="text-xs text-text-muted mt-0.5">{formatDateTime(apt.appointment_time)}</p>
                      {apt.assigned_user_name && (
                        <p className="text-xs text-text-muted">Trainer: {apt.assigned_user_name}</p>
                      )}
                    </div>
                    <StatusBadge appointment={apt} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {appointments.length === 0 && (
            <p className="text-text-muted text-sm py-8 text-center">No Day One appointments found for this month</p>
          )}
        </>
      )}

      {activeModal && (
        <OutcomeModal
          appointment={activeModal}
          locationSlug={locationSlug}
          onClose={() => setActiveModal(null)}
          onSubmitted={() => { setActiveModal(null); loadAppointments() }}
        />
      )}
    </div>
  )
}
