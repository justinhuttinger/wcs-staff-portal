// Setup-wizard style picker. Renders a radio list, enables Continue
// once a location is selected, fires the IPC and closes when the
// user clicks Continue. Cancel quits the app (same as closing the
// window).

const ipc = window.locationPickerIPC
const listEl = document.getElementById('list')
const continueBtn = document.getElementById('continue')
const cancelBtn = document.getElementById('cancel')

let selected = null

function selectLocation(name, radio) {
  selected = name
  // Sync radio state across the group (defensive — the browser already
  // does this for radios with the same name, but we're appending DOM
  // nodes one at a time so the grouping is wired up after each render).
  for (const r of listEl.querySelectorAll('input[type=radio]')) {
    r.checked = (r.value === name)
  }
  continueBtn.disabled = false
}

ipc.getLocations().then((locations) => {
  for (const loc of locations) {
    const id = 'loc-' + loc.name.toLowerCase()
    const item = document.createElement('label')
    item.className = 'location-item'
    item.htmlFor = id

    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'location'
    radio.value = loc.name
    radio.id = id
    radio.addEventListener('change', () => selectLocation(loc.name))

    const text = document.createElement('span')
    text.textContent = loc.name

    item.appendChild(radio)
    item.appendChild(text)
    listEl.appendChild(item)
  }
})

continueBtn.addEventListener('click', () => {
  if (!selected) return
  continueBtn.disabled = true
  continueBtn.textContent = 'Saving…'
  ipc.pickLocation(selected)
})

cancelBtn.addEventListener('click', () => {
  window.close()
})

// Continue with Enter, Cancel with Escape.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && selected) continueBtn.click()
  if (e.key === 'Escape') cancelBtn.click()
})
