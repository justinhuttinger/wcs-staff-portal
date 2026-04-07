import { useState, useEffect } from 'react'

const SERVICE_NAMES = {
  abc: 'ABC Financial',
  ghl: 'Grow (GHL)',
  wheniwork: 'WhenIWork',
  paychex: 'Paychex',
}

export default function SaveCredentialToast({ service, username, onRespond }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onRespond(false)
    }, 10000)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  const serviceName = SERVICE_NAMES[service] || service

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-2">
      <div className="bg-surface border border-border rounded-xl shadow-lg px-6 py-3 flex items-center gap-4 max-w-lg">
        <p className="text-sm text-text-primary">
          Save login for <span className="font-semibold">{serviceName}</span> ({username})?
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => { setVisible(false); onRespond(true) }}
            className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red-hover transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => { setVisible(false); onRespond(false) }}
            className="px-3 py-1.5 rounded-lg border border-border text-text-muted text-xs font-medium hover:text-text-primary transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
