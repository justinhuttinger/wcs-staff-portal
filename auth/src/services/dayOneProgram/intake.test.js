const test = require('node:test')
const assert = require('node:assert')
const { mapWebhookToFormData } = require('./intake')

test('maps core program-design fields with fallbacks', () => {
  const fd = mapWebhookToFormData({
    'Service Employee': 'Alex',
    'Program Goal': 'hypertrophy',
    'Duration (Weeks)': '12 weeks',
    'Days Per Week': '4 days a week',
    'Experience Level': 'Advanced',
    'Equipment': 'full gym',
  })
  assert.equal(fd.trainerName, 'Alex')
  assert.equal(fd.programGoal, 'hypertrophy')
  assert.equal(fd.duration, '12')          // " weeks" stripped
  assert.equal(fd.daysPerWeek, '4')        // " days a week" stripped
  assert.equal(fd.experienceLevel, 'advanced') // lowercased
})

test('defaults when fields are absent', () => {
  const fd = mapWebhookToFormData({})
  assert.equal(fd.programGoal, 'general fitness')
  assert.equal(fd.duration, '8')
  assert.equal(fd.daysPerWeek, '4')
  assert.equal(fd.experienceLevel, 'intermediate')
})

test('limitation fields become booleans incl. array form', () => {
  const fd = mapWebhookToFormData({
    'Knee Limitation': 'Yes',
    'Shoulder Limitation': ['Yes'],
    'Hip Limitation': 'No',
  })
  assert.equal(fd.kneeLimitation, true)
  assert.equal(fd.shoulderLimitation, true)
  assert.equal(fd.hipLimitation, false)
  assert.equal(fd.neckLimitation, false)
})

test('body fat and weight strip units; day focuses captured', () => {
  const fd = mapWebhookToFormData({
    'Body Fat (%)': '18%',
    'Weight (Lbs)': '180',
    'Day 1 Focus': 'Push',
    'Day Two Focus': 'Pull',
  })
  assert.equal(fd.bodyFat, '18')
  assert.equal(fd.weight, '180')
  assert.equal(fd.day1Focus, 'Push')
  assert.equal(fd.day2Focus, 'Pull')
})
