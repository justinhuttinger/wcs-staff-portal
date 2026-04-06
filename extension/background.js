// WCS Staff Tools - Background Service Worker

// Track signup flow state
chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.url.includes('validateAgreement.spr')) {
      chrome.storage.local.set({ wcsSignupPending: true });
    }
  },
  { url: [{ urlContains: 'validateAgreement.spr' }] }
);

// Detect confirmation page via webNavigation (reliable, works cross-origin)
chrome.webNavigation.onCommitted.addListener(
  (details) => {
    if (details.frameId !== 0 && details.url.includes('StandAloneAgreementPdfCommand.pml')) {
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        chrome.storage.local.get(['wcsMemberData', 'wcsSignupPending'], (result) => {
          if (result.wcsSignupPending && result.wcsMemberData && Object.keys(result.wcsMemberData).length > 0) {
            clearInterval(poll);
            chrome.tabs.sendMessage(details.tabId, {
              type: 'SIGNUP_COMPLETE',
              memberData: result.wcsMemberData
            });
            chrome.storage.local.remove(['wcsMemberData', 'wcsSignupPending']);
          } else if (attempts >= 50) {
            clearInterval(poll);
          }
        });
      }, 200);
    }
  },
  { url: [{ urlContains: 'StandAloneAgreementPdfCommand.pml' }] }
);

// Also handle fallback detection from injected.js → content.js → here
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'WCS_STORE_MEMBER_DATA') {
    chrome.storage.local.set({ wcsMemberData: msg.memberData });
  }

  if (msg.type === 'WCS_SIGNUP_DETECTED' && sender.tab) {
    chrome.storage.local.get(['wcsMemberData'], (result) => {
      if (result.wcsMemberData && Object.keys(result.wcsMemberData).length > 0) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: 'SIGNUP_COMPLETE',
          memberData: result.wcsMemberData
        });
        chrome.storage.local.remove(['wcsMemberData', 'wcsSignupPending']);
      }
    });
  }
});
