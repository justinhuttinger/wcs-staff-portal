// Standalone test of Trainerize push notification automation
// Tests the exact same flow as the Electron app, using Playwright
// Run: NODE_PATH="C:/nvm4w/nodejs/node_modules" node test-automation.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const EMAIL = 'justin@wcstrength.com';
const PASSWORD = 'Jellybean31!';

// --- Test payload (same shape as what the portal sends) ---
const TEST_PARAMS = {
  title: 'Test All Locations Send Now',
  message: 'Testing send now with all locations!',
  locations: ['all'],
  sendTiming: 'now',
  scheduledDate: '2026-04-15',
  scheduledTime: '09:00',
};

const LOCATION_MAP = {
  salem: 'West Coast Strength - Salem',
  keizer: 'West Coast Strength - Keizer',
  eugene: 'West Coast Strength - Eugene',
  springfield: 'West Coast Strength - Springfield',
  clackamas: 'West Coast Strength - Clackamas',
  milwaukie: 'East Side Athletic Club - Milwaukie',
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const { title, message, locations, sendTiming, scheduledDate, scheduledTime } = TEST_PARAMS;

  try {
    // =====================================================================
    // 1. LOGIN
    // =====================================================================
    console.log('STEP 1: Login...');
    await page.goto('https://westcoaststrength.trainerize.com/app/login', { timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.evaluate((creds) => {
      const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      let emailEl, passEl;
      for (const inp of inputs) {
        if (inp.type === 'password') passEl = inp;
        else if (!emailEl && (inp.type === 'text' || inp.type === 'email' || inp.type === '')) emailEl = inp;
      }
      if (emailEl) { emailEl.focus(); ns.call(emailEl, creds.email); emailEl.dispatchEvent(new Event('input', {bubbles:true})); }
      if (passEl) { passEl.focus(); ns.call(passEl, creds.password); passEl.dispatchEvent(new Event('input', {bubbles:true})); }
      document.querySelector('button[type="submit"]')?.click();
    }, { email: EMAIL, password: PASSWORD });

    // Wait for redirect away from /login
    await page.waitForFunction(() => !window.location.href.includes('/login'), { timeout: 20000 });
    console.log('   ✓ Logged in:', page.url());
    await page.waitForTimeout(2000);

    // =====================================================================
    // 2. NAVIGATE TO ANNOUNCEMENTS & OPEN FORM
    // =====================================================================
    console.log('STEP 2: Navigate to Announcements...');
    await page.goto('https://westcoaststrength.trainerize.com/app/announcements', { timeout: 20000 });
    await page.waitForSelector('[data-testid="pushNotification-grid-newButton"]', { timeout: 10000 });
    console.log('   ✓ On announcements page');

    console.log('STEP 3: Click NEW...');
    await page.click('[data-testid="pushNotification-grid-newButton"]');
    // Wait for the form modal to appear (title input becomes visible)
    await page.waitForSelector('.ant-calendar-picker-input', { timeout: 8000 });
    console.log('   ✓ Form opened');
    await page.waitForTimeout(1000);

    // =====================================================================
    // 4. FILL TITLE
    // =====================================================================
    console.log('STEP 4: Fill title...');
    // The title is the text input inside the form (not the search field)
    await page.evaluate((titleText) => {
      const ns = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      // Get all text inputs, filter to visible ones that aren't search fields
      const inputs = [...document.querySelectorAll('input.ant-input[type="text"]')].filter(el =>
        el.offsetParent !== null && !el.classList.contains('ant-select-search__field') && !el.classList.contains('ant-calendar-picker-input')
        && !el.disabled
      );
      const el = inputs[0];
      if (el) {
        el.focus();
        ns.call(el, titleText);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return 'ok: ' + el.className;
      }
      return 'no input found';
    }, title.slice(0, 65));
    console.log('   ✓ Title filled');
    await page.waitForTimeout(500);

    // =====================================================================
    // 5. SEND TIMING
    // =====================================================================
    console.log('STEP 5: Set send timing:', sendTiming, '...');
    if (sendTiming === 'now') {
      // Click the timing dropdown and select "Start sending immediately"
      // Find the ant-select that contains "Schedule" text
      await page.evaluate(() => {
        const selects = document.querySelectorAll('.ant-select-sm.ant-select');
        for (const s of selects) {
          if (s.textContent.includes('Schedule')) { s.click(); break; }
        }
      });
      await page.waitForTimeout(800);

      // Click "Start sending immediately" option
      await page.evaluate(() => {
        const items = document.querySelectorAll('.ant-select-dropdown-menu-item');
        for (const item of items) {
          if (item.textContent.includes('Start sending immediately')) { item.click(); return 'clicked'; }
        }
        // Fallback: try any visible dropdown item
        const all = [...document.querySelectorAll('*')].filter(el =>
          el.offsetParent !== null && el.textContent.trim() === 'Start sending immediately' && el.children.length === 0
        );
        if (all.length) { all[0].click(); return 'fallback'; }
        return 'not found';
      });
      await page.waitForTimeout(500);
      console.log('   ✓ Set to send immediately');
    } else if (sendTiming === 'scheduled' && scheduledDate) {
      // Default is already "Scheduled", so we just need to fill date/time
      console.log('   Timing already "Scheduled", filling date/time...');

      // DATE: The input is readonly — must use the calendar popup
      // Click to open calendar
      await page.click('.ant-calendar-picker-input');
      await page.waitForTimeout(1000);

      // Parse target date
      const [year, month, day] = scheduledDate.split('-').map(Number);

      // Ant Calendar: month/year are separate clickable elements with text like "Apr" and "2026"
      const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      const navigateCalendar = async () => {
        await page.waitForSelector('.ant-calendar', { timeout: 5000 });

        const maxAttempts = 24;
        for (let i = 0; i < maxAttempts; i++) {
          const current = await page.evaluate(() => {
            const monthEl = document.querySelector('.ant-calendar-month-select');
            const yearEl = document.querySelector('.ant-calendar-year-select');
            return {
              monthText: monthEl?.textContent?.trim() || '',
              yearText: yearEl?.textContent?.trim() || '',
            };
          });

          const curMonthIdx = MONTH_NAMES.indexOf(current.monthText);
          const curYear = parseInt(current.yearText, 10);
          console.log(`   Calendar: ${current.monthText} ${current.yearText} (month=${curMonthIdx + 1}, year=${curYear})`);

          if (curYear === year && curMonthIdx + 1 === month) break;

          // Compare as total months to determine direction
          const curTotal = curYear * 12 + curMonthIdx;
          const targetTotal = year * 12 + (month - 1);

          if (targetTotal > curTotal) {
            await page.click('.ant-calendar-next-month-btn');
          } else {
            await page.click('.ant-calendar-prev-month-btn');
          }
          await page.waitForTimeout(300);
        }

        // Click the target day
        const dayClicked = await page.evaluate((targetDay) => {
          const cells = document.querySelectorAll('.ant-calendar-date');
          for (const cell of cells) {
            const td = cell.closest('td');
            if (td && !td.classList.contains('ant-calendar-last-month-cell') &&
                !td.classList.contains('ant-calendar-next-month-btn-day') &&
                cell.textContent.trim() === String(targetDay)) {
              cell.click();
              return 'clicked day ' + targetDay;
            }
          }
          return 'day not found';
        }, day);
        console.log('   ' + dayClicked);
      };

      await navigateCalendar();
      await page.waitForTimeout(500);
      console.log('   ✓ Date selected');

      // TIME
      if (scheduledTime) {
        console.log('   Setting time:', scheduledTime);
        // Wait for time picker to become enabled (it's disabled until date is selected)
        await page.waitForFunction(() => {
          const input = document.querySelector('.ant-time-picker-input');
          return input && !input.disabled;
        }, { timeout: 5000 }).catch(() => {
          console.log('   Time picker still disabled, trying force click...');
        });
        await page.waitForTimeout(500);

        // Click time picker using Playwright's native click (handles event propagation better)
        // First check if input is enabled
        const isEnabled = await page.evaluate(() => {
          const input = document.querySelector('.ant-time-picker-input');
          return input ? { disabled: input.disabled, class: input.className } : null;
        });
        console.log('   Time input state:', JSON.stringify(isEnabled));

        if (isEnabled?.disabled) {
          // Remove disabled attribute and try
          await page.evaluate(() => {
            const input = document.querySelector('.ant-time-picker-input');
            if (input) input.removeAttribute('disabled');
          });
          await page.waitForTimeout(300);
        }

        // Try Playwright's native click on the time picker icon (the clock icon)
        try {
          await page.click('.ant-time-picker', { timeout: 3000 });
        } catch {
          console.log('   Playwright click failed, trying evaluate...');
          await page.evaluate(() => {
            const input = document.querySelector('.ant-time-picker-input');
            if (input) { input.removeAttribute('disabled'); input.focus(); input.click(); }
          });
        }
        await page.waitForTimeout(2000);

        // Check if panel appeared — also check for hidden panels
        const panelCheck = await page.evaluate(() => {
          const all = document.querySelectorAll('[class*="time-picker"]');
          return [...all].map(p => `<${p.tagName}> class="${p.className.substring(0, 120)}" visible=${p.offsetParent !== null}`).join('\n') || 'none';
        });
        console.log('   Time picker elements:', panelCheck);

        // Ant TimePicker renders a panel with columns for hours, minutes, (AM/PM)
        // We need to scroll to and click the right values
        const [hStr, mStr] = scheduledTime.split(':');
        const h = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);

        // Check if 12h or 24h format by looking for AM/PM column
        const timeResult = await page.evaluate(({ h, m }) => {
          // Ant TimePicker renders the panel as a portal at body level
          const panel = document.querySelector('.ant-time-picker-panel-inner, .ant-time-picker-panel');
          if (!panel) {
            // Debug: dump what's new on the page
            const panels = document.querySelectorAll('[class*="time-picker"]');
            return 'no panel found, time-picker elements: ' + [...panels].map(p => p.className).join(' | ');
          }

          const columns = panel.querySelectorAll('.ant-time-picker-panel-select');
          if (columns.length === 0) return 'no columns';

          // Column 0 = hours, Column 1 = minutes, Column 2 = AM/PM (if 12h)
          const is12h = columns.length >= 3;

          let targetHour = h;
          let ampm = 'AM';
          if (is12h) {
            ampm = h >= 12 ? 'PM' : 'AM';
            targetHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
          }

          // Click hour
          const hourItems = columns[0].querySelectorAll('li');
          for (const li of hourItems) {
            const val = parseInt(li.textContent.trim(), 10);
            if (val === targetHour) { li.click(); break; }
          }

          // Click minute
          const minItems = columns[1].querySelectorAll('li');
          for (const li of minItems) {
            const val = parseInt(li.textContent.trim(), 10);
            if (val === m) { li.click(); break; }
          }

          // Click AM/PM if 12h
          if (is12h && columns[2]) {
            const ampmItems = columns[2].querySelectorAll('li');
            for (const li of ampmItems) {
              if (li.textContent.trim().toUpperCase() === ampm) { li.click(); break; }
            }
          }

          return `ok: ${columns.length} columns, is12h=${is12h}, target=${targetHour}:${String(m).padStart(2, '0')} ${ampm}`;
        }, { h, m });
        console.log('   Time result:', timeResult);

        // Close time picker - click OK button or outside
        await page.evaluate(() => {
          const okBtn = document.querySelector('.ant-time-picker-panel-addon button, .ant-time-picker-ok');
          if (okBtn) okBtn.click();
        });
        await page.waitForTimeout(500);
        console.log('   ✓ Time selected');
      }
    }

    // =====================================================================
    // 6. SELECT LOCATIONS
    // =====================================================================
    console.log('STEP 6: Select locations...');

    // Click to open the location TreeSelect
    await page.click('[data-testid="announcements-locationTreeSelect"]');
    await page.waitForTimeout(1500);

    if (locations.includes('all')) {
      // Need to expand "All locations" first (click the switcher arrow), then check it
      // First try: just click the checkbox for "All locations"
      const locResult = await page.evaluate(() => {
        // The tree node for "All locations"
        const node = document.querySelector('[data-testid="announcements-locationTreeLeaf-allLocations"]');
        if (!node) return 'node not found';

        // Click the checkbox span
        const checkbox = node.querySelector('.ant-select-tree-checkbox');
        if (checkbox) { checkbox.click(); return 'clicked checkbox'; }

        return 'no checkbox found';
      });
      console.log('   All locations:', locResult);
    } else {
      // Expand "All locations" to reveal individual locations
      console.log('   Expanding All locations tree...');
      await page.evaluate(() => {
        const switcher = document.querySelector('[data-testid="announcements-locationTreeLeaf-allLocations"] .ant-select-tree-switcher');
        if (switcher) switcher.click();
      });
      // Wait for child nodes to render
      await page.waitForTimeout(2000);

      // Dump what's visible now
      const expandedNodes = await page.evaluate(() => {
        const nodes = document.querySelectorAll('.ant-select-tree-treenode');
        return [...nodes].map(n => {
          const title = n.querySelector('.ant-select-tree-title');
          const testId = n.getAttribute('data-testid') || '';
          const isChild = n.closest('.ant-select-tree-child-tree');
          return `"${title?.textContent?.trim() || '?'}" testid=${testId} child=${!!isChild}`;
        }).join('\n');
      });
      console.log('   Expanded tree nodes:\n' + (expandedNodes || '(empty)'));

      // Also dump the full location dropdown HTML for debugging
      const locDropHTML = await page.evaluate(() => {
        const dd = document.querySelector('.ant-select-tree-dropdown');
        return dd ? dd.outerHTML.substring(0, 5000) : 'no dropdown';
      });
      console.log('   Location dropdown HTML:', locDropHTML.substring(0, 2000));

      // Click each target location — use [role="treeitem"] with title matching
      for (const slug of locations) {
        const label = LOCATION_MAP[slug];
        if (!label) continue;
        const result = await page.evaluate((targetLabel) => {
          // Find by the title attribute on the content wrapper span
          const titleSpan = document.querySelector(`.ant-select-tree-node-content-wrapper[title="${targetLabel}"]`);
          if (titleSpan) {
            // Click the checkbox in the same tree item (sibling)
            const treeItem = titleSpan.closest('[role="treeitem"]');
            if (treeItem) {
              const cb = treeItem.querySelector('.ant-select-tree-checkbox');
              if (cb) { cb.click(); return 'checked: ' + targetLabel; }
            }
          }
          return 'not found: ' + targetLabel;
        }, label);
        console.log('   ' + result);
        await page.waitForTimeout(400);
      }
    }
    await page.waitForTimeout(500);
    console.log('   ✓ Locations selected');

    // Close location dropdown — click the form title text (NOT Escape, which closes the modal)
    await page.evaluate(() => {
      // Click the "Title" label in the form to move focus away from the dropdown
      const labels = [...document.querySelectorAll('label')];
      const titleLabel = labels.find(l => l.textContent.trim() === 'Title');
      if (titleLabel) { titleLabel.click(); return 'clicked title label'; }
      // Fallback: click the form title input area
      const h = document.querySelector('.newAnnouncementDialog h2');
      if (h) { h.click(); return 'clicked h2'; }
    });
    await page.waitForTimeout(1000);

    // =====================================================================
    // 7. SELECT CLIENTS ("All")
    // =====================================================================
    console.log('STEP 7: Select clients...');
    // Use evaluate to click, bypassing any overlay interference
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="announcements-userTypesTreeSelect"]');
      if (el) el.click();
    });
    await page.waitForTimeout(1500);

    // Use the specific data-testid to avoid matching location tree nodes
    const clientResult = await page.evaluate(() => {
      const allNode = document.querySelector('[data-testid="announcements-userTypesTreeLeaf-all"]');
      if (!allNode) return 'All node not found';
      const cb = allNode.querySelector('.ant-select-tree-checkbox');
      if (cb) { cb.click(); return 'checked All'; }
      return 'no checkbox in All node';
    });
    console.log('   Clients:', clientResult);
    await page.waitForTimeout(500);

    // Close clients dropdown
    await page.evaluate(() => {
      document.querySelector('.modal-content')?.click();
    });
    await page.waitForTimeout(500);

    // =====================================================================
    // 8. FILL MESSAGE
    // =====================================================================
    console.log('STEP 8: Fill message...');
    await page.evaluate((msgText) => {
      const ns = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      const ta = document.querySelector('textarea.ant-input');
      if (ta) {
        ta.focus();
        ns.call(ta, msgText);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, message.slice(0, 120));
    console.log('   ✓ Message filled');
    await page.waitForTimeout(500);

    // =====================================================================
    // 9. SCREENSHOT
    // =====================================================================
    console.log('STEP 9: Screenshot...');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'tz-result.png', fullPage: true });
    console.log('   ✓ Screenshot saved as tz-result.png');

    // Verify: dump what the form looks like now
    const formState = await page.evaluate(() => {
      const titleInput = [...document.querySelectorAll('input.ant-input[type="text"]')].find(el =>
        el.offsetParent !== null && !el.disabled && !el.classList.contains('ant-select-search__field') && !el.classList.contains('ant-calendar-picker-input')
      );
      const textarea = document.querySelector('textarea.ant-input');
      const dateInput = document.querySelector('.ant-calendar-picker-input');
      const timeInput = document.querySelector('.ant-time-picker-input');
      const locSelect = document.querySelector('[data-testid="announcements-locationTreeSelect"]');
      const clientSelect = document.querySelector('[data-testid="announcements-userTypesTreeSelect"]');

      return {
        title: titleInput?.value || 'empty',
        message: textarea?.value || 'empty',
        date: dateInput?.value || 'empty',
        time: timeInput?.value || 'empty',
        locationsSelected: locSelect?.querySelectorAll('.ant-select-selection__choice')?.length || 0,
        locationsText: [...(locSelect?.querySelectorAll('.ant-select-selection__choice__content') || [])].map(e => e.textContent).join(', '),
        clientsSelected: clientSelect?.querySelectorAll('.ant-select-selection__choice')?.length || 0,
      };
    });
    console.log('\n========== FORM STATE ==========');
    console.log(JSON.stringify(formState, null, 2));

    console.log('\n✓ ALL STEPS COMPLETED SUCCESSFULLY');

  } catch (err) {
    console.error('\n✗ ERROR:', err.message);
    await page.screenshot({ path: 'tz-error.png', fullPage: true });
    console.log('   Error screenshot saved as tz-error.png');
  } finally {
    await browser.close();
  }
})();
