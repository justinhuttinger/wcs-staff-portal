const axios = require('axios');
const { put } = require('../ghl/client');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

// GHL employee dropdown field IDs per location
const EMPLOYEE_FIELD_IDS = {
  'salem':       'WOvY0CUbJQmzbHP6fj5e',
  'keizer':      'zpjNYk3vDFKKIUDbSIjD',
  'eugene':      'TwozSPfg1Mg0MTYvEXpB',
  'milwaukie':   'saT5AHGtaicoFxuSNoOS',
  'clackamas':   'ErOjVabJGLMnKc2bs6nL',
  'springfield': 'YUWbpzWwCpRVDHjZp3Wl',
  'medford':     '', // Not configured
};

const EXCLUDED_NAMES = [
  'easalytics bot', 'click2save bot', 'reporting bot',
  'abc support', 'test test', 'personal trainer',
];

/**
 * Fetch active employees from ABC for a given club.
 */
async function fetchEmployeesFromABC(clubNumber) {
  const url = `${ABC_BASE_URL}/${clubNumber}/employees`;
  console.log(`[Employee Sync] Fetching employees for club ${clubNumber}...`);

  const res = await axios.get(url, {
    headers: {
      'app_id': ABC_APP_ID,
      'app_key': ABC_APP_KEY,
      'Accept': 'application/json',
    },
    timeout: 30000,
  });

  const employees = res.data.employees || [];
  console.log(`[Employee Sync] ${employees.length} total employees from ABC`);

  const names = employees
    .filter(emp => {
      const status = emp.employment?.employeeStatus?.toLowerCase();
      if (status !== 'active') return false;
      const fullName = `${emp.personal?.firstName || ''} ${emp.personal?.lastName || ''}`.toLowerCase().trim();
      if (EXCLUDED_NAMES.includes(fullName)) return false;
      return true;
    })
    .map(emp => `${emp.personal?.firstName || ''} ${emp.personal?.lastName || ''}`.trim())
    .filter(name => name.length > 0)
    .sort();

  console.log(`[Employee Sync] ${names.length} active employees after filtering`);
  return names;
}

/**
 * Update a GHL custom field dropdown with employee names.
 */
async function updateGHLEmployeeDropdown(locationId, fieldId, options, apiKey) {
  // Get current field to preserve the name
  const getRes = await axios.get(
    `https://services.leadconnectorhq.com/locations/${locationId}/customFields/${fieldId}`,
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Version': '2021-07-28',
        'Accept': 'application/json',
      },
      timeout: 15000,
    }
  );

  const currentField = getRes.data.customField || getRes.data;
  const fieldName = currentField.name || 'Sale Team Member';

  console.log(`[Employee Sync] Updating GHL field "${fieldName}" with ${options.length} options`);

  await axios.put(
    `https://services.leadconnectorhq.com/locations/${locationId}/customFields/${fieldId}`,
    { name: fieldName, options },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      timeout: 15000,
    }
  );

  return { fieldName, optionsCount: options.length };
}

/**
 * Run employee sync for all locations.
 */
async function employeeSync(locations) {
  console.log(`[Employee Sync] Starting for ${locations.length} locations`);
  const results = [];

  for (const location of locations) {
    const fieldId = EMPLOYEE_FIELD_IDS[location.slug];
    if (!fieldId) {
      console.log(`[Employee Sync] Skipping ${location.name} — no employee field ID`);
      continue;
    }

    try {
      const names = await fetchEmployeesFromABC(location.clubNumber);
      const result = await updateGHLEmployeeDropdown(location.id, fieldId, names, location.apiKey);
      console.log(`[Employee Sync] ${location.name}: updated "${result.fieldName}" with ${result.optionsCount} employees`);
      results.push({ location: location.name, success: true, count: result.optionsCount });
    } catch (err) {
      console.error(`[Employee Sync] ${location.name} failed:`, err.message);
      results.push({ location: location.name, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = { employeeSync };
