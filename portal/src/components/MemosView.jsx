import { useState, useEffect, useCallback, useRef } from 'react'
import { getLiveMemo, getMemosManage, saveMainMemo, saveClubMemo, publishClubMemo, endClubMemo, uploadClubMemoImage, retryClubIpad } from '../lib/api'
import { arrangeMemo, arrangeNotes, descriptionLines, splitLabel, textTier } from '../lib/memoLayout'
import { drawMemoImage, downloadCanvas, canvasToPng, IMAGE_WIDTH, IMAGE_HEIGHT } from '../lib/memoImage'
import { fitMemoForPrint, MEMO_CSS } from '../lib/memoPrint'

// Monthly club memo. Current is what staff read and print; Editor is where Main
// (every club) and each club's own items are written and published. Every month
// always exists in the selector, so there is nothing to create.

const STATE_LABELS = { not_started: 'Not started', draft: 'Draft', scheduled: 'Scheduled', live: 'Live', ended: 'Ended', replaced: 'Replaced' }
const STATE_COLORS = {
  not_started: 'bg-gray-100 text-gray-600 border-gray-200',
  draft: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  live: 'bg-green-50 text-green-700 border-green-200',
  ended: 'bg-gray-100 text-gray-600 border-gray-200',
  replaced: 'bg-gray-100 text-gray-600 border-gray-200',
}

const CARD = 'bg-surface rounded-xl border border-border'
const LABEL = 'block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1'
const INPUT = 'w-full px-3 py-2 text-sm rounded-lg border border-border bg-bg text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-wcs-red'
const BTN = 'px-3 py-1.5 text-sm rounded-lg border border-border text-text-primary hover:bg-bg disabled:opacity-50'
const BTN_RED = 'px-3 py-1.5 text-sm rounded-lg bg-wcs-red text-white font-medium hover:bg-wcs-red-hover disabled:opacity-50'

function pill(active) {
  return `px-3 py-1.5 text-sm rounded-lg border transition ${active ? 'bg-wcs-red text-white border-wcs-red' : 'border-border text-text-primary hover:bg-bg'}`
}

function monthLabel(month) {
  return month ? new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : ''
}

function monthName(month) {
  return month ? new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long' }) : ''
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

// Draws a club's image and sends it to the server, which updates the iPads. A
// problem here must never undo the publish, so callers get a message back.
async function sendIpadImage(edition, club, mainItems, clubItems) {
  try {
    const { canvas } = await drawMemoImage({ month: edition.month, clubName: club.name, mainItems, clubItems })
    await uploadClubMemoImage(edition.id, club.slug, await canvasToPng(canvas))
    return null
  } catch (err) {
    return `${club.name}: ${err.message}`
  }
}

const IPAD_LABELS = { sent: 'iPads updated', restored: 'iPads back to normal', pending: 'iPads updating', waiting: 'iPads waiting', failed: 'iPad update failed', no_normal: 'iPads need a look' }

function StateBadge({ state }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full border ${STATE_COLORS[state] || STATE_COLORS.draft}`}>
      {STATE_LABELS[state] || state}
    </span>
  )
}

const TIERS = {
  large: { title: 'text-3xl', body: 'text-base', space: 'gap-6' },
  medium: { title: 'text-2xl', body: 'text-sm', space: 'gap-5' },
  small: { title: 'text-xl', body: 'text-xs', space: 'gap-4' },
}

function Description({ text, tier }) {
  const lines = descriptionLines(text)
  const line = (value) => {
    const { label, text: rest } = splitLabel(value)
    return label ? <><strong>{label}</strong> {rest}</> : value
  }
  if (lines.length <= 1) return <p className={`${tier.body} leading-snug`}>{line(lines[0] || '')}</p>
  return (
    <ul className={`${tier.body} leading-snug list-disc pl-5 space-y-1`}>
      {lines.map((l, i) => <li key={i}>{line(l)}</li>)}
    </ul>
  )
}

function MemoRow({ row, tier }) {
  const cols = { 1: 'md:grid-cols-1 print:grid-cols-1', 2: 'md:grid-cols-2 print:grid-cols-2', 3: 'md:grid-cols-3 print:grid-cols-3' }[row.items.length]
  const display = `memo-display ${tier.title} leading-none uppercase mb-2`
  const box = row.style === 'feature' ? 'border-[3px] border-black p-5'
    : row.style === 'band' ? 'bg-black text-white p-5' : ''
  return (
    <div className={`memo-row grid grid-cols-1 ${cols} ${tier.space} ${box}`}>
      {row.items.map((item, i) => (
        <div key={i}>
          <h4 className={`${display} ${row.style === 'plain' ? 'border-b-[3px] border-[#ff0000] pb-1' : ''}`}>{item.title}</h4>
          <Description text={item.description} tier={tier} />
        </div>
      ))}
    </div>
  )
}

// The memo itself: white paper, black ink, red accents, on screen and in print.
function MemoPage({ month, clubName, mainItems, clubItems }) {
  const tier = TIERS[textTier([...mainItems, ...clubItems])]
  return (
    <div className="memo-print bg-white text-black rounded-xl p-6 sm:p-10 space-y-6">
      <header className="border-b-4 border-black pb-3">
        <h3 className="memo-display text-4xl sm:text-5xl leading-none uppercase">Memo - {monthLabel(month)}</h3>
      </header>
      {arrangeMemo(mainItems).map((row, i) => <MemoRow key={i} row={row} tier={tier} />)}
      {clubItems.length > 0 && (
        <div className="memo-row border-2 border-black p-5">
          <h4 className={`memo-display ${tier.title} leading-none uppercase border-b-[3px] border-[#ff0000] pb-1 mb-4`}>{clubName ? `${clubName} Notes` : 'Club Notes'}</h4>
          <div className="space-y-5">
            {arrangeNotes(clubItems).map((row, i) => <MemoRow key={i} row={row} tier={tier} />)}
          </div>
        </div>
      )}
    </div>
  )
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

  if (error) return <div className={`${CARD} border-red-300 p-4 text-sm text-red-900`}>{error}</div>
  if (!data) return <div className={`${CARD} p-6 text-sm text-text-muted`}>Loading...</div>

  return (
    <div className="space-y-3">
      {(data.clubs.length > 1 || data.memo) && (
        <div className={`${CARD} no-print px-3 py-2.5 flex flex-wrap items-center gap-1.5`}>
          {data.clubs.length > 1 && data.clubs.map(c => (
            <button key={c.slug} type="button" onClick={() => setClub(c.slug)} className={pill(c.slug === data.club?.slug)}>{c.name}</button>
          ))}
          {data.memo && <button type="button" onClick={() => { fitMemoForPrint(); window.print() }} className={`${BTN} ml-auto`}>Print</button>}
        </div>
      )}
      {data.memo ? (
        <MemoPage month={data.memo.month} clubName={data.club?.name} mainItems={data.memo.main_items} clubItems={data.memo.club_items} />
      ) : (
        <div className={`${CARD} p-6 text-sm text-text-muted`}>No memo is showing for {data.club?.name || 'your club'} right now.</div>
      )}
    </div>
  )
}

function ItemsEditor({ items, onChange, emptyHint }) {
  const update = (i, field, value) => onChange(items.map((item, n) => (n === i ? { ...item, [field]: value } : item)))
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-text-muted">{emptyHint}</p>}
      {items.map((item, i) => (
        <div key={i} className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input value={item.title} onChange={e => update(i, 'title', e.target.value)} maxLength={120} placeholder="Title" className={`${INPUT} font-semibold`} />
            <button type="button" onClick={() => onChange(items.filter((_, n) => n !== i))} className="text-text-muted hover:text-text-primary text-xl leading-none px-2" aria-label={`Remove ${item.title || 'item'}`}>&times;</button>
          </div>
          <textarea value={item.description} onChange={e => update(i, 'description', e.target.value)} rows={3} maxLength={2000} placeholder="Description. Put each point on its own line for bullets." className={INPUT} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, { title: '', description: '' }])} className={BTN}>+ Add Item</button>
    </div>
  )
}

function MainEditor({ edition, canEdit, clubs, onChanged }) {
  const [items, setItems] = useState(edition.items || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const open = edition.status === 'ready'

  const save = async (extra, message) => {
    setBusy(true)
    setError('')
    setSaved('')
    try {
      await saveMainMemo(edition.month, { items, ...extra })
      // Main is on every published club's image, so they all need redrawing.
      const problems = []
      if (edition.id && edition.status === 'ready' && extra.ready !== false) {
        for (const c of clubs) {
          const row = edition.club_memos[c.slug]
          if (row?.status !== 'published') continue
          const problem = await sendIpadImage(edition, c, items, row.items || [])
          if (problem) problems.push(problem)
        }
      }
      setSaved(message)
      if (problems.length) setError(`Saved, but some iPad images didn't update. ${problems.join(' ')}`)
      await onChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className={`${CARD} p-5`}>
        <h3 className="text-sm font-bold text-text-primary">Main: {monthLabel(edition.month)}</h3>
        <p className="text-sm text-tile-sub mt-1 mb-4">Goes to every club. Each club then adds its own items and publishes.</p>
        {canEdit ? (
          <>
            <ItemsEditor items={items} onChange={setItems} emptyHint="Nothing written for this month yet." />
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-4">
              <button type="button" disabled={busy} onClick={() => save({}, 'Saved')} className={BTN}>Save</button>
              {open
                ? <button type="button" disabled={busy} onClick={() => save({ ready: false }, 'Taken back from clubs')} className={BTN}>Take Back from Clubs</button>
                : <button type="button" disabled={busy} onClick={() => save({ ready: true }, 'Published to clubs')} className={BTN_RED}>Publish to Clubs</button>}
              <span className="text-xs text-text-muted">{open ? 'Published to clubs. Edits show on live memos right away.' : 'Clubs can\'t see this month yet.'}</span>
              {saved && <span className="text-xs text-green-600">{saved}</span>}
            </div>
          </>
        ) : (
          open
            ? <MemoItemsList items={items} />
            : <p className="text-sm text-text-muted">The main memo for {monthName(edition.month)} isn't published yet.</p>
        )}
      </div>
      {clubs.length > 1 && (
        <div className={`${CARD} p-5`}>
          <h3 className="text-sm font-bold text-text-primary mb-3">Club Status</h3>
          <div className="divide-y divide-border">
            {clubs.map(c => {
              const row = edition.club_memos[c.slug] || {}
              return (
                <div key={c.slug} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-sm text-text-primary">{c.name}</span>
                  <span className="flex items-center gap-2 text-xs text-text-muted">
                    {row.starts_at && <span>{dateLabel(row.starts_at)}{row.ends_at ? ` to ${dateLabel(row.ends_at)}` : ''}</span>}
                    <StateBadge state={row.state || 'not_started'} />
                    {c.ipad && (
                      <span className={c.ipad.status === 'failed' || c.ipad.status === 'no_normal' ? 'text-red-600' : ''} title={c.ipad.error || (c.ipad.sent_at ? `Last sent ${dateLabel(c.ipad.sent_at)}` : '')}>
                        {IPAD_LABELS[c.ipad.status] || 'iPads not sent yet'}
                      </span>
                    )}
                    {canEdit && c.ipad?.status === 'failed' && (
                      <button type="button" onClick={() => retryClubIpad(c.slug).then(onChanged).catch(err => setError(err.message))} className={BTN}>Retry</button>
                    )}
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

function MemoItemsList({ items }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i}>
          <p className="text-sm font-semibold text-text-primary">{item.title}</p>
          <p className="text-sm text-text-muted whitespace-pre-wrap">{item.description}</p>
        </div>
      ))}
    </div>
  )
}

// A live preview of the lock screen image, redrawn as items change.
function IpadImage({ edition, club, items }) {
  const holder = useRef(null)
  const [small, setSmall] = useState(false)
  const canvasRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      const { canvas, small: tiny } = await drawMemoImage({
        month: edition.month,
        clubName: club.name,
        mainItems: edition.items || [],
        clubItems: items.filter(i => i.title || i.description),
      })
      if (cancelled || !holder.current) return
      canvasRef.current = canvas
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      canvas.style.display = 'block'
      holder.current.replaceChildren(canvas)
      setSmall(tiny)
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [edition.month, edition.items, club.name, items])

  const download = () => {
    if (canvasRef.current) downloadCanvas(canvasRef.current, `memo-${edition.month.slice(0, 7)}-${club.slug}.png`)
  }

  return (
    <div className={`${CARD} p-5`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-text-primary">iPad Lock Screen</h3>
          <p className="text-xs text-text-muted">{IMAGE_WIDTH} x {IMAGE_HEIGHT}, portrait. Everything is fitted automatically. Members can see this, so keep confidential items out.</p>
        </div>
        <button type="button" onClick={download} className={BTN}>Download Image</button>
      </div>
      {small && <p className="text-sm text-amber-700 mb-3">It all fits, but the text is getting small. Shorter descriptions will make it easier to read.</p>}
      <div ref={holder} className="max-w-xs rounded-lg overflow-hidden border border-border" />
    </div>
  )
}

function ClubEditor({ edition, club, onChanged }) {
  const memo = edition.club_memos[club.slug] || { state: 'not_started' }
  const published = memo.status === 'published'
  const [items, setItems] = useState(memo.items || [])
  const [startMode, setStartMode] = useState(memo.starts_at ? 'date' : 'now')
  const [startsAt, setStartsAt] = useState(toLocalInput(memo.starts_at))
  const [endMode, setEndMode] = useState(memo.ends_at ? 'date' : 'next')
  const [endsAt, setEndsAt] = useState(toLocalInput(memo.ends_at))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

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

  const clean = () => items.filter(i => i.title || i.description)
  const save = () => run(async () => {
    await saveClubMemo(edition.id, club.slug, { items })
    if (published) {
      const problem = await sendIpadImage(edition, club, edition.items || [], clean())
      if (problem) setError(`Saved, but the iPad image didn't update. ${problem}`)
    }
  }, 'Saved')
  const publish = () => run(async () => {
    await publishClubMemo(edition.id, club.slug, {
      items,
      starts_at: startMode === 'date' ? fromLocalInput(startsAt) : null,
      ends_at: endMode === 'date' ? fromLocalInput(endsAt) : null,
    })
    const problem = await sendIpadImage(edition, club, edition.items || [], clean())
    if (problem) setError(`Published, but the iPad image didn't update. ${problem}`)
  }, published ? 'Updated' : 'Published')
  const end = () => {
    if (window.confirm(`Take down ${club.name}'s ${monthLabel(edition.month)} memo now?`)) {
      run(() => endClubMemo(edition.id, club.slug), 'Taken down')
    }
  }

  if (edition.status !== 'ready') {
    return <div className={`${CARD} p-6 text-sm text-text-muted`}>The main memo for {monthName(edition.month)} needs to be published to clubs first.</div>
  }

  return (
    <>
      <div className={`${CARD} p-5`}>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-bold text-text-primary">{club.name}: {monthLabel(edition.month)}</h3>
          <StateBadge state={memo.state} />
        </div>
        <p className="text-sm text-tile-sub mb-4">Only {club.name} sees these, along with the main memo.</p>
        <ItemsEditor items={items} onChange={setItems} emptyHint="No club items yet. You can publish with just the main memo." />

        <div className="grid sm:grid-cols-2 gap-4 mt-5">
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

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" disabled={busy} onClick={save} className={BTN}>Save</button>
          <button type="button" disabled={busy} onClick={publish} className={BTN_RED}>
            {published ? 'Save and Update' : startMode === 'now' ? 'Publish and Show Now' : 'Publish on This Date'}
          </button>
          {published && memo.state !== 'ended' && <button type="button" disabled={busy} onClick={end} className={BTN}>End Now</button>}
          {saved && <span className="text-xs text-green-600">{saved}</span>}
        </div>
      </div>
      <IpadImage edition={edition} club={club} items={items} />
    </>
  )
}

function Editor() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [month, setMonth] = useState('')
  const [scope, setScope] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await getMemosManage())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (error && !data) return <div className={`${CARD} border-red-300 p-4 text-sm text-red-900`}>{error}</div>
  if (!data) return <div className={`${CARD} p-6 text-sm text-text-muted`}>Loading...</div>

  // Months are newest first, so the older month is the next index.
  const months = data.editions.map(e => e.month)
  const selected = months.includes(month) ? month : data.current_month
  const index = months.indexOf(selected)
  const edition = data.editions[index]
  const editable = data.clubs.filter(c => c.editable)
  const activeScope = scope === 'main' || editable.some(c => c.slug === scope)
    ? scope
    : data.can.company ? 'main' : editable[0]?.slug || 'main'
  const club = editable.find(c => c.slug === activeScope)

  return (
    <div className="space-y-3">
      <div className={`${CARD} px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2`}>
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={index >= months.length - 1} onClick={() => setMonth(months[index + 1])} className={BTN} aria-label="Previous month">&larr;</button>
          <select value={selected} onChange={e => setMonth(e.target.value)} className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-border bg-bg text-text-primary">
            {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <button type="button" disabled={index <= 0} onClick={() => setMonth(months[index - 1])} className={BTN} aria-label="Next month">&rarr;</button>
        </div>
        <span className="text-border" aria-hidden="true">|</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setScope('main')} className={pill(activeScope === 'main')}>Main</button>
          {editable.map(c => (
            <button key={c.slug} type="button" onClick={() => setScope(c.slug)} className={pill(activeScope === c.slug)}>{c.name}</button>
          ))}
        </div>
      </div>
      {error && <div className={`${CARD} border-red-300 p-4 text-sm text-red-900`}>{error}</div>}
      {club
        ? <ClubEditor key={`${selected}:${club.slug}`} edition={edition} club={club} onChanged={load} />
        : <MainEditor key={selected} edition={edition} canEdit={data.can.company} clubs={data.clubs} onChanged={load} />}
    </div>
  )
}

export default function MemosView({ user, onBack }) {
  const visibleTools = user?.visible_tools || []
  const role = user?.staff?.role
  const canEdit = visibleTools.includes('memos:company-edit') || ['manager', 'marketing', 'corporate', 'director', 'admin'].includes(role)
  const [tab, setTab] = useState('current')

  // Ctrl+P skips the Print button, so fit the page here as well.
  useEffect(() => {
    window.addEventListener('beforeprint', fitMemoForPrint)
    return () => window.removeEventListener('beforeprint', fitMemoForPrint)
  }, [])

  return (
    <div className="w-full max-w-5xl mx-auto px-8 pb-12">
      <style>{MEMO_CSS}</style>
      <div className="no-print bg-surface/95 backdrop-blur-sm rounded-xl border border-border px-4 py-2.5 mb-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="redundant-back text-sm text-tile-sub hover:text-text-primary shrink-0">&larr; Back</button>
        <h2 className="text-sm font-bold text-text-primary">Memos</h2>
        {canEdit && (
          <div className="ml-auto flex gap-1.5">
            <button type="button" onClick={() => setTab('current')} className={pill(tab === 'current')}>Current</button>
            <button type="button" onClick={() => setTab('editor')} className={pill(tab === 'editor')}>Editor</button>
          </div>
        )}
      </div>
      {tab === 'editor' && canEdit ? <Editor /> : <CurrentMemo />}
    </div>
  )
}
