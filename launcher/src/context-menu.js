const { Menu, MenuItem, clipboard, shell } = require('electron')

// Wire up a Chrome-like right-click menu on a webContents.
// Electron ships no context menu by default — without this, staff can't
// right-click to copy/paste credentials, URLs, or selected text inside
// any of the launcher's BrowserView tabs.
function attachContextMenu(webContents) {
  webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()
    const { editFlags, isEditable, selectionText, linkURL, srcURL, mediaType } = params
    const hasSelection = selectionText && selectionText.trim().length > 0

    if (linkURL) {
      menu.append(new MenuItem({ label: 'Open Link in Browser', click: () => shell.openExternal(linkURL) }))
      menu.append(new MenuItem({ label: 'Copy Link Address', click: () => clipboard.writeText(linkURL) }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    if (mediaType === 'image' && srcURL) {
      menu.append(new MenuItem({ label: 'Copy Image Address', click: () => clipboard.writeText(srcURL) }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    if (isEditable) {
      menu.append(new MenuItem({ role: 'undo', enabled: editFlags.canUndo }))
      menu.append(new MenuItem({ role: 'redo', enabled: editFlags.canRedo }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ role: 'cut', enabled: editFlags.canCut }))
      menu.append(new MenuItem({ role: 'copy', enabled: editFlags.canCopy }))
      menu.append(new MenuItem({ role: 'paste', enabled: editFlags.canPaste }))
      menu.append(new MenuItem({ role: 'selectAll', enabled: editFlags.canSelectAll }))
    } else if (hasSelection) {
      menu.append(new MenuItem({ role: 'copy', enabled: editFlags.canCopy }))
      menu.append(new MenuItem({ role: 'selectAll', enabled: editFlags.canSelectAll }))
    }

    // No Inspect Element / DevTools entry — launchers run on unattended gym
    // kiosks, so the menu only exposes clipboard + link actions.
    if (menu.items.length > 0) menu.popup()
  })
}

module.exports = { attachContextMenu }
