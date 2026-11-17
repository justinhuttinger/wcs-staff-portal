// abc-scraper.js is a sandboxed preload, so its pure helpers can't be imported.
// Pull the plan-name parser out of the source and test that instead.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const src = fs.readFileSync(path.join(__dirname, 'abc-scraper.js'), 'utf8')
const grab = (re) => re.exec(src)[0]
const code = [
  grab(/const PLAN_MAIN_TYPES = [^\n]*\n/),
  grab(/function parsePlanName\([\s\S]*?\r?\n}\r?\n/),
  grab(/function termSortKey\([\s\S]*?\r?\n}\r?\n/),
  grab(/function planChoices\([\s\S]*?\r?\n}\r?\n/),
].join('\n')
const { parsePlanName, planChoices } = new Function(code + 'return { parsePlanName, planChoices }')()

// Salem's live plan list, 2026-11-17.
const SALEM = [
  '.PT - NON-MEMBER PARTICIPANT',
  '0. SAMEDAYSALE - Family - 1 Year - ACH', '0. SAMEDAYSALE - Family - 1 Year - CC',
  '0. SAMEDAYSALE - Family - Month to Month - ACH', '0. SAMEDAYSALE - Family - Month to Month - CC',
  '0. SAMEDAYSALE - Single - 1 Year - ACH', '0. SAMEDAYSALE - Single - 1 Year - CC',
  '0. SAMEDAYSALE - Single - Month to Month - ACH', '0. SAMEDAYSALE - Single - Month to Month - CC',
  '0. SAMEDAYSALE - Youth - 1 Year - ACH', '0. SAMEDAYSALE - Youth - 1 Year - CC',
  '0. SAMEDAYSALE - Youth - Month to Month - ACH', '0. SAMEDAYSALE - Youth - Month to Month - CC',
  '1. Single - 1 Year - ACH', '1. Single - 1 Year - CC', '1. Single - Month to Month - ACH', '1. Single - Month to Month - CC',
  '2. Family - 1 Year - ACH', '2. Family - 1 Year - CC', '2. Family - Month to Month - ACH', '2. Family - Month to Month - CC',
  '3. Youth - 1 Year - ACH', '3. Youth - 1 Year - CC', '3. Youth - Month to Month - ACH', '3. Youth - Month to Month - CC',
  '4. Active and Fit - All Access - ACH', '4. Active and Fit - All Access - CC', '4. Active and Fit - Limited',
  '5. Insurance - All Access - ACH', '5. Insurance - All Access - CC', '5. Insurance - Limited',
  '7. PIF Single - 1 Month', '7. PIF Single - 12 Months', '7. PIF Single - 3 Months', '7. PIF Single - 6 Months',
  '7. PIF Youth - 1 Month', '7. PIF Youth - 12 Months', '7. PIF Youth - 3 Months', '7. PIF Youth - 6 Months',
  '8. Family - Donation', '8. Single - Donation', '9. Gympass - Wellhub',
  'Z - CORP. PAID - NO ABC BILLING', 'Z - STAFF',
]
const plans = SALEM.map((n, i) => Object.assign(parsePlanName(n), { id: 'p' + i }))

test('splits a standard plan into type, term and pay', () => {
  const p = parsePlanName('1. Single - 1 Year - ACH')
  assert.deepEqual([p.group, p.term, p.pay, p.sameDay], ['Single', '1 Year', 'ACH', false])
  const q = parsePlanName('2. Family - Month to Month - CC')
  assert.deepEqual([q.group, q.term, q.pay], ['Family', 'Month to Month', 'CC'])
})

test('same day sale plans are flagged, not a separate type', () => {
  const p = parsePlanName('0. SAMEDAYSALE - Youth - Month to Month - CC')
  assert.deepEqual([p.sameDay, p.group, p.term, p.pay], [true, 'Youth', 'Month to Month', 'CC'])
})

test('plans without CC/ACH have no pay method', () => {
  assert.equal(parsePlanName('4. Active and Fit - Limited').pay, '')
  assert.equal(parsePlanName('7. PIF Single - 3 Months').pay, '')
  assert.equal(parsePlanName('7. PIF Single - 3 Months').group, 'PIF Single')
})

test('donations group together', () => {
  const p = parsePlanName('8. Single - Donation')
  assert.deepEqual([p.group, p.term], ['Donation', 'Single'])
})

test('one-off plans fall under Other, listed by name', () => {
  assert.deepEqual(['9. Gympass - Wellhub', 'Z - STAFF', 'Z - CORP. PAID - NO ABC BILLING', '.PT - NON-MEMBER PARTICIPANT'].map(n => {
    const p = parsePlanName(n)
    return p.group + ': ' + p.term
  }), ['Other: Gympass - Wellhub', 'Other: STAFF', 'Other: CORP. PAID - NO ABC BILLING', 'Other: PT - NON-MEMBER PARTICIPANT'])
})

test('type step keeps ABC order with Other last', () => {
  const regular = plans.filter(p => !p.sameDay)
  assert.deepEqual(planChoices(regular, 'group'),
    ['Single', 'Family', 'Youth', 'Active and Fit', 'Insurance', 'PIF Single', 'PIF Youth', 'Donation', 'Other'])
  assert.deepEqual(planChoices(plans.filter(p => p.sameDay), 'group'), ['Family', 'Single', 'Youth'])
})

test('terms sort by length, then ABC order', () => {
  assert.deepEqual(planChoices(plans.filter(p => p.group === 'Single' && !p.sameDay), 'term'), ['1 Year', 'Month to Month'])
  assert.deepEqual(planChoices(plans.filter(p => p.group === 'PIF Youth'), 'term'), ['1 Month', '3 Months', '6 Months', '12 Months'])
})

test('card is offered before bank', () => {
  assert.deepEqual(planChoices(plans.filter(p => p.group === 'Single' && p.term === '1 Year' && !p.sameDay), 'pay'), ['CC', 'ACH'])
})

test('every plan is reachable by a unique path', () => {
  const seen = new Set()
  for (const p of plans) {
    const key = [p.sameDay, p.group, p.term, p.pay].join('|')
    assert.ok(!seen.has(key), 'duplicate path ' + key)
    seen.add(key)
  }
})

test('access-level plan types are real plan types', () => {
  const groups = eval(/const ACCESS_LEVEL_GROUPS = (\[[^\n]*\])/.exec(src)[1])
  const main = eval(/const PLAN_MAIN_TYPES = (\[[^\n]*\])/.exec(src)[1])
  for (const g of groups) assert.ok(main.includes(g), g)
  assert.deepEqual(planChoices(plans.filter(p => p.group === 'Active and Fit'), 'term'), ['All Access', 'Limited'])
})
