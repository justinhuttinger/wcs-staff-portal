const { ipcRenderer } = require('electron')

const tabsContainer = document.getElementById('tabs')
const userArea = document.getElementById('user-area')

let currentTabs = []

ipcRenderer.on('tabs-updated', (event, tabs) => {
  currentTabs = tabs
  renderTabs()
})

// Chrome-style drag reorder state
let dragging = null // { id, el, startX, offsetX, tabWidth, index }

function renderTabs() {
  tabsContainer.innerHTML = ''
  currentTabs.forEach((tab, i) => {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.active ? ' active' : '')
    el.dataset.tabId = tab.id
    el.dataset.index = i
    // Build DOM safely — avoid innerHTML with untrusted data
    const titleSpan = document.createElement('span')
    titleSpan.textContent = tab.title
    el.appendChild(titleSpan)
    if (tab.closable) {
      const closeSpan = document.createElement('span')
      closeSpan.className = 'tab-close'
      closeSpan.dataset.id = tab.id
      closeSpan.textContent = '\u00D7'
      el.appendChild(closeSpan)
    }

    // Chrome-style drag (only for closable tabs)
    if (tab.closable) {
      el.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('tab-close') || e.button !== 0) return
        const rect = el.getBoundingClientRect()
        dragging = {
          id: tab.id,
          el,
          startX: e.clientX,
          offsetX: e.clientX - rect.left,
          tabWidth: rect.width,
          index: i,
          moved: false,
        }
        el.style.zIndex = '100'
        el.style.position = 'relative'
        e.preventDefault()
      })
    }

    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        ipcRenderer.send('close-tab', tab.id)
      } else {
        ipcRenderer.send('switch-tab', tab.id)
      }
    })
    tabsContainer.appendChild(el)
  })
}

document.addEventListener('mousemove', (e) => {
  if (!dragging) return
  const dx = e.clientX - dragging.startX
  if (Math.abs(dx) > 3) dragging.moved = true
  if (!dragging.moved) return

  dragging.el.classList.add('tab-dragging')
  dragging.el.style.transform = `translateX(${dx}px)`

  // Figure out which position the dragged tab should be in
  const tabs = [...tabsContainer.children]
  const dragRect = dragging.el.getBoundingClientRect()
  const dragCenter = dragRect.left + dragRect.width / 2

  tabs.forEach((tab, i) => {
    if (tab === dragging.el) return
    const closable = currentTabs[i]?.closable
    if (!closable) { tab.style.transform = ''; return }

    const rect = tab.getBoundingClientRect()
    const tabCenter = rect.left + rect.width / 2

    // If dragged tab center passes another tab's center, shift that tab
    if (dragging.index < i && dragCenter > tabCenter) {
      tab.style.transform = `translateX(-${dragging.tabWidth + 2}px)`
    } else if (dragging.index > i && dragCenter < tabCenter) {
      tab.style.transform = `translateX(${dragging.tabWidth + 2}px)`
    } else {
      tab.style.transform = ''
    }
  })
})

document.addEventListener('mouseup', () => {
  if (!dragging) return

  if (dragging.moved) {
    // Find the new position based on which tabs shifted
    const tabs = [...tabsContainer.children]
    const dragRect = dragging.el.getBoundingClientRect()
    const dragCenter = dragRect.left + dragRect.width / 2
    let newIndex = dragging.index

    tabs.forEach((tab, i) => {
      if (tab === dragging.el || !currentTabs[i]?.closable) return
      const rect = tab.getBoundingClientRect()
      const tabCenter = rect.left + rect.width / 2
      if (dragging.index < i && dragCenter > tabCenter) newIndex = i
      else if (dragging.index > i && dragCenter < tabCenter) newIndex = Math.min(newIndex, i)
    })

    if (newIndex !== dragging.index) {
      const targetId = currentTabs[newIndex].id
      ipcRenderer.send('reorder-tab', dragging.id, targetId)
    }
  }

  // Reset all transforms
  const tabs = [...tabsContainer.children]
  tabs.forEach(tab => {
    tab.classList.remove('tab-dragging')
    tab.style.transform = ''
    tab.style.zIndex = ''
    tab.style.position = ''
  })
  dragging = null
})

ipcRenderer.on('user-updated', (event, user) => {
  if (user.name) {
    userArea.innerHTML = ''
    const nameSpan = document.createElement('span')
    nameSpan.className = 'user-name'
    nameSpan.textContent = user.name
    userArea.appendChild(nameSpan)
    const signOutBtn = document.createElement('button')
    signOutBtn.className = 'sign-out-btn'
    signOutBtn.id = 'btn-signout'
    signOutBtn.textContent = 'Sign Out'
    signOutBtn.addEventListener('click', () => ipcRenderer.send('tabbar-signout'))
    userArea.appendChild(signOutBtn)
  } else {
    userArea.innerHTML = ''
  }
})

ipcRenderer.send('tabs-ready')

// Window controls
document.getElementById('btn-refresh').addEventListener('click', () => ipcRenderer.send('window-refresh'))
document.getElementById('btn-minimize').addEventListener('click', () => ipcRenderer.send('window-minimize'))
document.getElementById('btn-maximize').addEventListener('click', () => ipcRenderer.send('window-maximize'))
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.send('window-close'))

// Toggle maximize/restore icon
const maximizeSvg = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="9" height="9" rx="0.5"/></svg>'
const restoreSvg = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="2.5" y="0.5" width="7" height="7" rx="0.5"/><rect x="0.5" y="2.5" width="7" height="7" rx="0.5"/></svg>'

ipcRenderer.on('maximized-changed', (event, isMaximized) => {
  const btn = document.getElementById('btn-maximize')
  btn.innerHTML = isMaximized ? restoreSvg : maximizeSvg
  btn.title = isMaximized ? 'Restore' : 'Maximize'
})
