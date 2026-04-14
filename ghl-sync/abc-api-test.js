/**
 * ABC Financial API Test Script
 *
 * Tests the ABC API against one club (Salem) to verify:
 * - Authentication works
 * - Response shape / field names
 * - Pagination behavior (nextPage format)
 * - Member count
 *
 * Usage:
 *   Set env vars then run:
 *     ABC_APP_ID=xxx ABC_APP_KEY=xxx node abc-api-test.js
 *
 *   Or create a .env file in ghl-sync/ with ABC_APP_ID and ABC_APP_KEY
 */

require('dotenv').config();

const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;
const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

// Test against Salem
const TEST_CLUB = '30935';

async function testABCApi() {
  if (!ABC_APP_ID || !ABC_APP_KEY) {
    console.error('ERROR: Set ABC_APP_ID and ABC_APP_KEY environment variables');
    process.exit(1);
  }

  console.log('=== ABC Financial API Test ===');
  console.log(`Base URL: ${ABC_BASE_URL}`);
  console.log(`Club: ${TEST_CLUB} (Salem)`);
  console.log(`App ID: ${ABC_APP_ID.substring(0, 4)}...`);
  console.log('');

  // --- Test 1: Fetch page 1 ---
  console.log('--- Test 1: Fetch page 1 ---');
  try {
    const url = `${ABC_BASE_URL}/${TEST_CLUB}/members?joinStatus=member&page=1`;
    console.log(`GET ${url}`);

    const res = await fetch(url, {
      headers: {
        'app_id': ABC_APP_ID,
        'app_key': ABC_APP_KEY,
        'Accept': 'application/json',
      },
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);
    console.log('');

    if (!res.ok) {
      const text = await res.text();
      console.error('Error response body:', text);
      return;
    }

    const data = await res.json();

    // Show top-level keys
    console.log('Top-level response keys:', Object.keys(data));
    console.log('');

    // Show status/pagination info
    if (data.status) {
      console.log('--- Pagination (data.status) ---');
      console.log(JSON.stringify(data.status, null, 2));
      console.log('');
    }

    // Show first member shape
    const members = data.members || data.member || data.data || [];
    const memberList = Array.isArray(members) ? members : [members];
    console.log(`Members in page 1: ${memberList.length}`);
    console.log('');

    if (memberList.length > 0) {
      const first = memberList[0];
      console.log('--- First member (full object) ---');
      console.log(JSON.stringify(first, null, 2));
      console.log('');

      // Show all top-level keys of a member
      console.log('--- Member top-level keys ---');
      console.log(Object.keys(first));

      // Show nested objects
      for (const key of Object.keys(first)) {
        if (typeof first[key] === 'object' && first[key] !== null) {
          console.log(`\n--- member.${key} keys ---`);
          console.log(Object.keys(first[key]));
        }
      }
    }

    // --- Test 2: Check page 2 for pagination ---
    console.log('\n\n--- Test 2: Fetch page 2 (pagination check) ---');
    const url2 = `${ABC_BASE_URL}/${TEST_CLUB}/members?joinStatus=member&page=2`;
    console.log(`GET ${url2}`);

    const res2 = await fetch(url2, {
      headers: {
        'app_id': ABC_APP_ID,
        'app_key': ABC_APP_KEY,
        'Accept': 'application/json',
      },
    });

    const data2 = await res2.json();
    const members2 = data2.members || data2.member || data2.data || [];
    const memberList2 = Array.isArray(members2) ? members2 : [members2];
    console.log(`Members in page 2: ${memberList2.length}`);
    if (data2.status) {
      console.log('Page 2 status:', JSON.stringify(data2.status, null, 2));
    }

    // --- Test 3: Count total pages ---
    console.log('\n\n--- Test 3: Counting total pages (just headers, not full data) ---');
    let page = 1;
    let totalMembers = 0;
    while (page <= 100) { // safety limit
      const pageRes = await fetch(
        `${ABC_BASE_URL}/${TEST_CLUB}/members?joinStatus=member&page=${page}`,
        { headers: { 'app_id': ABC_APP_ID, 'app_key': ABC_APP_KEY, 'Accept': 'application/json' } }
      );
      const pageData = await pageRes.json();
      const pageMembers = pageData.members || pageData.member || pageData.data || [];
      const pageList = Array.isArray(pageMembers) ? pageMembers : [pageMembers];

      if (pageList.length === 0) {
        console.log(`Page ${page}: 0 members — stopping`);
        break;
      }
      totalMembers += pageList.length;
      console.log(`Page ${page}: ${pageList.length} members (running total: ${totalMembers})`);

      const nextPage = pageData.status?.nextPage;
      console.log(`  nextPage value: ${JSON.stringify(nextPage)} (type: ${typeof nextPage})`);

      if (!nextPage || nextPage === '' || nextPage === page.toString()) {
        console.log('  → No more pages, stopping');
        break;
      }
      page = parseInt(nextPage);
    }

    console.log(`\nTotal members for Salem (club ${TEST_CLUB}): ${totalMembers}`);

  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

testABCApi();
