// Club Calendar window: this PC's club's tours + Day Ones, a week at a time.
const DAYS = 7
const list = document.getElementById('list')
const titleEl = document.getElementById('title')
const rangeEl = document.getElementById('range')

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
let start = today()

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

async function load() {
  list.replaceChildren(el('div', 'msg', 'Loading…'))
  const res = await window.clubCalendarIPC.get({ start: ymd(start), days: DAYS })
  if (!res || res.error) {
    list.replaceChildren(el('div', 'msg error', (res && res.error) || 'Could not load the calendar'))
    return
  }
  titleEl.firstChild.textContent = `${res.club} Calendar`
  const end = new Date(start); end.setDate(end.getDate() + DAYS - 1)
  const fmt = { month: 'short', day: 'numeric' }
  rangeEl.textContent = `${start.toLocaleDateString([], fmt)} – ${end.toLocaleDateString([], fmt)}`

  // Group by local day, every day of the week shown even when empty.
  const byDay = new Map()
  for (let i = 0; i < DAYS; i++) { const d = new Date(start); d.setDate(d.getDate() + i); byDay.set(ymd(d), []) }
  for (const e of res.entries || []) {
    const k = ymd(new Date(e.start))
    if (byDay.has(k)) byDay.get(k).push(e)
  }

  const todayKey = ymd(today())
  const out = []
  for (const [k, entries] of byDay) {
    const d = new Date(k + 'T00:00:00')
    const day = el('section', 'day')
    const label = d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })
    day.appendChild(el('h2', k === todayKey ? 'today' : '', k === todayKey ? `Today · ${label}` : label))
    if (!entries.length) day.appendChild(el('div', 'empty', 'Nothing booked'))
    for (const e of entries) {
      const row = el('div', 'entry')
      row.appendChild(el('div', 'time', new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })))
      row.appendChild(el('div', 'type ' + (e.type === 'Tour' ? 'tour' : 'dayone'), e.type))
      const who = el('div', 'name', e.name)
      if (e.status && e.status !== 'confirmed' && e.status !== 'booked') who.appendChild(el('span', 'status', e.status))
      row.appendChild(who)
      row.appendChild(el('div', 'staff', e.staff || ''))
      day.appendChild(row)
    }
    out.push(day)
  }
  list.replaceChildren(...out)
}

const shift = (n) => { start = new Date(start); start.setDate(start.getDate() + n); load() }
document.getElementById('prev').addEventListener('click', () => shift(-DAYS))
document.getElementById('next').addEventListener('click', () => shift(DAYS))
document.getElementById('today').addEventListener('click', () => { start = today(); load() })
document.getElementById('refresh').addEventListener('click', load)
load()
