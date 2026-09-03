#!/usr/bin/env node
/**
 * Seed the member-app program template library.
 *
 *   node auth/scripts/seed-program-templates.js
 *
 * Idempotent by template name: an existing template is replaced (days and
 * exercises cascade), so editing this file and re-running is the way to update
 * the library. Templates a coach created by hand are untouched, because only
 * the names listed here are matched.
 *
 * Prescriptions are free text on purpose ("8-10", "AMRAP", "bodyweight");
 * rest_seconds is a number because the app counts it down.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { supabaseAdmin } = require('../src/services/supabase')

// Shorthand so the library below stays readable:
//   e(name, sets, reps, weight, rest, note)
const e = (name, sets, reps, weight, rest, note) =>
  ({ name, sets, reps, weight, rest_seconds: rest, notes: note || null })

const TEMPLATES = [
  {
    name: 'Full Body Foundations',
    goal: 'General fitness', level: 'Beginner', days_per_week: 3, equipment: 'Full gym',
    description: 'Three full-body days for someone new to lifting. Machines and dumbbells, nothing technical.',
    tags: ['beginner', 'full body', 'new member', 'first program'],
    days: [
      { name: 'Day A', ex: [
        e('Goblet squat', '3', '10', 'light DB', 90, 'Elbows inside the knees'),
        e('Chest press machine', '3', '10-12', '', 90),
        e('Seated row', '3', '10-12', '', 90),
        e('Dumbbell shoulder press', '2', '12', '', 60),
        e('Plank', '3', '30 sec', 'bodyweight', 45),
      ] },
      { name: 'Day B', ex: [
        e('Leg press', '3', '12', '', 90),
        e('Lat pulldown', '3', '10-12', '', 90),
        e('Incline dumbbell press', '3', '10', '', 90),
        e('Dumbbell curl', '2', '12', '', 45),
        e('Dead bug', '3', '10 each', 'bodyweight', 45),
      ] },
      { name: 'Day C', ex: [
        e('Romanian deadlift', '3', '10', 'light bar', 90, 'Hinge, do not squat it'),
        e('Push-up', '3', 'AMRAP', 'bodyweight', 60),
        e('Cable row', '3', '12', '', 75),
        e('Walking lunge', '2', '10 each', 'bodyweight', 60),
        e('Farmer carry', '3', '30 sec', 'moderate DB', 60),
      ] },
    ],
  },
  {
    name: 'Upper / Lower Split',
    goal: 'Hypertrophy', level: 'Intermediate', days_per_week: 4, equipment: 'Full gym',
    description: 'Four days alternating upper and lower. The default for anyone past their first few months.',
    tags: ['upper lower', 'split', 'muscle', 'intermediate'],
    days: [
      { name: 'Upper A', ex: [
        e('Bench press', '4', '6-8', '', 120),
        e('Bent-over row', '4', '8', '', 90),
        e('Overhead press', '3', '8-10', '', 90),
        e('Lat pulldown', '3', '10-12', '', 75),
        e('Face pull', '3', '15', 'rope', 45),
      ] },
      { name: 'Lower A', ex: [
        e('Back squat', '4', '6-8', '', 150),
        e('Romanian deadlift', '3', '8-10', '', 120),
        e('Leg press', '3', '12', '', 90),
        e('Standing calf raise', '4', '15', '', 45),
        e('Hanging knee raise', '3', '12', 'bodyweight', 60),
      ] },
      { name: 'Upper B', ex: [
        e('Incline dumbbell press', '4', '8-10', '', 90),
        e('Chest-supported row', '4', '10', '', 90),
        e('Lateral raise', '3', '15', 'light', 45),
        e('Cable curl', '3', '12', '', 45),
        e('Triceps pushdown', '3', '12', '', 45),
      ] },
      { name: 'Lower B', ex: [
        e('Deadlift', '3', '5', '', 180, 'Reset every rep'),
        e('Front squat', '3', '8', '', 120),
        e('Walking lunge', '3', '10 each', '', 90),
        e('Leg curl', '3', '12', '', 60),
        e('Plank', '3', '45 sec', 'bodyweight', 45),
      ] },
    ],
  },
  {
    name: 'Push Pull Legs',
    goal: 'Hypertrophy', level: 'Advanced', days_per_week: 6, equipment: 'Full gym',
    description: 'Three workouts run twice through the week, so each muscle group is hit twice. Six sessions in total.',
    tags: ['ppl', 'push pull legs', 'six day', 'advanced', 'muscle'],
    days: [
      { name: 'Push', ex: [
        e('Bench press', '4', '6-8', '', 120),
        e('Overhead press', '3', '8', '', 90),
        e('Incline dumbbell press', '3', '10', '', 90),
        e('Lateral raise', '4', '15', 'light', 45),
        e('Overhead triceps extension', '3', '12', '', 60),
      ] },
      { name: 'Pull', ex: [
        e('Pull-up', '4', 'AMRAP', 'bodyweight', 120),
        e('Barbell row', '4', '8', '', 90),
        e('Cable row', '3', '12', '', 75),
        e('Rear delt fly', '3', '15', 'light', 45),
        e('Barbell curl', '3', '10', '', 60),
      ] },
      { name: 'Legs', ex: [
        e('Back squat', '4', '6-8', '', 150),
        e('Romanian deadlift', '3', '10', '', 120),
        e('Bulgarian split squat', '3', '10 each', '', 90),
        e('Leg curl', '3', '12', '', 60),
        e('Calf raise', '4', '15', '', 45),
      ] },
    ],
  },
  {
    name: 'Strength 5x5',
    goal: 'Strength', level: 'Intermediate', days_per_week: 3, equipment: 'Barbell',
    description: 'Two workouts alternated across three sessions a week. Add weight every session until it stops moving.',
    tags: ['5x5', 'strength', 'barbell', 'linear progression', 'powerlifting'],
    days: [
      { name: 'Workout A', ex: [
        e('Back squat', '5', '5', '', 180),
        e('Bench press', '5', '5', '', 180),
        e('Barbell row', '5', '5', '', 150),
      ] },
      { name: 'Workout B', ex: [
        e('Back squat', '5', '5', '', 180),
        e('Overhead press', '5', '5', '', 180),
        e('Deadlift', '1', '5', '', 240, 'One heavy set is enough'),
      ] },
    ],
  },
  {
    name: 'Fat Loss Circuit',
    goal: 'Fat loss', level: 'Beginner', days_per_week: 3, equipment: 'Full gym',
    description: 'Short rest, full body, heart rate up. Pairs well with walking on off days.',
    tags: ['fat loss', 'conditioning', 'circuit', 'weight loss', 'metabolic'],
    days: [
      { name: 'Circuit A', ex: [
        e('Goblet squat', '3', '15', 'moderate DB', 30),
        e('Push-up', '3', '12', 'bodyweight', 30),
        e('Dumbbell row', '3', '12 each', '', 30),
        e('Kettlebell swing', '3', '20', '', 45),
        e('Mountain climber', '3', '30 sec', 'bodyweight', 30),
      ] },
      { name: 'Circuit B', ex: [
        e('Reverse lunge', '3', '12 each', '', 30),
        e('Dumbbell press', '3', '12', '', 30),
        e('Lat pulldown', '3', '15', '', 30),
        e('Battle rope', '3', '20 sec', '', 45),
        e('Bicycle crunch', '3', '20', 'bodyweight', 30),
      ] },
      { name: 'Circuit C', ex: [
        e('Trap bar deadlift', '3', '12', '', 45),
        e('Incline push-up', '3', '15', 'bodyweight', 30),
        e('Cable row', '3', '15', '', 30),
        e('Step-up', '3', '12 each', '', 30),
        e('Plank', '3', '45 sec', 'bodyweight', 30),
      ] },
    ],
  },
  {
    name: 'Dumbbells Only',
    goal: 'General fitness', level: 'Beginner', days_per_week: 3, equipment: 'Dumbbells only',
    description: 'Everything done with a pair of dumbbells. Good for a busy floor or a home setup.',
    tags: ['dumbbell', 'home', 'minimal equipment', 'travel'],
    days: [
      { name: 'Day 1', ex: [
        e('Dumbbell goblet squat', '4', '10', '', 75),
        e('Dumbbell bench press', '4', '10', '', 75),
        e('Dumbbell row', '4', '10 each', '', 60),
        e('Dumbbell curl', '3', '12', '', 45),
      ] },
      { name: 'Day 2', ex: [
        e('Dumbbell Romanian deadlift', '4', '10', '', 75),
        e('Dumbbell shoulder press', '4', '10', '', 75),
        e('Dumbbell pullover', '3', '12', '', 60),
        e('Dumbbell lateral raise', '3', '15', '', 45),
      ] },
      { name: 'Day 3', ex: [
        e('Dumbbell split squat', '3', '10 each', '', 75),
        e('Dumbbell floor press', '3', '12', '', 60),
        e('Dumbbell hip thrust', '3', '12', '', 60),
        e('Dumbbell farmer carry', '3', '40 sec', '', 60),
      ] },
    ],
  },
  {
    name: 'Bodyweight Anywhere',
    goal: 'General fitness', level: 'Beginner', days_per_week: 3, equipment: 'Bodyweight',
    description: 'No equipment at all. Useful for travel, or a member waiting on an injury clearance.',
    tags: ['bodyweight', 'no equipment', 'travel', 'home'],
    days: [
      { name: 'Day 1', ex: [
        e('Air squat', '4', '20', 'bodyweight', 45),
        e('Push-up', '4', 'AMRAP', 'bodyweight', 60),
        e('Reverse lunge', '3', '12 each', 'bodyweight', 45),
        e('Plank', '3', '45 sec', 'bodyweight', 45),
      ] },
      { name: 'Day 2', ex: [
        e('Glute bridge', '4', '15', 'bodyweight', 45),
        e('Pike push-up', '3', '10', 'bodyweight', 60),
        e('Step-up', '3', '12 each', 'bodyweight', 45),
        e('Side plank', '3', '30 sec each', 'bodyweight', 45),
      ] },
      { name: 'Day 3', ex: [
        e('Squat jump', '3', '12', 'bodyweight', 60),
        e('Incline push-up', '4', '15', 'bodyweight', 45),
        e('Single-leg glute bridge', '3', '10 each', 'bodyweight', 45),
        e('Hollow hold', '3', '30 sec', 'bodyweight', 45),
      ] },
    ],
  },
  {
    name: 'Athletic Power',
    goal: 'Athletic performance', level: 'Advanced', days_per_week: 4, equipment: 'Full gym',
    description: 'Speed and power first, strength second. For members playing a sport.',
    tags: ['athlete', 'power', 'explosive', 'sport', 'speed'],
    days: [
      { name: 'Lower Power', ex: [
        e('Box jump', '5', '3', 'bodyweight', 120, 'Step down, do not bounce'),
        e('Trap bar deadlift', '4', '3', 'heavy', 180),
        e('Bulgarian split squat', '3', '8 each', '', 90),
        e('Nordic curl', '3', '6', 'bodyweight', 90),
      ] },
      { name: 'Upper Power', ex: [
        e('Medicine ball chest throw', '5', '3', '', 90),
        e('Bench press', '4', '4', '', 150),
        e('Weighted pull-up', '4', '5', '', 120),
        e('Landmine press', '3', '8 each', '', 75),
      ] },
      { name: 'Lower Strength', ex: [
        e('Back squat', '5', '5', '', 180),
        e('Hip thrust', '4', '8', '', 90),
        e('Single-leg RDL', '3', '8 each', '', 75),
        e('Sled push', '4', '20 yd', '', 90),
      ] },
      { name: 'Upper Strength', ex: [
        e('Overhead press', '5', '5', '', 150),
        e('Barbell row', '4', '8', '', 90),
        e('Dip', '3', 'AMRAP', 'bodyweight', 90),
        e('Face pull', '3', '15', 'rope', 45),
      ] },
    ],
  },
  {
    name: 'Glutes and Core',
    goal: 'Hypertrophy', level: 'Beginner', days_per_week: 3, equipment: 'Full gym',
    description: 'Lower body focus with a core finisher on every day.',
    tags: ['glutes', 'core', 'lower body', 'booty'],
    days: [
      { name: 'Day 1', ex: [
        e('Hip thrust', '4', '10', '', 90),
        e('Romanian deadlift', '3', '10', '', 90),
        e('Cable kickback', '3', '15 each', '', 45),
        e('Dead bug', '3', '12 each', 'bodyweight', 45),
      ] },
      { name: 'Day 2', ex: [
        e('Goblet squat', '4', '12', '', 75),
        e('Reverse lunge', '3', '10 each', '', 75),
        e('Abduction machine', '3', '20', '', 45),
        e('Side plank', '3', '30 sec each', 'bodyweight', 45),
      ] },
      { name: 'Day 3', ex: [
        e('Sumo deadlift', '4', '8', '', 120),
        e('Step-up', '3', '12 each', '', 60),
        e('Frog pump', '3', '20', '', 45),
        e('Cable crunch', '3', '15', '', 45),
      ] },
    ],
  },
  {
    name: '30-Minute Express',
    goal: 'General fitness', level: 'Beginner', days_per_week: 3, equipment: 'Full gym',
    description: 'Four movements, short rest, in and out in half an hour. For members who say they have no time.',
    tags: ['short', 'express', 'busy', 'quick', '30 minutes'],
    days: [
      { name: 'Express A', ex: [
        e('Leg press', '3', '12', '', 45),
        e('Chest press machine', '3', '12', '', 45),
        e('Seated row', '3', '12', '', 45),
        e('Plank', '2', '45 sec', 'bodyweight', 30),
      ] },
      { name: 'Express B', ex: [
        e('Goblet squat', '3', '12', '', 45),
        e('Lat pulldown', '3', '12', '', 45),
        e('Dumbbell shoulder press', '3', '12', '', 45),
        e('Cable crunch', '2', '15', '', 30),
      ] },
      { name: 'Express C', ex: [
        e('Trap bar deadlift', '3', '10', '', 60),
        e('Incline dumbbell press', '3', '12', '', 45),
        e('Cable row', '3', '12', '', 45),
        e('Farmer carry', '2', '40 sec', '', 45),
      ] },
    ],
  },
  {
    name: 'Strength and Balance (55+)',
    goal: 'Healthy aging', level: 'Beginner', days_per_week: 2, equipment: 'Full gym',
    description: 'Supported movements and balance work. Everything can be done holding a rail.',
    tags: ['senior', 'older adult', 'balance', 'mobility', 'active aging', '55+'],
    days: [
      { name: 'Day 1', ex: [
        e('Sit to stand', '3', '10', 'bodyweight', 60, 'Use the chair behind you'),
        e('Chest press machine', '3', '12', 'light', 60),
        e('Seated row', '3', '12', 'light', 60),
        e('Heel to toe walk', '3', '20 steps', 'bodyweight', 45),
        e('Standing march', '2', '20', 'bodyweight', 45),
      ] },
      { name: 'Day 2', ex: [
        e('Leg press', '3', '12', 'light', 60),
        e('Lat pulldown', '3', '12', 'light', 60),
        e('Wall push-up', '3', '12', 'bodyweight', 45),
        e('Single leg stand', '3', '20 sec each', 'bodyweight', 45, 'Hold the rail'),
        e('Seated calf raise', '2', '15', '', 45),
      ] },
    ],
  },
  {
    name: 'Return to Training (Post-Rehab)',
    goal: 'Rehabilitation', level: 'Beginner', days_per_week: 3, equipment: 'Full gym',
    description: 'Low load, controlled tempo, no max effort. Only for members cleared by their provider.',
    tags: ['rehab', 'return to training', 'injury', 'post physical therapy', 'low impact'],
    days: [
      { name: 'Day 1', ex: [
        e('Leg press', '3', '15', 'very light', 75, 'Stop short of any pinch'),
        e('Chest press machine', '3', '15', 'light', 60),
        e('Band pull-apart', '3', '20', 'band', 45),
        e('Glute bridge', '3', '15', 'bodyweight', 45),
      ] },
      { name: 'Day 2', ex: [
        e('Step-up (low box)', '3', '10 each', 'bodyweight', 60),
        e('Seated row', '3', '15', 'light', 60),
        e('Wall sit', '3', '30 sec', 'bodyweight', 60),
        e('Dead bug', '3', '10 each', 'bodyweight', 45),
      ] },
      { name: 'Day 3', ex: [
        e('Goblet squat to box', '3', '12', 'light', 75),
        e('Lat pulldown', '3', '15', 'light', 60),
        e('Side-lying clamshell', '3', '15 each', 'band', 45),
        e('Bird dog', '3', '10 each', 'bodyweight', 45),
      ] },
    ],
  },
  {
    name: 'Kettlebell Conditioning',
    goal: 'Conditioning', level: 'Intermediate', days_per_week: 3, equipment: 'Kettlebells',
    description: 'One bell, three days. Builds work capacity without a treadmill.',
    tags: ['kettlebell', 'conditioning', 'cardio', 'work capacity'],
    days: [
      { name: 'Day 1', ex: [
        e('Kettlebell swing', '5', '20', '', 60),
        e('Goblet squat', '4', '12', '', 60),
        e('Kettlebell row', '4', '10 each', '', 45),
        e('Farmer carry', '4', '40 sec', '', 60),
      ] },
      { name: 'Day 2', ex: [
        e('Turkish get-up', '4', '3 each', '', 90, 'Slow, one piece at a time'),
        e('Kettlebell clean and press', '4', '6 each', '', 75),
        e('Kettlebell front squat', '4', '10', '', 75),
        e('Suitcase carry', '3', '40 sec each', '', 60),
      ] },
      { name: 'Day 3', ex: [
        e('Kettlebell snatch', '5', '8 each', '', 75),
        e('Single-leg deadlift', '4', '8 each', '', 60),
        e('Push press', '4', '8 each', '', 60),
        e('Halo', '3', '10 each', '', 45),
      ] },
    ],
  },
  {
    name: 'Powerlifting Peak',
    goal: 'Strength', level: 'Advanced', days_per_week: 4, equipment: 'Barbell',
    description: 'Heavy singles and doubles with accessory work. For a member with a meet on the calendar.',
    tags: ['powerlifting', 'meet prep', 'peaking', 'squat bench deadlift', 'advanced'],
    days: [
      { name: 'Squat Day', ex: [
        e('Back squat', '5', '2', '85-90%', 240),
        e('Pause squat', '3', '3', '70%', 180),
        e('Leg press', '3', '10', '', 90),
        e('Hanging knee raise', '3', '12', 'bodyweight', 60),
      ] },
      { name: 'Bench Day', ex: [
        e('Bench press', '5', '2', '85-90%', 240),
        e('Close-grip bench', '3', '5', '70%', 150),
        e('Barbell row', '4', '8', '', 90),
        e('Triceps pushdown', '3', '12', '', 45),
      ] },
      { name: 'Deadlift Day', ex: [
        e('Deadlift', '4', '2', '85-90%', 300),
        e('Deficit deadlift', '3', '3', '70%', 180),
        e('Hip thrust', '3', '10', '', 90),
        e('Back extension', '3', '12', '', 60),
      ] },
      { name: 'Accessory Day', ex: [
        e('Front squat', '4', '6', '', 120),
        e('Overhead press', '4', '6', '', 120),
        e('Chest-supported row', '4', '10', '', 75),
        e('Face pull', '3', '20', 'rope', 45),
      ] },
    ],
  },
]

async function upsertTemplate(t) {
  // Replace by name: editing this file and re-running is how the library is
  // updated, and days/exercises cascade on delete.
  const { data: existing } = await supabaseAdmin
    .from('memberapp_program_templates')
    .select('id').eq('name', t.name).maybeSingle()

  if (existing) {
    await supabaseAdmin.from('memberapp_program_templates').delete().eq('id', existing.id)
  }

  const { data: tpl, error } = await supabaseAdmin
    .from('memberapp_program_templates')
    .insert({
      name: t.name, goal: t.goal, level: t.level,
      days_per_week: t.days_per_week, equipment: t.equipment,
      description: t.description, tags: t.tags, created_by: 'seed',
    })
    .select().single()
  if (error) throw new Error(`${t.name}: ${error.message}`)

  const dayRows = t.days.map((d, i) => ({ template_id: tpl.id, position: i, name: d.name }))
  const { data: days, error: dayError } = await supabaseAdmin
    .from('memberapp_template_days').insert(dayRows).select('id, position')
  if (dayError) throw new Error(`${t.name} days: ${dayError.message}`)

  const byPosition = new Map(days.map(d => [d.position, d.id]))
  const exRows = []
  t.days.forEach((d, i) => {
    d.ex.forEach((ex, j) => exRows.push({ ...ex, day_id: byPosition.get(i), position: j }))
  })
  const { error: exError } = await supabaseAdmin.from('memberapp_template_exercises').insert(exRows)
  if (exError) throw new Error(`${t.name} exercises: ${exError.message}`)

  return { name: t.name, days: t.days.length, exercises: exRows.length }
}

async function main() {
  let exercises = 0
  for (const t of TEMPLATES) {
    const r = await upsertTemplate(t)
    exercises += r.exercises
    console.log(`  ${r.name} — ${r.days} days, ${r.exercises} exercises`)
  }
  console.log(`\n${TEMPLATES.length} templates, ${exercises} exercises.`)
}

main().catch((err) => { console.error(err.message); process.exit(1) })
