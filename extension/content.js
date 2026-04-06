// WCS Staff Tools - Content Script
// Bridges injected.js (page context) ↔ background.js (extension context)
// and shows the overlay when signup is confirmed

const EXT_ID = chrome.runtime.id;

// Inject the page-context scraper
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
script.dataset.extId = EXT_ID;
script.onload = () => script.remove();
(document.head || document.documentElement).appendChild(script);

// Relay scraped member data from injected.js → background.js
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (e.data && e.data.type === 'WCS_MEMBER_DATA') {
    chrome.runtime.sendMessage({ type: 'WCS_STORE_MEMBER_DATA', memberData: e.data.memberData });
  }
  if (e.data && e.data.type === 'WCS_SIGNUP_DETECTED') {
    chrome.runtime.sendMessage({ type: 'WCS_SIGNUP_DETECTED' });
  }
});

// Listen for SIGNUP_COMPLETE from background.js → show overlay
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SIGNUP_COMPLETE') {
    showOverlay(msg.memberData || {});
  }
});

function showOverlay(memberData) {
  if (document.getElementById('wcs-overlay-backdrop')) return;

  const welcomeUrl = new URL(chrome.runtime.getURL('welcome.html'));
  if (memberData.firstName)   welcomeUrl.searchParams.set('firstName',   memberData.firstName);
  if (memberData.lastName)    welcomeUrl.searchParams.set('lastName',    memberData.lastName);
  if (memberData.email)       welcomeUrl.searchParams.set('email',       memberData.email);
  if (memberData.phone)       welcomeUrl.searchParams.set('phone',       memberData.phone);
  if (memberData.salesperson) welcomeUrl.searchParams.set('salesperson', memberData.salesperson);

  const backdrop = document.createElement('div');
  backdrop.id = 'wcs-overlay-backdrop';

  const modal = document.createElement('div');
  modal.id = 'wcs-overlay-modal';

  const iframe = document.createElement('iframe');
  iframe.id = 'wcs-overlay-iframe';
  iframe.src = welcomeUrl.toString();
  iframe.allow = 'fullscreen';

  modal.appendChild(iframe);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const close = () => { backdrop.remove(); };
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'WCS_CLOSE_OVERLAY') close();

    // Location storage: welcome.js ↔ chrome.storage
    if (e.data.type === 'WCS_GET_LOCATION') {
      chrome.storage.local.get(['wcsLocation'], (result) => {
        iframe.contentWindow.postMessage({ type: 'WCS_LOCATION_DATA', location: result.wcsLocation || null }, '*');
      });
    }
    if (e.data.type === 'WCS_SET_LOCATION') {
      chrome.storage.local.set({ wcsLocation: e.data.location });
    }
  });
}
