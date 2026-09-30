import { useState } from 'react'
import { saveAdmin } from '../../../lib/api'
import { Card, Toggle, inputClass, btnPrimary, btnSecondary } from './shared'

const CODE_RE = /^[A-Z0-9]{3}$/
const QUESTIONS_MAX = 5

// Follow-up questions asked after a member picks this reason (migration 218).
// Free-text answers; "Required" means they can't continue without one. New
// questions get their id on the server.
function QuestionsEditor({ reason, busy, onSave }) {
  const saved = reason.questions || []
  const [rows, setRows] = useState(saved.map(q => ({ ...q })))
  const [err, setErr] = useState('')
  const dirty = JSON.stringify(rows.map(({ id, label, required }) => ({ id, label, required: !!required })))
    !== JSON.stringify(saved.map(({ id, label, required }) => ({ id, label, required: !!required })))

  const update = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i, dir) => {
    const next = [...rows]
    const [item] = next.splice(i, 1)
    next.splice(i + dir, 0, item)
    setRows(next)
  }

  async function save() {
    if (rows.some(r => !r.label.trim())) return setErr('Every question needs some text (or remove it)')
    setErr('')
    const e = await onSave(reason, { questions: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), label: r.label.trim(), required: !!r.required })) })
    if (e) setErr(e)
  }

  return (
    <div className="w-full mt-2 ml-8 rounded-lg border border-border bg-bg p-3 space-y-2">
      <p className="text-xs text-text-muted">
        Asked after a member picks <span className="font-semibold text-text-primary">{reason.label}</span>. They type the answer; staff see it on the request in Activity.
      </p>
      {rows.length === 0 && <p className="text-sm text-text-muted">No questions yet.</p>}
      {rows.map((q, i) => (
        <div key={q.id || `new-${i}`} className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <button type="button" aria-label="Move question up" disabled={busy || i === 0} onClick={() => move(i, -1)}
              className="h-7 w-6 rounded border border-border text-xs text-text-muted hover:bg-surface disabled:opacity-30">&#9650;</button>
            <button type="button" aria-label="Move question down" disabled={busy || i === rows.length - 1} onClick={() => move(i, 1)}
              className="h-7 w-6 rounded border border-border text-xs text-text-muted hover:bg-surface disabled:opacity-30">&#9660;</button>
          </div>
          <input value={q.label} maxLength={200} onChange={e => update(i, { label: e.target.value })}
            placeholder="e.g. What monthly price would have worked for you?"
            className={`${inputClass(false)} flex-1 min-w-[220px]`} aria-label={`Question ${i + 1}`} />
          <label className="flex items-center gap-1.5 text-sm text-text-primary">
            <input type="checkbox" checked={!!q.required} onChange={e => update(i, { required: e.target.checked })} />
            Required
          </label>
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={busy}
            className="px-2 py-1 rounded text-sm text-wcs-red hover:bg-surface disabled:opacity-50">Remove</button>
        </div>
      ))}
      {err && <p className="text-xs text-wcs-red">{err}</p>}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={() => setRows([...rows, { label: '', required: false }])}
          disabled={busy || rows.length >= QUESTIONS_MAX} className={btnSecondary}>
          + Add question{rows.length >= QUESTIONS_MAX ? ` (max ${QUESTIONS_MAX})` : ''}
        </button>
        {dirty && <button type="button" onClick={save} disabled={busy} className={btnPrimary}>Save questions</button>}
        {dirty && <button type="button" onClick={() => { setRows(saved.map(q => ({ ...q }))); setErr('') }} className={btnSecondary}>Undo</button>}
      </div>
    </div>
  )
}

function ReasonRow({ reason, index, count, busy, onSave, onMove, onToggle, onDelete }) {
  const [showQuestions, setShowQuestions] = useState(false)
  const questionCount = (reason.questions || []).length
  const [label, setLabel] = useState(reason.label)
  const [code, setCode] = useState(reason.abc_cancel_code)
  const [err, setErr] = useState('')
  const dirty = label !== reason.label || code !== reason.abc_cancel_code

  async function save() {
    if (!label.trim()) return setErr('Label is required')
    if (!CODE_RE.test(code)) return setErr('ABC code must be 3 letters or digits')
    setErr('')
    const e = await onSave(reason, { label: label.trim(), abc_cancel_code: code })
    if (e) setErr(e)
  }

  return (
    <div className="flex flex-wrap items-start gap-2 py-3 border-b border-border last:border-0">
      <div className="flex flex-col gap-1 pt-1">
        <button type="button" aria-label="Move up" disabled={busy || index === 0} onClick={() => onMove(index, -1)}
          className="h-5 w-6 rounded border border-border text-xs text-text-muted hover:bg-bg disabled:opacity-30">&#9650;</button>
        <button type="button" aria-label="Move down" disabled={busy || index === count - 1} onClick={() => onMove(index, 1)}
          className="h-5 w-6 rounded border border-border text-xs text-text-muted hover:bg-bg disabled:opacity-30">&#9660;</button>
      </div>
      <div className="flex-1 min-w-[200px]">
        <input value={label} onChange={e => setLabel(e.target.value)} className={inputClass(err && !label.trim())} aria-label="Reason label" />
        {err && <p className="text-xs text-wcs-red mt-1">{err}</p>}
      </div>
      <div className="w-24">
        <input value={code} maxLength={3} onChange={e => setCode(e.target.value.toUpperCase())}
          className={`${inputClass(err && !CODE_RE.test(code))} font-mono uppercase`} aria-label="ABC cancel code" />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Toggle checked={reason.active} disabled={busy} onChange={v => onToggle(reason, v)} label={`Show "${reason.label}"`} />
        <span className="text-xs text-text-muted w-12">{reason.active ? 'Shown' : 'Hidden'}</span>
      </div>
      <div className="flex items-center gap-2">
        {dirty && <button onClick={save} disabled={busy} className={btnPrimary}>Save</button>}
        {dirty && (
          <button onClick={() => { setLabel(reason.label); setCode(reason.abc_cancel_code); setErr('') }} className={btnSecondary}>
            Undo
          </button>
        )}
        <button onClick={() => onDelete(reason)} disabled={busy}
          className="px-3 py-2 rounded-lg text-sm text-wcs-red hover:bg-bg disabled:opacity-50">
          Delete
        </button>
      </div>
      <div className="w-full pl-8">
        <button type="button" onClick={() => setShowQuestions(v => !v)} aria-expanded={showQuestions}
          className="text-xs font-semibold text-text-muted hover:text-text-primary">
          {showQuestions ? '▾' : '▸'} Follow-up questions ({questionCount})
          {!showQuestions && questionCount > 0 && (
            <span className="font-normal"> · {(reason.questions || []).filter(q => q.required).length} required</span>
          )}
        </button>
      </div>
      {showQuestions && <QuestionsEditor reason={reason} busy={busy} onSave={onSave} />}
    </div>
  )
}

export default function ReasonsTab({ reasons, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newCode, setNewCode] = useState('')

  async function run(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
      await onChange()
      return null
    } catch (e) {
      const m = e.message || 'Something went wrong'
      setError(m)
      return m
    } finally {
      setBusy(false)
    }
  }

  const saveRow = (reason, body) => run(() => saveAdmin.updateReason(reason.id, body))
  const toggle = (reason, active) => run(() => saveAdmin.updateReason(reason.id, { active }))

  function move(index, dir) {
    const order = [...reasons]
    const [item] = order.splice(index, 1)
    order.splice(index + dir, 0, item)
    // Renumber in steps of 10 and only write the rows whose number changed.
    const changes = order
      .map((r, i) => ({ r, sort_order: (i + 1) * 10 }))
      .filter(x => x.r.sort_order !== x.sort_order)
    return run(async () => {
      for (const c of changes) await saveAdmin.updateReason(c.r.id, { sort_order: c.sort_order })
    })
  }

  function remove(reason) {
    if (!window.confirm(`Delete "${reason.label}"? Offers aimed only at this reason will be turned off. Past activity keeps the label.`)) return
    return run(() => saveAdmin.deleteReason(reason.id))
  }

  async function add() {
    const label = newLabel.trim()
    const code = newCode.trim().toUpperCase()
    if (!label) return setError('Enter a label for the new reason')
    if (!CODE_RE.test(code)) return setError('ABC code must be 3 letters or digits, e.g. CMO')
    const e = await run(() => saveAdmin.createReason({ label, abc_cancel_code: code }))
    if (!e) { setNewLabel(''); setNewCode('') }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="font-semibold text-text-primary">Cancel reasons</h3>
        <p className="text-xs text-text-muted mt-1">
          The list members pick from, in this order. Each reason sends its ABC cancel code with the cancellation,
          so the code must exist in ABC for every club. Hidden reasons stay on past activity but members do not see them.
          Use <span className="font-semibold">Follow-up questions</span> under a reason to ask the member more (e.g. for &quot;Too expensive&quot;: what price would have worked); mark a question Required to make them answer it.
        </p>
        {error && <p className="text-sm text-wcs-red mt-3">{error}</p>}
      </Card>

      <Card>
        <div className="hidden sm:flex gap-2 pb-2 border-b border-border text-xs uppercase font-semibold text-text-muted">
          <span className="w-6" />
          <span className="flex-1 min-w-[200px]">Label</span>
          <span className="w-24">ABC code</span>
          <span className="w-[5.5rem]">Shown</span>
          <span className="w-[4.5rem]" />
        </div>
        {reasons.length === 0 && <p className="text-sm text-text-muted py-3">No reasons yet. Add one below.</p>}
        {reasons.map((r, i) => (
          <ReasonRow
            key={`${r.id}:${r.updated_at}`}
            reason={r}
            index={i}
            count={reasons.length}
            busy={busy}
            onSave={saveRow}
            onMove={move}
            onToggle={toggle}
            onDelete={remove}
          />
        ))}
      </Card>

      <Card>
        <p className="text-xs uppercase font-semibold text-text-muted mb-2">Add a reason</p>
        <div className="flex flex-wrap gap-2">
          <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="e.g. My schedule changed"
            className={`${inputClass(false)} flex-1 min-w-[200px]`} />
          <input value={newCode} maxLength={3} onChange={e => setNewCode(e.target.value.toUpperCase())} placeholder="ABC code"
            className={`${inputClass(false)} w-28 font-mono uppercase`} />
          <button onClick={add} disabled={busy} className={btnPrimary}>Add</button>
        </div>
      </Card>
    </div>
  )
}
