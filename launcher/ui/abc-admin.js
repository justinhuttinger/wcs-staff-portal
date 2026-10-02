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
})

async function loadPager() {
  const { settings, hasPassword } = await window.abcAdminIPC.pagerGet()
  pagerOn.checked = settings.enabled
  pagerBase.value = settings.base_url
  pagerPw.placeholder = hasPassword ? 'Saved (type to change)' : ''
  pagerCool.value = String(settings.cooldown_seconds)
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
