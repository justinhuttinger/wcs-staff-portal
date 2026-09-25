// Preload for ABC toolbar pop-ups. Asks main for the member data this popup
// was opened with and fills matching empty form fields. Built for the external
// Cancel Tool (memberservices.westcoaststrength.com, an Angular app): barcode,
// home-club dropdown, email. Fields
// are found by formcontrolname / placeholder, and values are set through the
// native setter + input/blur events so Angular's form controls pick them up.
const { ipcRenderer } = require('electron')

const FIELDS = {
  barcode: ['input[formcontrolname="barCode"]', 'input[formcontrolname="barcode"]', 'input[placeholder*="barcode" i]'],
  email:   ['input[formcontrolname="email"]', 'input[type="email"]', 'input[placeholder*="email" i]'],
  phone:   ['input[formcontrolname="phone"]', 'input[type="tel"]', 'input[placeholder*="phone" i]'],
  firstName: ['input[formcontrolname="firstName"]', 'input[placeholder*="first name" i]'],
  lastName:  ['input[formcontrolname="lastName"]', 'input[placeholder*="last name" i]'],
}

function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  el.dispatchEvent(new Event('blur', { bubbles: true }))
}

// Fill each field at most once, only if it is still empty, so staff edits win.
function fill(data, done) {
  for (const [key, selectors] of Object.entries(FIELDS)) {
    if (done.has(key) || !data[key]) continue
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (!el) continue
      if (!el.value) setValue(el, String(data[key]))
      done.add(key)
      break
    }
  }
}

// Home-club dropdown: a custom Angular listbox (button[aria-haspopup=listbox]).
// Open it, click the option whose text contains the club name, done.
const norm = t => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
function selectClub(club, done) {
  if (done.has('club') || !club) return
  const btn = document.querySelector('button[aria-haspopup="listbox"]')
  if (!btn) return
  const want = norm(club)
  if (norm(btn.textContent).includes(want)) { done.add('club'); return }
  if (btn.getAttribute('aria-expanded') !== 'true') { btn.click(); return }   // options render next tick
  const options = document.querySelectorAll('[role="option"], [role="listbox"] li, [role="listbox"] button, .dropdown li, .dropdown button:not([aria-haspopup])')
  for (const opt of options) {
    if (norm(opt.textContent).includes(want)) {
      opt.click()
      done.add('club')
      return
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  let data = null
  try { data = await ipcRenderer.invoke('popup-prefill') } catch (e) {}
  if (!data) return
  const done = new Set()
  const wanted = Object.keys(FIELDS).filter(k => data[k]).concat(data.club ? ['club'] : [])
  // SPA: the form renders after load (and may re-render), so poll briefly.
  let tries = 0
  const timer = setInterval(() => {
    fill(data, done)
    try { selectClub(data.club, done) } catch (e) {}
    if (wanted.every(k => done.has(k))) return clearInterval(timer)
    if (++tries > 60) {
      clearInterval(timer)
      // Couldn't match the club: don't leave the dropdown hanging open.
      const btn = document.querySelector('button[aria-haspopup="listbox"]')
      if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click()
    }
  }, 500)
})
