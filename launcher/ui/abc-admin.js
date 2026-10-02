// WCS ABC Admin window: this PC's club, ABC URL, alert volume and call button pager (see abc-admin-preload.js).
const clubEl = document.getElementById('club')
const urlEl = document.getElementById('url')
const errEl = document.getElementById('error')
const saveBtn = document.getElementById('save')
const volEl = document.getElementById('vol')
const volOut = document.getElementById('volOut')
const showVol = () => { volOut.textContent = volEl.value + '%' }
volEl.addEventListener('input', showVol)
document.getElementById('test').addEventListener('click', () => window.abcAdminIPC.testSound(Number(volEl.value)))

let locations = []

// ---- Call button pager ----
const pagerOn = document.getElementById('pagerOn')
const pagerBase = document.getElementById('pagerBase')
const pagerPw = document.getElementById('pagerPw')
const pagerHs = document.getElementById('pagerHs')
const pagerCool = document.getElementById('pagerCool')
const pagerStatus = document.getElementById('pagerStatus')

function showPager(text, bad) {
  pagerStatus.textContent = text
  pagerStatus.classList.toggle('bad', !!bad)
}
const pickedHandsets = () => [...pagerHs.querySelectorAll('input:checked')].map(i => Number(i.value))
const pagerInput = () => ({
  enabled: pagerOn.checked, base_url: pagerBase.value.trim(), password: pagerPw.value,
  handsets: pickedHandsets(), cooldown_seconds: Number(pagerCool.value),
  zigbee_port: rxPort.value || 'auto',
})

// ---- Call button receiver + paired buttons ----
const rxPort = document.getElementById('rxPort')
const rxStatus = document.getElementById('rxStatus')
const pairBtn = document.getElementById('pairBtn')
const pairStatus = document.getElementById('pairStatus')
const buttonsEl = document.getElementById('buttons')
let savedPort = 'auto'
let portKey = ''
let buttonKey = ''

const RECEIVER_TEXT = {
  off: 'Off. Tick the box above and save to start it.',
  starting: 'Starting...',
  ready: 'Connected',
  dongle_missing: 'Not found. Plug in the receiver. If it is plugged in, Windows may be missing the CP210x driver.',
  error: 'Problem',
}

function ago(ms) {
  if (!ms) return 'never seen'
  const min = Math.round((Date.now() - ms) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return min + ' min ago'
  const h = Math.round(min / 60)
  return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'
}

function drawPorts(ports) {
  const key = ports.map(p => p.path).join(',')
  if (key === portKey) return
  portKey = key
  const picked = rxPort.value || savedPort
  rxPort.textContent = ''
  const add = (value, text) => {
    const o = document.createElement('option')
    o.value = value
    o.textContent = text
    rxPort.appendChild(o)
  }
  add('auto', 'Auto (find the receiver)')
  for (const p of ports) add(p.path, p.path + (p.dongle ? ' (receiver)' : '') + (p.label && p.label !== p.path ? ' ' + p.label : ''))
  if (picked !== 'auto' && !ports.some(p => p.path === picked)) add(picked, picked + ' (not connected)')
  rxPort.value = picked
}

// Rebuilt only when the list changes, so typing a name isn't interrupted.
function drawButtons(devices) {
  const key = JSON.stringify(devices.map(d => [d.ieee, d.battery, d.linkquality, Math.round((d.lastSeen || 0) / 60000)]))
  if (key === buttonKey) return
  if (buttonsEl.contains(document.activeElement)) return
  buttonKey = key
  buttonsEl.textContent = ''
  if (!devices.length) {
    const none = document.createElement('div')
    none.className = 'hint'
    none.textContent = 'No buttons paired yet.'
    buttonsEl.appendChild(none)
    return
  }
  for (const d of devices) {
    const row = document.createElement('div')
    row.className = 'button-row'
    const name = document.createElement('input')
    name.type = 'text'
    name.placeholder = 'Name (e.g. Front desk)'
    name.value = d.name
    name.maxLength = 40
    name.addEventListener('change', () => window.abcAdminIPC.buttonRename(d.ieee, name.value))
    const meta = document.createElement('span')
    const offline = !d.lastSeen || Date.now() - d.lastSeen > 3 * 3600 * 1000
    const lowBattery = d.battery != null && d.battery < 20
    const weak = d.linkquality != null && d.linkquality < 20
    meta.className = 'meta' + (offline || lowBattery ? ' bad' : '')
    meta.textContent = [
      d.battery == null ? 'battery ?' : 'battery ' + d.battery + '%',
      d.linkquality == null ? null : 'signal ' + d.linkquality + (weak ? ' (weak, move the receiver closer)' : ''),
      ago(d.lastSeen),
    ].filter(Boolean).join(' · ')
    meta.title = d.model + ' ' + d.ieee
    const remove = document.createElement('button')
    remove.className = 'btn btn-secondary'
    remove.type = 'button'
    remove.textContent = 'Remove'
    remove.addEventListener('click', async () => {
      if (remove.dataset.sure !== '1') { remove.dataset.sure = '1'; remove.textContent = 'Sure?'; return }
      await window.abcAdminIPC.buttonRemove(d.ieee)
      buttonKey = ''
    })
    row.append(name, meta, remove)
    buttonsEl.appendChild(row)
  }
}

async function refreshReceiver() {
  const st = await window.abcAdminIPC.buttonState()
  drawPorts(st.ports || [])
  rxStatus.textContent = (RECEIVER_TEXT[st.receiver] || st.receiver) +
    (st.receiver === 'ready' && st.port ? ' on ' + st.port : '') + (st.error ? ': ' + st.error : '')
  rxStatus.classList.toggle('bad', st.receiver === 'dongle_missing' || st.receiver === 'error')
  const left = Math.max(0, Math.round((st.pairingUntil - Date.now()) / 1000))
  pairBtn.disabled = st.receiver !== 'ready'
  pairBtn.textContent = left ? 'Stop pairing (' + left + 's)' : 'Pair a button'
  pairBtn.dataset.on = left ? '1' : ''
  pairStatus.textContent = left
    ? 'Hold the button about 5 seconds until its blue light blinks, then tap it about once a second.\n' + (st.pairingMessage || '')
    : (st.pairingMessage || '')
  drawButtons(st.devices || [])
}

pairBtn.addEventListener('click', async () => {
  await window.abcAdminIPC.buttonPair(pairBtn.dataset.on !== '1')
  refreshReceiver()
})
rxPort.addEventListener('focus', () => window.abcAdminIPC.buttonPorts())
// Turning the pager on/off or changing the port applies straight away, so the
// receiver can be started and a button paired without closing this window.
async function applyReceiver() {
  const saved = await window.abcAdminIPC.pagerSave(pagerInput())
  if (!saved || !saved.success) return showPager((saved && saved.error) || 'Could not save', true)
  pagerPw.value = ''
  savedPort = rxPort.value
  showPager('')
}
pagerOn.addEventListener('change', applyReceiver)
rxPort.addEventListener('change', applyReceiver)
setInterval(() => refreshReceiver().catch(() => {}), 1000)

async function loadPager() {
  const { settings, hasPassword } = await window.abcAdminIPC.pagerGet()
  pagerOn.checked = settings.enabled
  pagerBase.value = settings.base_url
  pagerPw.placeholder = hasPassword ? 'Saved (type to change)' : ''
  pagerCool.value = String(settings.cooldown_seconds)
  savedPort = settings.zigbee_port
  refreshReceiver().catch(() => {})
  for (let n = 1; n <= 5; n++) {
    const label = document.createElement('label')
    label.className = 'check'
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.value = String(n)
    box.checked = settings.handsets.includes(n)
    label.append(box, 'HS' + n)
    pagerHs.appendChild(label)
  }
}

// Check / Test use what is on screen, so save it first.
async function pagerAction(run) {
  showPager('Working...')
  const saved = await window.abcAdminIPC.pagerSave(pagerInput())
  if (!saved || !saved.success) return showPager((saved && saved.error) || 'Could not save', true)
  pagerPw.value = ''
  await run()
}

document.getElementById('pagerCheck').addEventListener('click', () => pagerAction(async () => {
  const res = await window.abcAdminIPC.pagerStatus()
  if (!res.success) return showPager(res.error, true)
  showPager(res.handsets.map(h =>
    h.name + ': ' + (h.inRange ? 'in range' : 'OUT OF RANGE') + (h.charging ? ', charging' : '')).join('\n') || 'No handsets registered')
}))

document.getElementById('pagerTest').addEventListener('click', () => pagerAction(async () => {
  const res = await window.abcAdminIPC.pagerTest(pickedHandsets())
  if (!res.success) return showPager(res.error, true)
  const failed = res.event.results.filter(r => !r.ok)
  showPager(res.event.results.map(r => 'HS' + r.handset + ': ' + (r.ok ? 'paged' : r.error)).join('\n'), failed.length > 0)
}))

async function load() {
  const { config, locations: locs, alertVolume } = await window.abcAdminIPC.get()
  volEl.value = String(alertVolume)
  showVol()
  locations = locs || []
  for (const l of locations) {
    const opt = document.createElement('option')
    opt.value = l.name
    opt.textContent = l.name
    clubEl.appendChild(opt)
  }
  const current = locations.find(l => l.name.toLowerCase() === String(config.location || '').toLowerCase())
  clubEl.value = current ? current.name : (locations[0] && locations[0].name) || ''
  urlEl.value = config.abc_url || (current && current.abc_url) || ''
}

// A new club gets that club's default workstation URL.
clubEl.addEventListener('change', () => {
  const loc = locations.find(l => l.name === clubEl.value)
  if (loc && loc.abc_url) urlEl.value = loc.abc_url
  errEl.textContent = ''
})

document.getElementById('cancel').addEventListener('click', () => window.close())

saveBtn.addEventListener('click', async () => {
  errEl.textContent = ''
  saveBtn.disabled = true
  const paging = await window.abcAdminIPC.pagerSave(pagerInput())
  if (!paging || !paging.success) {
    saveBtn.disabled = false
    errEl.textContent = (paging && paging.error) || 'Could not save call button settings'
    return
  }
  const res = await window.abcAdminIPC.save({
    location: clubEl.value, abc_url: urlEl.value.trim(), alert_volume: Number(volEl.value),
  })
  saveBtn.disabled = false
  if (res && res.success) window.close()
  else errEl.textContent = (res && res.error) || 'Could not save'
})

loadPager().catch(err => showPager('Could not load call button settings: ' + err.message, true))
load().catch(err => { errEl.textContent = 'Could not load settings: ' + err.message })
