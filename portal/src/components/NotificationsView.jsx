import { useState, useEffect } from 'react'
import { sendPushNotification, getNotificationLocations } from '../lib/api'

export default function NotificationsView({ onBack }) {
  const [locations, setLocations] = useState([])
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [selectedLocations, setSelectedLocations] = useState([])
  const [sendTiming, setSendTiming] = useState('now')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState('')
  const [screenshot, setScreenshot] = useState(null)
  const [error, setError] = useState(null)

  const isElectron = !!window.wcsElectron?.runNotification

  useEffect(() => {
    if (isElectron) {
      window.wcsElectron.getNotificationLocations()
        .then(locs => setLocations(locs || []))
        .catch(() => {})
    } else {
      getNotificationLocations()
        .then(res => setLocations(res.locations || []))
        .catch(() => {})
    }
  }, [isElectron])

  const allSelected = locations.length > 0 && selectedLocations.length === locations.length

  function toggleLocation(slug) {
    setSelectedLocations(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    )
  }

  function toggleAll() {
    if (allSelected) {
      setSelectedLocations([])
    } else {
      setSelectedLocations(locations.map(l => l.slug))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || !message.trim() || selectedLocations.length === 0) return
    if (sendTiming === 'scheduled' && !scheduledDate) return

    setSubmitting(true)
    setStatus('Logging into Trainerize...')
    setError(null)
    setScreenshot(null)

    // Update status messages on a timer to show progress
    const steps = [
      { delay: 3000, text: 'Navigating to Announcements...' },
      { delay: 6000, text: 'Opening notification form...' },
      { delay: 9000, text: 'Filling in title and message...' },
      { delay: 12000, text: 'Selecting locations...' },
      { delay: 16000, text: 'Taking screenshot for review...' },
    ]
    const timers = steps.map(s => setTimeout(() => setStatus(s.text), s.delay))

    try {
      const payload = {
        title: title.trim(),
        message: message.trim(),
        locations: allSelected ? ['all'] : selectedLocations,
        sendTiming,
        scheduledDate: sendTiming === 'scheduled' ? scheduledDate : undefined,
        scheduledTime: sendTiming === 'scheduled' ? scheduledTime : undefined,
      }

      let res
      if (isElectron) {
        res = await window.wcsElectron.runNotification(payload)
        if (!res.success) throw new Error(res.error || 'Automation failed')
      } else {
        res = await sendPushNotification(payload)
      }

      timers.forEach(clearTimeout)
      setScreenshot(res.screenshot)
      setStatus('Form filled successfully — review the screenshot below.')
    } catch (err) {
      timers.forEach(clearTimeout)
      setError(err.message || 'Failed to fill notification form')
      setStatus('')
    } finally {
      setSubmitting(false)
    }
  }

  function downloadScreenshot() {
    if (!screenshot) return
    const link = document.createElement('a')
    link.href = screenshot
    link.download = `notification-preview-${Date.now()}.png`
    link.click()
  }

  function resetForm() {
    setTitle('')
    setMessage('')
    setSelectedLocations([])
    setSendTiming('now')
    setScheduledDate('')
    setScheduledTime('')
    setScreenshot(null)
    setStatus('')
    setError(null)
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-8 pb-12">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-lg font-bold text-text-primary">Push Notifications</h2>
      </div>

      {/* Screenshot result */}
      {screenshot && (
        <div className="mb-6 space-y-3">
          <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-700 font-medium">
            {status}
          </div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <img src={screenshot} alt="Notification preview" className="w-full" />
          </div>
          <div className="flex gap-3">
            <button onClick={downloadScreenshot} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors">
              Download Screenshot
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-surface text-text-primary hover:bg-bg transition-colors">
              Create Another
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-xs underline hover:no-underline">Dismiss</button>
        </div>
      )}

      {/* Form */}
      {!screenshot && (
        <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-6 space-y-5">
          {/* Title */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1">
              Title <span className="text-text-muted font-normal">({title.length}/65)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value.slice(0, 65))}
              placeholder="Notification title..."
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
              required
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1">
              Message <span className="text-text-muted font-normal">({message.length}/120)</span>
            </label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, 120))}
              placeholder="What do you want to notify members about?"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red resize-y"
              required
            />
          </div>

          {/* Send Timing */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-2">When to send?</label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setSendTiming('now')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  sendTiming === 'now' ? 'bg-wcs-red text-white' : 'border border-border bg-bg text-text-primary hover:bg-surface'
                }`}
              >
                Send Now
              </button>
              <button
                type="button"
                onClick={() => setSendTiming('scheduled')}
                className={`px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
                  sendTiming === 'scheduled' ? 'bg-wcs-red text-white' : 'border border-border bg-bg text-text-primary hover:bg-surface'
                }`}
              >
                Schedule
              </button>
            </div>
            {sendTiming === 'scheduled' && (
              <div className="flex gap-3 mt-3">
                <div className="flex-1">
                  <label className="block text-xs text-text-muted mb-1">Date</label>
                  <input
                    type="date"
                    value={scheduledDate}
                    onChange={e => setScheduledDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
                    required
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-text-muted mb-1">Time</label>
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={e => setScheduledTime(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Locations */}
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-2">Locations</label>
            <div className="space-y-1">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bg transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded border-border text-wcs-red focus:ring-wcs-red"
                />
                <span className="text-sm font-semibold text-text-primary">All Locations</span>
              </label>
              <div className="ml-4 space-y-1">
                {locations.map(loc => (
                  <label key={loc.slug} className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-bg transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedLocations.includes(loc.slug)}
                      onChange={() => toggleLocation(loc.slug)}
                      className="rounded border-border text-wcs-red focus:ring-wcs-red"
                    />
                    <span className="text-sm text-text-primary">{loc.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Progress */}
          {submitting && status && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <div className="w-4 h-4 border-2 border-wcs-red/30 border-t-wcs-red rounded-full animate-spin shrink-0" />
              {status}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !title.trim() || !message.trim() || selectedLocations.length === 0 || (sendTiming === 'scheduled' && !scheduledDate)}
            className="w-full px-5 py-3 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Processing...' : 'Fill Form & Take Screenshot'}
          </button>
          <p className="text-[10px] text-text-muted text-center">
            This will fill the Trainerize form but will NOT send the notification. A screenshot will be taken for your review.
          </p>
        </form>
      )}
    </div>
  )
}
