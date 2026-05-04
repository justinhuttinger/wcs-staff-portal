// Source script that gets injected into GHL widget iframes (booking + survey).
// Mirrors what `extension/widget-fill.js` did when staff used the Chrome
// extension — without it, GHL widget URL prefill does not populate the phone
// field.
//
// Exported as a string so the main process can hand it to
// `frame.executeJavaScript()` whenever a GHL widget frame finishes loading.

const SCRIPT = `
(function() {
  if (window.__wcsWidgetFillInstalled) return
  window.__wcsWidgetFillInstalled = true

  const params = new URLSearchParams(window.location.search)
  const isBooking = window.location.pathname.includes('/widget/booking/')

  // Hide booking-info chrome so the kiosk feels like a single flow
  if (isBooking) {
    const style = document.createElement('style')
    style.textContent = \`
      .appointment_widgets--revamp--service-info,
      .appointment-widgets-service-booking-info {
        display: none !important;
      }
    \`
    document.head.appendChild(style)
  }

  const phone = params.get('phone') || params.get('phone_number')
  if (!phone) return

  function fillPhone() {
    const input = document.querySelector('input[name="phone"]')
    if (!input) return
    if (input.value === phone) return
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, phone)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // The GHL widget can mount/unmount the phone input as the user navigates
  // through steps — keep refilling until the page is unloaded.
  setInterval(fillPhone, 500)
})()
`

module.exports = { SCRIPT }
