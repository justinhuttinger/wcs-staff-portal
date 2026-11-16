import { useState, useEffect, useCallback } from 'react'
import { hub } from '../../lib/api'
import { Modal, Button, ErrorBanner, Spinner } from '../adsmanager/ui'

function CopyButton({ text, label, onBeforeCopy, variant = 'secondary' }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      const value = onBeforeCopy ? await onBeforeCopy() : text
      await navigator.clipboard.writeText(value)
      setDone(true); setTimeout(() => setDone(false), 1500)
    } catch { /* the modal shows errors from onBeforeCopy */ }
  }
  return <Button variant={variant} className="!px-3 !py-1.5 !text-xs" onClick={copy}>{done ? 'Copied!' : label}</Button>
}

// Everything submitted on a task (one club or all), with the task's share link
// and a "Copy for Claude" block of links + text. No downloading.
export default function SubmissionsModal({ task, club, clubName, onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setData(await hub.share.submissions(task.id, club)) } catch (e) { setError(e.message) }
  }, [task.id, club])
  useEffect(() => { load() }, [load])

  // Both copy buttons make sure a share link exists first.
  const ensureLink = async () => {
    if (data?.shareUrl) return data
    await hub.share.create(task.id)
    const fresh = await hub.share.submissions(task.id, club)
    setData(fresh)
    return fresh
  }
  const turnOff = async () => {
    if (!window.confirm('Turn off the share link? Anyone with it will lose access. You can make a new one anytime.')) return
    try { await hub.share.remove(task.id); load() } catch (e) { setError(e.message) }
  }

  return (
    <Modal wide title={clubName ? `${clubName} submissions` : 'All submissions'} subtitle={task.title} onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <ErrorBanner error={error} onDismiss={() => setError('')} />
      <div className="flex items-center gap-2 flex-wrap">
        <CopyButton label="Copy for Claude" variant="primary" onBeforeCopy={async () => (await ensureLink()).claudeText} />
        <CopyButton label="Copy share link" onBeforeCopy={async () => (await ensureLink()).shareUrl} />
        {data?.shareUrl && <button onClick={turnOff} className="text-xs text-text-muted hover:text-red-600 ml-auto">Turn off link</button>}
      </div>
      {!data && !error && <Spinner />}
      {data && data.groups.length === 0 && <p className="text-sm text-text-muted">Nothing submitted yet.</p>}
      {data?.groups.map(g => (
        <section key={g.club || 'none'} className="space-y-2">
          {!club && <h4 className="text-xs font-bold uppercase tracking-widest text-text-muted">{g.clubName}</h4>}
          <div className="divide-y divide-border rounded-xl border border-border">
            {g.items.map(i => (
              <div key={i.id} className="px-3 py-2 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-text-primary">{i.deliverable}<span className="font-normal text-text-muted"> · {i.person || 'Unassigned'}</span></p>
                  {i.isFile
                    ? <button onClick={() => hub.deliverables.itemUrl(i.id).then(r => window.open(r.url, '_blank', 'noopener')).catch(e => setError(e.message))}
                        className="text-xs text-wcs-red hover:underline break-all">{i.fileName || 'Open file'}</button>
                    : <p className="text-xs text-text-primary whitespace-pre-wrap mt-0.5">{i.text}</p>}
                </div>
                {!i.isFile && <CopyButton text={i.text} label="Copy" />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </Modal>
  )
}
