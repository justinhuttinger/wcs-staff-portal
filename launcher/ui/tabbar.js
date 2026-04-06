const { ipcRenderer } = require('electron')

const tabsContainer = document.getElementById('tabs')

ipcRenderer.on('tabs-updated', (event, tabs) => {
  tabsContainer.innerHTML = ''
  tabs.forEach(tab => {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.active ? ' active' : '')
    el.innerHTML = `<span>${tab.title}</span>` +
      (tab.closable ? `<span class="tab-close" data-id="${tab.id}">×</span>` : '')
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

ipcRenderer.send('tabs-ready')
