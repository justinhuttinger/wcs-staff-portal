const test = require('node:test');
const assert = require('node:assert/strict');

const clubs = require('./clubs');
const { rowToClub } = require('./loadClubs');
const bundled = require('./clubs.json').clubs;

test('a public.clubs row round-trips to exactly the bundled club object', () => {
  bundled.forEach((c, i) => {
    const row = {
      club_number: c.clubNumber, slug: c.slug, name: c.name, sort_order: i + 1, active: c.active,
      env_key: c.envKey, ghl_location_id: c.ghlLocationId, state: c.state, timezone: c.timezone,
      abc_url: c.abcUrl, background: c.background, trading_name: c.tradingName || null,
    };
    assert.deepEqual(rowToClub(row), c, c.slug);
  });
});

test('envFor: env var wins, then the portal-saved token / row', () => {
  const saved = { ...process.env };
  try {
    delete process.env.GHL_API_KEY_MEDFORD;
    delete process.env.GHL_LOCATION_MEDFORD;
    const medford = () => clubs.activeClubs().find(c => c.slug === 'medford');
    assert.equal(clubs.envFor(medford(), 'GHL_API_KEY_'), undefined);
    assert.equal(clubs.envFor(medford(), 'GHL_LOCATION_'), 'ZxcRZBvwIO7vd4D3bjJO');
    clubs.applyClubs(bundled, new Map([['32073', { ghlApiKey: 'pit-db' }]]));
    assert.equal(clubs.envFor(medford(), 'GHL_API_KEY_'), 'pit-db');
    process.env.GHL_API_KEY_MEDFORD = 'pit-env';
    assert.equal(clubs.envFor(medford(), 'GHL_API_KEY_'), 'pit-env');
  } finally {
    process.env = saved;
    clubs.applyClubs(bundled);
  }
});

test('inactive clubs are not synced', () => {
  try {
    clubs.applyClubs(bundled.map(c => (c.slug === 'keizer' ? { ...c, active: false } : c)));
    assert.ok(!clubs.activeClubs().some(c => c.slug === 'keizer'));
    assert.equal(clubs.ALL_CLUBS.length, 7);
  } finally {
    clubs.applyClubs(bundled);
  }
});
