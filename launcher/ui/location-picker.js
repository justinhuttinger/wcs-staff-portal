// Renders one button per location, sends the choice to the main process
// via the bridge exposed in location-picker-preload.js, then closes.

const ipc = window.locationPickerIPC
const grid = document.getElementById('grid')

ipc.getLocations().then((locations) => {
  for (const loc of locations) {
    const btn = document.createElement('button')
    btn.className = 'loc-btn'
    btn.textContent = loc.name
    btn.addEventListener('click', () => {
      btn.disabled = true
      btn.textContent = 'Saving…'
      ipc.pickLocation(loc.name)
    })
    grid.appendChild(btn)
  }
})
