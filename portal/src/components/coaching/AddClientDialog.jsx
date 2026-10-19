import { useEffect, useState } from 'react'
import { coachingApi } from './coachingApi'
import { pacificToday } from './volume'
import { Initials, field, primaryBtn } from './ui.jsx'

// Add client = find an active member, then optionally start them on a
// template. They become a training client with you as their coach (managers
// can pick another coach) and get a Training tab in the member app.
export default function AddClientDialog({ me, onClose, onAdded }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState(null)
  const [noClubs, setNoClubs] = useState(false)
  const [picked, setPicked] = useState(null)
  const [templates, setTemplates] = useState([])
  const [coaches, setCoaches] = useState([])
  const [templateId, setTemplateId] = useState('')
  const [when, setWhen] = useState('now')
  const [date, setDate] = useState('')
  const [coach, setCoach] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setFound(null); return }
    let live = true
    const id = setTimeout(() => {
      coachingApi.searchMembers(term)
        .then(r => { if (live) { setFound(r.members || []); setNoClubs(Boolean(r.no_clubs)) } })
        .catch(err => { if (live) setError(err.message) })
    }, 250)
    return () => { live = false; clearTimeout(id) }
  }, [q])

  useEffect(() => {
    coachingApi.listTemplates({}).then(r => setTemplates(r.programs || [])).catch(() => {})
    if (me.isManager) coachingApi.coaches().then(r => setCoaches(r.coaches || [])).catch(() => {})
  }, [me.isManager])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e) {
    e.preventDefault()
    if (!picked) return
    if (templateId && when === 'later' && !date) { setError('Pick the start date.'); return }
    const alreadyActive = picked.is_client && picked.status === 'active'
    if (alreadyActive && !templateId && !coach && (!takenByOther || me.isManager)) { onAdded(picked, null); return }
    setBusy(true); setError(null)
    try {
      const r = await coachingApi.addClient({
        member_id: picked.member_id,
        club_number: picked.club_number,
        coach_staff_id: coach || undefined,
        template_id: templateId || undefined,
        starts_on: templateId && when === 'later' ? date : undefined,
      })
      onAdded(picked, r)
    } catch (err) {
      setError(err.message); setBusy(false)
    }
  }

  const takenByOther = picked?.is_client && picked.status === 'active' && picked.coach && picked.coach.id !== me.id

  return (
    <div className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center bg-black/50 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-surface rounded-xl border border-border shadow-2xl w-full max-w-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-text-primary">Add a client</h3>
            <p className="text-xs text-text-muted">Find the member. They get a Training tab in the member app and you become their coach.</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary" aria-label="Close">✕</button>
        </div>

        {!picked ? (
          <div className="space-y-3">
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Name or email" className={`${field} w-full text-base`} />
            {noClubs ? (
              <p className="text-sm text-text-muted">You are not assigned to a club yet, so there is nobody to search. Ask a manager to add your club to your staff profile.</p>
            ) : found === null ? (
              <p className="text-xs text-text-muted">Type at least two letters.</p>
            ) : found.length === 0 ? (
              <p className="text-sm text-text-muted">No active members at your clubs match that.</p>
            ) : (
              <ul className="border border-border rounded-lg divide-y divide-border max-h-[50vh] overflow-y-auto">
                {found.map(m => (
                  <li key={`${m.member_id}|${m.club_number}`}>
                    <button type="button" onClick={() => setPicked(m)} className="w-full text-left px-3 py-2.5 hover:bg-bg flex items-center gap-3">
                      <Initials name={m.name} size="sm" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-text-primary truncate">{m.name}</span>
                        <span className="block text-xs text-text-muted truncate">{m.club_name}{m.email ? ` · ${m.email}` : ''}</span>
                      </span>
                      {m.is_client ? (
                        <span className="text-[11px] px-2 py-0.5 rounded bg-bg border border-border text-text-muted shrink-0">
                          {m.status === 'archived' ? 'Archived client' : `Client of ${m.coach?.name || 'a coach'}`}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 border border-border rounded-lg px-3 py-2.5 bg-bg">
              <Initials name={picked.name} size="sm" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-text-primary truncate">{picked.name}</span>
                <span className="block text-xs text-text-muted">{picked.club_name}</span>
              </span>
              <button type="button" onClick={() => setPicked(null)} className="text-xs font-semibold text-wcs-red hover:underline">Change</button>
            </div>
            {takenByOther && !me.isManager ? (
              <p className="text-sm text-amber-600">{picked.name} is already coached by {picked.coach.name}. A manager can reassign them to you.</p>
            ) : null}

            {me.isManager ? (
              <label className="block text-sm">
                <span className="block text-text-muted mb-1">Coach</span>
                <select className={`${field} w-full`} value={coach} onChange={e => setCoach(e.target.value)}>
                  <option value="">{picked.is_client && picked.status === 'active' && picked.coach ? `Keep ${picked.coach.name}` : 'Me'}</option>
                  {coaches.filter(c => c.id !== me.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : null}

            <label className="block text-sm">
              <span className="block text-text-muted mb-1">Start them on a template (optional)</span>
              <select className={`${field} w-full`} value={templateId} onChange={e => setTemplateId(e.target.value)}>
                <option value="">No program yet</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}{t.owner_staff_id ? ' (mine)' : ''}</option>)}
              </select>
            </label>
            {templateId ? (
              <fieldset className="space-y-2 text-sm">
                <legend className="text-text-muted mb-1">Starts</legend>
                <label className="flex items-center gap-2"><input type="radio" checked={when === 'now'} onChange={() => setWhen('now')} /> Now</label>
                <label className="flex items-center gap-2"><input type="radio" checked={when === 'later'} onChange={() => setWhen('later')} /> On a date</label>
                {when === 'later' ? <input type="date" min={pacificToday()} className={`${field} w-full`} value={date} onChange={e => setDate(e.target.value)} /> : null}
              </fieldset>
            ) : null}
          </div>
        )}

        {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-text-muted">Cancel</button>
          <button disabled={!picked || busy || (takenByOther && !me.isManager)} className={primaryBtn}>
            {busy ? 'Adding…' : picked?.is_client && picked.status === 'active' && !takenByOther ? 'Open client' : 'Add client'}
          </button>
        </div>
      </form>
    </div>
  )
}
