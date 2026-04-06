// WCS Staff Tools - Page Context Scraper
// Runs in the ABC Financial page to scrape member form data
// Communicates with content.js via window.postMessage

(function() {
  let memberData = {};

  const fieldSelectors = {
    firstName:   ['#firstName', '[name="personalSection.firstName.value"]'],
    lastName:    ['#lastName',  '[name="personalSection.lastName.value"]'],
    email:       ['#email', '#emailAddress', '[name="personalSection.email.value"]', '[name="personalSection.emailAddress.value"]'],
    phone:       ['#cellNumber', '#homeNumber', '#homePhone', '#phone',
                  '[name="personalSection.cellNumber.value"]',
                  '[name="personalSection.homeNumber.value"]',
                  '[name="personalSection.homePhone.value"]'],
    salesperson: ['#salesPersonIdInput', '[name="agreementSection.salesPersonName"]'],
  };

  function getDoc() {
    try {
      const mainFrame = document.querySelector('#main');
      if (mainFrame && mainFrame.contentDocument && mainFrame.contentDocument.body) {
        return mainFrame.contentDocument;
      }
    } catch(e) {}
    return document;
  }

  function scrapeAll() {
    const doc = getDoc();
    let changed = false;
    Object.entries(fieldSelectors).forEach(([key, selectors]) => {
      for (const sel of selectors) {
        try {
          const el = doc.querySelector(sel);
          if (el && el.value && el.value.trim().length > 1) {
            const newVal = el.value.trim();
            const oldVal = memberData[key] || '';
            if (newVal.length >= oldVal.length && newVal !== oldVal) {
              memberData[key] = newVal;
              changed = true;
            }
            break;
          }
        } catch(e) {}
      }
    });

    // Send updated data to content.js whenever we have something
    if (changed && Object.keys(memberData).length > 0) {
      window.postMessage({ type: 'WCS_MEMBER_DATA', memberData: { ...memberData } }, '*');
    }
  }

  // Watch #main iframe for confirmation page (fallback detection)
  function watchMainFrame() {
    const mainFrame = document.querySelector('#main');
    if (!mainFrame || mainFrame._wcsWatching) return;
    mainFrame._wcsWatching = true;
    mainFrame.addEventListener('load', () => {
      try {
        const url = mainFrame.contentDocument && mainFrame.contentDocument.location.href;
        if (url && url.includes('StandAloneAgreementPdfCommand.pml')) {
          scrapeAll(); // Final scrape
          window.postMessage({ type: 'WCS_MEMBER_DATA', memberData: { ...memberData } }, '*');
          window.postMessage({ type: 'WCS_SIGNUP_DETECTED' }, '*');
        }
      } catch(e) {}
    });
  }

  setInterval(scrapeAll, 500);
  watchMainFrame();
  setInterval(watchMainFrame, 1000);
})();
