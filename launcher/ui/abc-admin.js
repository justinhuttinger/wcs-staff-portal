// WCS ABC Admin window: this PC's club, ABC URL and alert volume (see abc-admin-preload.js).
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
  const res = await window.abcAdminIPC.save({
    location: clubEl.value, abc_url: urlEl.value.trim(), alert_volume: Number(volEl.value),
  })
  saveBtn.disabled = false
  if (res && res.success) window.close()
  else errEl.textContent = (res && res.error) || 'Could not save'
})

load().catch(err => { errEl.textContent = 'Could not load settings: ' + err.message })
