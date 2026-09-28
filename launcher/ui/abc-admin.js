// WCS ABC Admin window: change this PC's club + ABC URL (see abc-admin-preload.js).
const clubEl = document.getElementById('club')
const urlEl = document.getElementById('url')
const errEl = document.getElementById('error')
const saveBtn = document.getElementById('save')

let locations = []

async function load() {
  const { config, locations: locs } = await window.abcAdminIPC.get()
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
  const res = await window.abcAdminIPC.save({ location: clubEl.value, abc_url: urlEl.value.trim() })
  saveBtn.disabled = false
  if (res && res.success) window.close()
  else errEl.textContent = (res && res.error) || 'Could not save'
})

load().catch(err => { errEl.textContent = 'Could not load settings: ' + err.message })
