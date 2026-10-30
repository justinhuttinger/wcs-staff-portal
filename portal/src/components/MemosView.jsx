import { useState, useEffect, useCallback } from 'react'
import {
  getLiveMemo, getMemosManage, createMemoEdition, updateMemoEdition,
  saveClubMemo, publishClubMemo, endClubMemo,
} from '../lib/api'

const STATE_LABELS = {
  not_started: 'Not started',
  draft: 'Draft',
  scheduled: 'Scheduled',
  live: 'Live',
  ended: 'Ended',
  replaced: 'Replaced',
}
const STATE_COLORS = {
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
  draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  live: 'bg-green-50 text-green-700 border-green-200',
  ended: 'bg-gray-100 text-gray-600 border-gray-200',
  replaced: 'bg-gray-100 text-gray-600 border-gray-200',
}

const CARD = 'bg-surface border border-border rounded-xl p-5 mb-6'
const LABEL = 'block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1'
const INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-muted placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red'
const BTN_PRIMARY = 'px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:opacity-90 disabled:opacity-50'
const BTN_SECONDARY = 'px-4 py-2 text-sm font-semibold rounded-lg border border-border text-text-muted hover:border-wcs-red disabled:opacity-50'

function monthLabel(month) {
  if (!month) return ''
  return new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function dateLabel(value) {
  return value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : ''
}

// ISO -> the value a datetime-local input wants, in the browser's time zone.
function toLocalInput(value) {
  if (!value) return ''
  const d = new Date(value)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value) {
  return value ? new Date(value).toISOString() : null
}

function CurrentMemo() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [club, setClub] = useState('')

  useEffect(() => {
    let cancelled = false
    getLiveMemo(club)
      .then(d => { if (!cancelled) { setData(d); setError('') } })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [club])

  if (error) return <div className={CARD}><p className="text-sm text-red-600">{error}</p></div>
  if (!data) return <div className={CARD}><p className="text-sm text-text-muted">Loading...</p></div>

  return (
    <>
      <div className={`${CARD} no-print flex flex-wrap items-center gap-3`}>
        {data.clubs.length > 1 && (
          <select value={data.club?.slug || ''} onChange={e => setClub(e.target.value)} className={`${INPUT} w-auto`}>
            {data.clubs.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        )}
        {data.memo && <button type="button" onClick={() => window.print()} className={BTN_SECONDARY}>Print</button>}
      </div>
      <div className={`${CARD} memo-print`}>
        {data.memo ? (
          <>
            <h3 className="text-lg font-black text-text-muted">{monthLabel(data.memo.month)} Memo</h3>
            <p className="text-sm text-text-muted mb-4">{data.club?.name}</p>
            <div className="text-sm text-text-muted whitespace-pre-wrap mb-5">{data.memo.company_body}</div>
            {data.memo.notes && (
              <>
                <h4 className="text-sm font-bold text-text-muted mb-1">{data.club?.name} Notes</h4>
                <div className="text-sm text-text-muted whitespace-pre-wrap">{data.memo.notes}</div>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted">No memo is showing for {data.club?.name || 'your club'} right now.</p>
        )}
      </div>
    </>
  )
}

function CompanySection({ edition, onChanged }) {
  const [body, setBody] = useState(edition.company_body || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => { setBody(edition.company_body || ''); setSaved(false) }, [edition.id, edition.company_body])

  const save = async (extra) => {
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      await updateMemoEdition(edition.id, { company_body: body, ...extra })
      setSaved(true)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={CARD}>
      <h3 className="text-sm font-bold text-text-muted mb-3">Company Section</h3>
      <textarea value={body} onChange={e => setBody(e.target.value)} rows={10} className={INPUT} placeholder="What every club needs to know this month" />
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        <button type="button" disabled={busy} onClick={() => save()} className={BTN_SECONDARY}>Save</button>
        {edition.status === 'draft'
          ? <button type="button" disabled={busy} onClick={() => save({ ready: true })} className={BTN_PRIMARY}>Save and Open to Clubs</button>
          : <button type="button" disabled={busy} onClick={() => save({ ready: false })} className={BTN_SECONDARY}>Close to Clubs</button>}
        <span className="text-xs text-text-muted">
          {edition.status === 'ready' ? 'Open to clubs. Edits show on published memos right away.' : 'Clubs can\'t see this month yet.'}
        </span>
        {saved && <span className="text-xs text-green-600">Saved</span>}
      </div>
    </div>
  )
}

function ClubMemoEditor({ edition, club, memo, lockScreenMax, onChanged }) {
  const [notes, setNotes] = useState('')
  const [lockText, setLockText] = useState('')
  const [startMode, setStartMode] = useState('now')
  const [startsAt, setStartsAt] = useState('')
  const [endMode, setEndMode] = useState('next')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const published = memo.status === 'published'

  useEffect(() => {
    setNotes(memo.notes || '')
    setLockText(memo.lock_screen_text || '')
    setStartMode(memo.starts_at ? 'date' : 'now')
    setStartsAt(toLocalInput(memo.starts_at))
    setEndMode(memo.ends_at ? 'date' : 'next')
    setEndsAt(toLocalInput(memo.ends_at))
    setSaved('')
    setError('')
  }, [edition.id, club.slug, memo.notes, memo.lock_screen_text, memo.starts_at, memo.ends_at])

  const run = async (fn, message) => {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      await fn()
      setSaved(message)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const text = { notes, lock_screen_text: lockText }
  const save = () => run(() => saveClubMemo(edition.id, club.slug, text), 'Saved')
  const publish = () => run(() => publishClubMemo(edition.id, club.slug, {
    ...text,
    starts_at: startMode === 'date' ? fromLocalInput(startsAt) : null,
    ends_at: endMode === 'date' ? fromLocalInput(endsAt) : null,
  }), published ? 'Updated' : 'Published')
  const end = () => {
    if (window.confirm(`Take down ${club.name}'s ${monthLabel(edition.month)} memo now?`)) {
      run(() => endClubMemo(edition.id, club.slug), 'Taken down')
    }
  }

  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-sm font-bold text-text-muted">{club.name} Memo</h3>
        <StateBadge state={memo.state} />
      </div>

      <label className={LABEL}>Club Notes</label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={6} className={`${INPUT} mb-4`} placeholder="Anything specific to your club this month" />

      <label className={LABEL}>Lock Screen Version</label>
      <textarea value={lockText} onChange={e => setLockText(e.target.value)} rows={3} maxLength={lockScreenMax} className={INPUT} placeholder="A few short lines for the iPad lock screen" />
      <p className="text-xs text-text-muted mt-1 mb-4">
        {lockText.length}/{lockScreenMax}. Members can see the iPad lock screen, so keep anything confidential out of this.
      </p>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className={LABEL}>Show From</label>
          <select value={startMode} onChange={e => setStartMode(e.target.value)} className={`${INPUT} mb-2`}>
            <option value="now">Now</option>
            <option value="date">A specific date</option>
          </select>
          {startMode === 'date' && <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} className={INPUT} />}
        </div>
        <div>
          <label className={LABEL}>Show Until</label>
          <select value={endMode} onChange={e => setEndMode(e.target.value)} className={`${INPUT} mb-2`}>
            <option value="next">The next one is published</option>
            <option value="date">A specific date</option>
          </select>
          {endMode === 'date' && <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} className={INPUT} />}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} onClick={save} className={BTN_SECONDARY}>Save</button>
        <button type="button" disabled={busy} onClick={publish} className={BTN_PRIMARY}>
          {published ? 'Save and Update Dates' : startMode === 'now' ? 'Publish and Show Now' : 'Publish on This Date'}
        </button>
        {published && memo.state !== 'ended' && <button type="button" disabled={busy} onClick={end} className={BTN_SECONDARY}>End Now</button>}
        {saved && <span className="text-xs text-green-600">{saved}</span>}
      </div>
    </div>
  )
}

function StateBadge({ state }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${STATE_COLORS[state] || STATE_COLORS.draft}`}>
      {STATE_LABELS[state] || state}
    </span>
  )
}

function ManageMemos() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [editionId, setEditionId] = useState('')
  const [clubSlug, setClubSlug] = useState('')
  const [newMonth, setNewMonth] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await getMemosManage())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (error && !data) return <div className={CARD}><p className="text-sm text-red-600">{error}</p></div>
  if (!data) return <div className={CARD}><p className="text-sm text-text-muted">Loading...</p></div>

  const edition = data.editions.find(e => e.id === editionId) || data.editions[0] || null
  const editable = data.clubs.filter(c => c.editable)
  const club = editable.find(c => c.slug === clubSlug) || editable[0] || null

  const addMonth = async () => {
    try {
      const { edition: created } = await createMemoEdition(newMonth)
      setNewMonth('')
      setEditionId(created.id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        {data.editions.length > 0 && (
          <div>
            <label className={LABEL}>Month</label>
            <select value={edition?.id || ''} onChange={e => setEditionId(e.target.value)} className={INPUT}>
              {data.editions.map(e => <option key={e.id} value={e.id}>{monthLabel(e.month)}</option>)}
            </select>
          </div>
        )}
        {data.can.company && (
          <>
            <div>
              <label className={LABEL}>New Month</label>
              <input type="month" value={newMonth} onChange={e => setNewMonth(e.target.value)} className={INPUT} />
            </div>
            <button type="button" disabled={!newMonth} onClick={addMonth} className={BTN_SECONDARY}>Add Month</button>
          </>
        )}
        {error && <p className="text-sm text-red-600 w-full">{error}</p>}
      </div>

      {!edition && (
        <div className={CARD}>
          <p className="text-sm text-text-muted">
            {data.can.company ? 'Add a month to start the first memo.' : 'The company section for this month isn\'t ready yet.'}
          </p>
        </div>
      )}

      {edition && data.can.company && <CompanySection edition={edition} onChanged={load} />}

      {edition && edition.status === 'ready' && !data.can.company && (
        <div className={CARD}>
          <h3 className="text-sm font-bold text-text-muted mb-2">Company Section</h3>
          <div className="text-sm text-text-muted whitespace-pre-wrap">{edition.company_body}</div>
        </div>
      )}

      {edition && edition.status === 'ready' && club && (
        <>
          {editable.length > 1 && (
            <div className={CARD}>
              <label className={LABEL}>Club</label>
              <select value={club.slug} onChange={e => setClubSlug(e.target.value)} className={`${INPUT} sm:w-64`}>
                {editable.map(c => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
          )}
          <ClubMemoEditor
            edition={edition}
            club={club}
            memo={edition.club_memos[club.slug] || { state: 'not_started' }}
            lockScreenMax={data.lock_screen_max}
            onChanged={load}
          />
        </>
      )}

      {edition && data.clubs.length > 1 && (
        <div className={CARD}>
          <h3 className="text-sm font-bold text-text-muted mb-3">Club Status</h3>
          <div className="divide-y divide-border">
            {data.clubs.map(c => {
              const row = edition.club_memos[c.slug] || {}
              return (
                <div key={c.slug} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-text-muted">{c.name}</span>
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    {row.starts_at && <span>{dateLabel(row.starts_at)}{row.ends_at ? ` to ${dateLabel(row.ends_at)}` : ''}</span>}
                    <StateBadge state={row.state || 'not_started'} />
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

export default function MemosView({ user }) {
  const visibleTools = user?.visible_tools || []
  const role = user?.staff?.role
  const canManage = visibleTools.includes('memos:company-edit') || ['manager', 'marketing', 'corporate', 'director', 'admin'].includes(role)
  const [tab, setTab] = useState('current')

  return (
    <div className="w-full max-w-4xl mx-auto px-8 pb-12">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .memo-print, .memo-print * { visibility: visible; }
          .memo-print { position: absolute; left: 0; top: 0; width: 100%; padding: 0.5in; background: white; border: 0; color: black; }
          .memo-print * { color: black !important; }
          .no-print { display: none !important; }
          @page { margin: 0.4in; size: portrait; }
        }
      `}</style>
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6 no-print flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black text-text-muted tracking-[-0.5px]">Memos</h2>
        {canManage && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setTab('current')} className={tab === 'current' ? BTN_PRIMARY : BTN_SECONDARY}>Current Memo</button>
            <button type="button" onClick={() => setTab('manage')} className={tab === 'manage' ? BTN_PRIMARY : BTN_SECONDARY}>Write and Publish</button>
          </div>
        )}
      </div>
      {tab === 'manage' && canManage ? <ManageMemos /> : <CurrentMemo />}
    </div>
  )
}
