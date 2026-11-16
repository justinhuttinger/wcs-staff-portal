// The owner's top bar shows Hub where Tickets used to be (the Hub carries the
// open-ticket count now). Pure so it can be tested; App applies it once.

export const HUB_PIN_SWAP_KEY = 'wcs-hub-pin-swap-done'
const MAX = 5

export function swapTicketsForHub(pins) {
  const list = Array.isArray(pins) ? [...pins] : []
  const t = list.indexOf('tool:ticketing')
  if (list.includes('tool:hub')) return t === -1 ? list : list.filter(k => k !== 'tool:ticketing')
  if (t !== -1) { list[t] = 'tool:hub'; return list }
  return list.length < MAX ? [...list, 'tool:hub'] : list
}
