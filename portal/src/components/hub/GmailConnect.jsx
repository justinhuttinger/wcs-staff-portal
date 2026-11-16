import { useState, useEffect } from 'react'
import { followUps } from '../../lib/api'
import { Button, ErrorBanner } from '../adsmanager/ui'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

// Gmail consent for the Hub. Reuses the Follow-ups OAuth flow (gmail.send +
// gmail.readonly, plus the scopes meeting notes already holds).
export default function GmailConnect({ status, onConnected }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const onMsg = (e) => { if (e.data?.type === 'follow-ups-auth') onConnected() }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [onConnected])
  const connect = async () => {
    setBusy(true); setError('')
    try {
      const { url } = await followUps.authUrl()
      window.open(url, 'follow-ups-auth', 'width=520,height=680')
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className={`${CARD} p-5 flex items-center justify-between gap-4 flex-wrap`}>
      <div>
        <h3 className="text-sm font-bold text-text-primary">Connect your Gmail</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Needed to email people from a task and see their replies.
          {status?.connected && !status?.ready && ' Your Google account is connected, but without Gmail access yet.'}
        </p>
        <ErrorBanner error={error} />
      </div>
      <Button onClick={connect} disabled={busy}>{busy ? 'Opening…' : 'Connect Gmail'}</Button>
    </div>
  )
}
