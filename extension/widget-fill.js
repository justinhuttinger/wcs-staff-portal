// WCS Staff Tools - GHL Widget Autofill & Cleanup
// Runs inside GHL booking/survey widget iframes

(function() {
  const params = new URLSearchParams(window.location.search);
  const isBooking = window.location.pathname.includes('/widget/booking/');

  // Hide logo, title, description, and booking info on the booking widget
  if (isBooking) {
    const style = document.createElement('style');
    style.textContent = `
      .appointment_widgets--revamp--service-info,
      .appointment-widgets-service-booking-info {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Phone autofill
  const phone = params.get('phone');
  if (phone) {
    function fillPhone() {
      const input = document.querySelector('input[name="phone"]');
      if (!input) return;
      if (input.value === phone) return; // Already filled with correct value

      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, phone);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Keep watching — the phone input can appear, disappear, and reappear
    setInterval(fillPhone, 500);
  }
})();
