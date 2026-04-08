const { ipcRenderer } = require('electron')

const tabsContainer = document.getElementById('tabs')
const userArea = document.getElementById('user-area')

ipcRenderer.on('tabs-updated', (event, tabs) => {
  tabsContainer.innerHTML = ''
  tabs.forEach(tab => {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.active ? ' active' : '')
    el.innerHTML = `<span>${tab.title}</span>` +
      (tab.closable ? `<span class="tab-close" data-id="${tab.id}">&times;</span>` : '')
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) {
        ipcRenderer.send('close-tab', tab.id)
      } else {
        ipcRenderer.send('switch-tab', tab.id)
      }
    })
    tabsContainer.appendChild(el)
  })
})

ipcRenderer.on('user-updated', (event, user) => {
  if (user.name) {
    userArea.innerHTML = `
      <span class="user-name">${user.name}</span>
      <button class="sign-out-btn" id="btn-signout">Sign Out</button>
    `
    document.getElementById('btn-signout').addEventListener('click', () => {
      ipcRenderer.send('tabbar-signout')
    })
  } else {
    userArea.innerHTML = ''
  }
})

ipcRenderer.send('tabs-ready')

// Window controls
document.getElementById('btn-minimize').addEventListener('click', () => ipcRenderer.send('window-minimize'))
document.getElementById('btn-maximize').addEventListener('click', () => ipcRenderer.send('window-maximize'))
document.getElementById('btn-close').addEventListener('click', () => ipcRenderer.send('window-close'))
