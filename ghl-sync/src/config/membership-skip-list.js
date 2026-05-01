const supabase = require('../db/supabase');

const CACHE_TTL_MS = 60 * 1000;

let cached = null;
let cachedAt = 0;

async function loadFromDb() {
  const { data, error } = await supabase
    .from('abc_membership_skip_list')
    .select('membership_type');
  if (error) throw new Error(`Failed to load membership skip list: ${error.message}`);
  return new Set((data || []).map(r => r.membership_type));
}

async function getSkipList() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) return cached;
  cached = await loadFromDb();
  cachedAt = now;
  return cached;
}

function invalidateSkipList() {
  cached = null;
  cachedAt = 0;
}

module.exports = { getSkipList, invalidateSkipList };
