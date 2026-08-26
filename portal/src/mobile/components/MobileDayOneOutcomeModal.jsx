import React, { useState } from 'react'
import DayOneOutcomeFrame from '../../components/DayOneOutcomeFrame'

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
  const [step] = useState(initialStep)
  // Review mode reads straight off the appointment; the form itself is embedded
  // from the API, so this component no longer holds any outcome state of its own.
  const contactName = capitalize(apt.contact_name || apt.name || 'Unknown')

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
          </div>
        )}

        {/* The outcome form itself is served by the API and embedded, not
            reimplemented here. One form, one look, one write path: the portal
            used to write outcomes to GHL custom fields only, which left 27 Day
            Ones with an outcome GHL knew about and Supabase did not. */}
        {step !== 'review' && (
          <DayOneOutcomeFrame
            contactId={apt.contact_id}
            onRecorded={() => { if (onSubmitted) onSubmitted(); if (onClose) onClose() }}
          />
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
