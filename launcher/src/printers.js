// Enumerate installed printers via the hidden/main window's webContents.
async function listPrinters(win) {
  try {
    if (!win || win.isDestroyed()) return []
    const printers = await win.webContents.getPrintersAsync()
    return (printers || []).map(p => ({ name: p.name, isDefault: !!p.isDefault }))
  } catch (e) {
    return []
  }
}
module.exports = { listPrinters }
