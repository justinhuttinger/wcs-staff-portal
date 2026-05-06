const axios = require('axios');
const { put } = require('../ghl/client');
const supabase = require('../db/supabase');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

// Hardcoded GHL "Tour Team Member" custom field ids per location (fast path).
// These were the original IDs in the code; logs confirm the field GHL returns
// for each is named "Tour Team Member".
const TOUR_FIELD_IDS = {
  'salem':       'WOvY0CUbJQmzbHP6fj5e',
  'keizer':      'zpjNYk3vDFKKIUDbSIjD',
  'eugene':      'TwozSPfg1Mg0MTYvEXpB',
  'milwaukie':   'saT5AHGtaicoFxuSNoOS',
  'clackamas':   'ErOjVabJGLMnKc2bs6nL',
  'springfield': 'YUWbpzWwCpRVDHjZp3Wl',
};

// Both dropdowns get the same ABC employee list each run. For each target,
// resolveFieldId tries the hardcoded map first, then falls back to a Supabase
// lookup against ghl_custom_field_defs (populated by fullSync) by field_key
// or display name.
const TARGET_FIELDS = [
  {
    label: 'Tour Team Member',
    fieldKey: 'contact.tour_team_member',
    name: 'Tour Team Member',
    hardcoded: TOUR_FIELD_IDS,
  },
  {
    label: 'Day One Booking Team Member',
    fieldKey: 'contact.day_one_booking_team_member',
    name: 'Day One Booking Team Member',
    hardcoded: null,
  },
];

async function resolveFieldId(location, target) {
  const hardcoded = target.hardcoded?.[location.slug];
  if (hardcoded) return hardcoded;

  const byKey = await supabase
    .from('ghl_custom_field_defs')
    .select('id')
    .eq('location_id', location.id)
    .eq('field_key', target.fieldKey)
    .limit(1)
    .maybeSingle();
  if (byKey.error) {
    console.warn(`[Employee Sync] field_key lookup error for ${location.name} (${target.label}):`, byKey.error.message);
  } else if (byKey.data?.id) {
    return byKey.data.id;
  }

  const byName = await supabase
    .from('ghl_custom_field_defs')
    .select('id')
    .eq('location_id', location.id)
    .eq('name', target.name)
    .limit(1)
    .maybeSingle();
  if (byName.error) {
    console.warn(`[Employee Sync] name lookup error for ${location.name} (${target.label}):`, byName.error.message);
    return null;
  }
  return byName.data?.id || null;
}

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
 * Run employee sync for all locations. Each location pushes the same ABC
 * employee list into every TARGET_FIELDS entry that resolves to a real GHL
 * custom field (Tour Team Member + Day One Booking Team Member).
 */
async function employeeSync(locations) {
  console.log(`[Employee Sync] Starting for ${locations.length} locations`);
  const results = [];

  for (const location of locations) {
    let names;
    try {
      names = await fetchEmployeesFromABC(location.clubNumber);
    } catch (err) {
      console.error(`[Employee Sync] ${location.name} ABC fetch failed:`, err.message);
      results.push({ location: location.name, success: false, error: err.message });
      continue;
    }

    for (const target of TARGET_FIELDS) {
      const fieldId = await resolveFieldId(location, target);
      if (!fieldId) {
        console.log(`[Employee Sync] Skipping ${location.name} (${target.label}) — no field ID resolved (field may not exist in GHL or ghl_custom_field_defs not yet populated)`);
        results.push({ location: location.name, field: target.label, success: true, skipped: true });
        continue;
      }
      try {
        const result = await updateGHLEmployeeDropdown(location.id, fieldId, names, location.apiKey);
        console.log(`[Employee Sync] ${location.name}: updated "${result.fieldName}" with ${result.optionsCount} employees`);
        results.push({ location: location.name, field: result.fieldName, success: true, count: result.optionsCount });
      } catch (err) {
        console.error(`[Employee Sync] ${location.name} (${target.label}) update failed:`, err.message);
        results.push({ location: location.name, field: target.label, success: false, error: err.message });
      }
    }
  }

  return results;
}

module.exports = { employeeSync };
