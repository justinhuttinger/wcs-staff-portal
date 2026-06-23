const test = require('node:test')
const assert = require('node:assert')
const { generateProgram } = require('./generate')

function fakeGenerator() {
  const calls = []
  let daysSeenWhenTerminologyRan = null
  const generateText = async ({ prompt }) => {
    calls.push(prompt)
    if (prompt.includes('"basicExplanation"')) {
      return JSON.stringify({ basicExplanation: 'b', progressionNotes: 'p', principles: 'pr', importantNotes: 'n' })
    }
    if (prompt.includes('"terminology"')) {
      daysSeenWhenTerminologyRan = calls.filter(c => c.includes('Create ONE workout day')).length
      return JSON.stringify({ terminology: 'Superset: two exercises back to back' })
    }
    // day prompt — echo the day number requested
    const m = prompt.match(/DAY: (\d)/)
    const day = m ? Number(m[1]) : 1
    return JSON.stringify({ day, title: `Day ${day}`, focus: 'x', exercises: [{ name: 'Squat', sets: '3', reps: '5', notes: '', variations: '' }] })
  }
  return { generateText, calls, getDaysSeen: () => daysSeenWhenTerminologyRan }
}

test('assembles program with N workouts in day order', async () => {
  const fake = fakeGenerator()
  const program = await generateProgram(
    { firstName: 'Sam', lastName: 'Lee' },
    { daysPerWeek: '3', programGoal: 'strength', experienceLevel: 'intermediate', equipment: 'full gym', duration: '8' },
    { generateText: fake.generateText },
  )
  assert.deepEqual(program.weekTemplate.workouts.map(w => w.day), [1, 2, 3])
  assert.equal(program.basicExplanation, 'b')
  assert.equal(program.terminology, 'Superset: two exercises back to back')
})

test('terminology call runs AFTER all day calls', async () => {
  const fake = fakeGenerator()
  await generateProgram(
    { firstName: 'Sam', lastName: 'Lee' },
    { daysPerWeek: '3' },
    { generateText: fake.generateText },
  )
  assert.equal(fake.getDaysSeen(), 3) // all 3 day calls completed before terminology
})

test('throws if a day call returns unparseable JSON', async () => {
  const generateText = async ({ prompt }) => prompt.includes('Create ONE workout day') ? 'not json' : '{}'
  await assert.rejects(() => generateProgram({ firstName: 'A', lastName: 'B' }, { daysPerWeek: '2' }, { generateText }))
})
