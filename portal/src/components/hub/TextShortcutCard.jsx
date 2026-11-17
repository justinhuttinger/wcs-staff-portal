import { useState, useEffect } from 'react'
import { hub, HUB_TEXT_URL } from '../../lib/api'
import { Button, ErrorBanner } from '../adsmanager/ui'

const CARD = 'bg-surface/95 backdrop-blur-sm rounded-xl border border-border'

function CopyField({ label, value }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-text-primary">{value}</code>
        <Button variant="secondary" className="!px-3 !py-1.5 !text-xs" onClick={copy}>{done ? 'Copied!' : 'Copy'}</Button>
      </div>
    </div>
  )
}

// Admin > Hub: the private key for the iPhone Shortcut that sends texts from
// staff contacts to the Hub as suggestions. The key is shown once.
export default function TextShortcutCard() {
  const [status, setStatus] = useState(null)
  const [newKey, setNewKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { hub.textKey.get().then(setStatus).catch(e => setError(e.message)) }, [])

  const create = async () => {
    if (status?.exists && !window.confirm('Reset the key? Your current Shortcut stops working until you paste the new key into it.')) return
    setBusy(true); setError('')
    try {
      const r = await hub.textKey.reset()
      setNewKey(r.key)
      setStatus({ exists: true, created_at: r.created_at })
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className={`${CARD} p-5 space-y-3 lg:col-span-2`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-text-primary">Texts from staff (iPhone Shortcut)</h3>
        <Button variant={status?.exists ? 'secondary' : 'primary'} onClick={create} disabled={busy || !status}>
          {busy ? 'Working…' : status?.exists ? 'Reset key' : 'Create key'}
        </Button>
      </div>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <p className="text-xs text-text-muted">
        {status?.exists
          ? `Key created ${new Date(status.created_at).toLocaleDateString()}. Texts from the contacts you pick show up in the Hub as suggestions.`
          : 'Not set up. Create a key, then set up the Shortcut below on your iPhone.'}
      </p>
      {newKey && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
          <p className="text-xs font-semibold text-amber-800">Copy this key now. It won't be shown again.</p>
          <CopyField label="Key" value={newKey} />
        </div>
      )}
      <CopyField label="Address (URL)" value={HUB_TEXT_URL} />
      <ol className="list-decimal pl-5 space-y-1 text-xs text-text-primary">
        <li>On your iPhone open <b>Shortcuts</b>, tap <b>Automation</b>, then <b>New Automation</b> (or <b>+</b>).</li>
        <li>Choose <b>Message</b>. Under <b>Sender</b>, pick your staff contacts. Choose <b>Run Immediately</b> (iOS 17 or later) and turn off <b>Notify When Run</b>. Tap <b>Next</b>, then <b>New Blank Automation</b>.</li>
        <li>Add the action <b>Get Phone Numbers from Input</b>. Tap its input and choose <b>Shortcut Input</b>, then tap that and pick <b>Sender</b>.</li>
        <li>Add the action <b>Get Contents of URL</b> and paste the address above. Tap <b>Show More</b>. Set <b>Method</b> to <b>POST</b>. Under <b>Headers</b> add <code>X-Hub-Key</code> with your key as the value.</li>
        <li>Set <b>Request Body</b> to <b>JSON</b> and add three <b>Text</b> fields: <code>name</code> = Shortcut Input → <b>Sender</b>; <code>phone</code> = <b>Phone Numbers</b> (from step 3); <code>text</code> = Shortcut Input → <b>Content</b>.</li>
        <li>Tap <b>Done</b>. Send yourself a test from one of those contacts and check <b>Suggested</b> in the Hub. Nothing is ever texted back.</li>
      </ol>
    </div>
  )
}
