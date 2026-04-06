// WCS_LOCATIONS is loaded from locations.js

const params = new URLSearchParams(window.location.search);
const member = {
  firstName:   params.get('firstName')   || '',
  lastName:    params.get('lastName')    || '',
  email:       params.get('email')       || '',
  phone:       params.get('phone')       || '',
  salesperson: params.get('salesperson') || '',
};

const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').toUpperCase();
const displayName = fullName || 'New Member';

// Populate intro screen
const nameEl = document.getElementById('intro-member-name');
if (fullName) nameEl.textContent = fullName;

const chipsEl = document.getElementById('member-chips');
if (member.email)       chipsEl.innerHTML += `<div class="chip"><span class="chip-icon">✉</span>${member.email}</div>`;
if (member.phone)       chipsEl.innerHTML += `<div class="chip"><span class="chip-icon">☎</span>${member.phone}</div>`;
if (member.salesperson) chipsEl.innerHTML += `<div class="chip"><span class="chip-icon">●</span>${member.salesperson}</div>`;

document.getElementById('booking-name').textContent = displayName;
document.getElementById('vip-name').textContent = displayName;

function cleanSalesperson(raw) {
  return raw.replace(/\s+[A-Za-z]\s+/g, ' ').trim();
}

function cleanPhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
}

function buildUrl(base) {
  const url = new URL(base);
  if (member.firstName)   url.searchParams.set('first_name', member.firstName);
  if (member.lastName)    url.searchParams.set('last_name',  member.lastName);
  if (member.email)       url.searchParams.set('email',      member.email);
  if (member.phone) {
    const phone = cleanPhone(member.phone);
    url.searchParams.set('phone', phone);
  }
  if (member.salesperson) url.searchParams.set('day_one_booking_team_member', cleanSalesperson(member.salesperson));
  return url.toString();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── Location picker ──
const grid = document.getElementById('location-grid');
Object.entries(WCS_LOCATIONS).forEach(([key, loc]) => {
  const btn = document.createElement('div');
  btn.className = 'location-btn';
  btn.textContent = loc.name.toUpperCase();
  btn.addEventListener('click', () => {
    // Save to chrome.storage via parent extension
    window.parent.postMessage({ type: 'WCS_SET_LOCATION', location: key }, '*');
    startWithLocation(key);
  });
  grid.appendChild(btn);
});

// ── Main flow ──
let currentLocation = null;
let firstTask = null;

function preloadFrames() {
  const loc = WCS_LOCATIONS[currentLocation];
  document.getElementById('booking-frame').src = buildUrl(loc.booking);
  document.getElementById('vip-frame').src = buildUrl(loc.vip);
}

function startWithLocation(locKey) {
  currentLocation = locKey;
  preloadFrames();
  showScreen('screen-intro');
}

// 'step1' = first screen they chose, 'step2' = they skipped forward
let currentStep = null; // 'step1' or 'step2'

function goToBooking(asStep) {
  currentStep = asStep;
  if (asStep === 'step1') {
    document.getElementById('booking-badge').textContent = '1 OF 2';
    document.getElementById('btn-booking-next').textContent = 'Next: Submit VIPs →';
    document.getElementById('btn-booking-back').style.display = 'none';
  } else {
    document.getElementById('booking-badge').textContent = '2 OF 2';
    document.getElementById('btn-booking-next').textContent = 'Done ✕';
    document.getElementById('btn-booking-back').style.display = '';
  }
  showScreen('screen-booking');
}

function goToVip(asStep) {
  currentStep = asStep;
  if (asStep === 'step1') {
    document.getElementById('vip-badge').textContent = '1 OF 2';
    document.getElementById('btn-vip-next').textContent = 'Next: Book Day One →';
    document.getElementById('btn-vip-back').style.display = 'none';
  } else {
    document.getElementById('vip-badge').textContent = '2 OF 2';
    document.getElementById('btn-vip-next').textContent = 'Done ✕';
    document.getElementById('btn-vip-back').style.display = '';
  }
  showScreen('screen-vip');
}

function closeOverlay() {
  window.parent.postMessage({ type: 'WCS_CLOSE_OVERLAY' }, '*');
}

// Intro cards — always step 1
document.getElementById('card-book').addEventListener('click', () => goToBooking('step1'));
document.getElementById('card-vip').addEventListener('click', () => goToVip('step1'));

// Next buttons — skip forward to step 2, or done
document.getElementById('btn-booking-next').addEventListener('click', () => {
  if (currentStep === 'step1') goToVip('step2'); else closeOverlay();
});

document.getElementById('btn-vip-next').addEventListener('click', () => {
  if (currentStep === 'step1') goToBooking('step2'); else closeOverlay();
});

// Back buttons — go back to step 1 (restores the "next" button)
document.getElementById('btn-booking-back').addEventListener('click', () => goToVip('step1'));
document.getElementById('btn-vip-back').addEventListener('click', () => goToBooking('step1'));

// ── Init: check for saved location ──
// Listen for location data from content script
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'WCS_LOCATION_DATA') {
    if (e.data.location && WCS_LOCATIONS[e.data.location]) {
      startWithLocation(e.data.location);
    } else {
      showScreen('screen-location');
    }
  }
});

// Request saved location from content script
window.parent.postMessage({ type: 'WCS_GET_LOCATION' }, '*');
