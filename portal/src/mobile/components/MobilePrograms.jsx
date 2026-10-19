import { useCallback, useEffect, useState } from 'react'
import MobileHeader from './MobileHeader'
import ProgramPreview from '../../components/coaching/ProgramPreview.jsx'
import { coachingApi } from '../../components/coaching/coachingApi'
import { pacificToday, programStatus } from '../../components/coaching/volume'

// A client's programs on a phone: read-only. Building and editing happen in
// the desktop builder (Admin -> Member App), which needs a keyboard and room;
// on the floor a coach just needs to see what the client is on.
const STATUS_LABEL = { current: 'Current', scheduled: 'Scheduled', ended: 'Ended', archived: 'Archived' }

export default function MobilePrograms({ member, onBack }) {
  const [programs, setPrograms] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const r = await coachingApi.listClientPrograms(member)
      setPrograms(r.programs || [])
    } catch (err) {
      setError(err.message)
    }
  }, [member])
  useEffect(() => { load() }, [load])

  if (openId) {
    return (
      <div className="pt-4 px-4 pb-8">
        <ProgramPreview programId={openId} onBack={() => setOpenId(null)} backLabel="Programs" />
      </div>
    )
  }

  const today = pacificToday()
  return (
    <div className="pt-4 px-4 pb-8 space-y-3">
      <MobileHeader title="Programs" subtitle={member.name || member.first_name} onBack={onBack} />
      {error ? <p className="text-sm text-wcs-red">{error}</p> : null}
      {programs === null ? <p className="text-sm text-text-muted">Loading…</p> : null}
      {programs && programs.length === 0 ? (
        <div className="border border-border rounded-xl bg-surface p-4 text-sm text-text-muted">
          No programs yet. Assign one from the desktop portal: Admin, Member App.
        </div>
      ) : null}
      {(programs || []).map(p => {
        const status = programStatus(p, today)
        return (
          <button key={p.id} onClick={() => setOpenId(p.id)} className="w-full text-left border border-border rounded-xl px-4 py-3 bg-surface">
            <span className="block font-semibold">{p.name}</span>
            <span className="block text-xs text-text-muted">
              {STATUS_LABEL[status]}{status === 'scheduled' ? ` from ${p.starts_on}` : ''} · {p.day_count} day{p.day_count === 1 ? '' : 's'}
            </span>
          </button>
        )
      })}
    </div>
  )
}
