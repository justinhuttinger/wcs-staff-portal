#!/usr/bin/env node
/**
 * Seed the WCS template library for Coaching (migration 239).
 *
 *   node auth/scripts/seed-program-templates.js
 *
 * Run AFTER the exercise library seed (scripts/seed-exercise-library.js):
 * every exercise below is placed on a memberapp_exercises row, by name
 * (exerciseLibrary nameKey), through ALIASES where free-exercise-db spells it
 * differently, or as a WCS custom exercise from CUSTOMS. The script stops and
 * lists any name it cannot place before writing any template.
 *
 * Idempotent by template name among WCS-library templates (kind = 'template',
 * owner_staff_id null): an existing one keeps its id (so "clients using" and
 * client copies stay linked) and has its days and exercises replaced. Trainer
 * templates and anything not named here are untouched.
 *
 * Prescriptions are free text on purpose ("8-10", "AMRAP", "bodyweight");
 * sets and rest_seconds are numbers because the app counts them.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { normaliseTree, planTreeDiff } = require('../src/lib/coachingPrograms')
const { applyTreePlan } = require('../src/lib/coachingWrite')
const { resolveExercises, templateTree } = require('../src/lib/templateSeed')

// Template name -> free-exercise-db name (dist/exercises.json at the pinned
// sha), for movements it spells differently.
const ALIASES = {
  'Chest press machine': 'Machine Bench Press',
  'Seated row': 'Seated Cable Rows',
  'Cable row': 'Seated Cable Rows',
  'Lat pulldown': 'Wide-Grip Lat Pulldown',
  'Dumbbell curl': 'Dumbbell Bicep Curl',
  'Push-up': 'Pushups',
  'Walking lunge': 'Bodyweight Walking Lunge',
  'Farmer carry': "Farmer's Walk",
  'Dumbbell farmer carry': "Farmer's Walk",
  'Bench press': 'Barbell Bench Press - Medium Grip',
  'Bent-over row': 'Bent Over Barbell Row',
  'Barbell row': 'Bent Over Barbell Row',
  'Overhead press': 'Standing Military Press',
  'Back squat': 'Barbell Squat',
  'Chest-supported row': 'Dumbbell Incline Row',
  'Lateral raise': 'Side Lateral Raise',
  'Dumbbell lateral raise': 'Side Lateral Raise',
  'Cable curl': 'Standing Biceps Cable Curl',
  'Deadlift': 'Barbell Deadlift',
  'Front squat': 'Front Barbell Squat',
  'Leg curl': 'Lying Leg Curls',
  'Overhead triceps extension': 'Cable Rope Overhead Triceps Extension',
  'Pull-up': 'Pullups',
  'Rear delt fly': 'Reverse Flyes',
  'Calf raise': 'Standing Calf Raises',
  'Cable fly': 'Cable Crossover',
  'Rope pushdown': 'Triceps Pushdown - Rope Attachment',
  'Dumbbell row': 'One-Arm Dumbbell Row',
  'Dumbbell press': 'Dumbbell Bench Press',
  'Battle rope': 'Battling Ropes',
  'Bicycle crunch': 'Air Bike',
  'Dumbbell goblet squat': 'Goblet Squat',
  'Dumbbell Romanian deadlift': 'Stiff-Legged Dumbbell Deadlift',
  'Dumbbell pullover': 'Bent-Arm Dumbbell Pullover',
  'Dumbbell split squat': 'Split Squat with Dumbbells',
  'Air squat': 'Bodyweight Squat',
  'Glute bridge': 'Butt Lift (Bridge)',
  'Side plank': 'Side Bridge',
  'Squat jump': 'Freehand Jump Squat',
  'Box jump': 'Front Box Jump',
  'Nordic curl': 'Natural Glute Ham Raise',
  'Medicine ball chest throw': 'Medicine Ball Chest Pass',
  'Weighted pull-up': 'Weighted Pull Ups',
  'Hip thrust': 'Barbell Hip Thrust',
  'Single-leg deadlift': 'Kettlebell One-Legged Deadlift',
  'Dip': 'Dips - Triceps Version',
  'Cable kickback': 'One-Legged Cable Kickback',
  'Abduction machine': 'Thigh Abductor',
  'Kettlebell row': 'One-Arm Kettlebell Row',
  'Turkish get-up': 'Kettlebell Turkish Get-Up (Squat style)',
  'Kettlebell snatch': 'One-Arm Kettlebell Snatch',
  'Halo': 'Kettlebell Halo',
  'Close-grip bench': 'Close-Grip Barbell Bench Press',
  'Back extension': 'Hyperextensions (Back Extensions)',
}

// Movements free-exercise-db does not have (or only as a different
// variation): added once as WCS custom exercises. primary must be one of
// exerciseLibrary MUSCLES, because volume per muscle counts on it.
const CUSTOMS = {
  'Hanging knee raise': { primary: 'abdominals', equipment: 'body only' },
  'Bulgarian split squat': { primary: 'quadriceps', secondary: ['glutes', 'hamstrings'], equipment: 'dumbbell' },
  'Kettlebell swing': { primary: 'glutes', secondary: ['hamstrings', 'lower back'], equipment: 'kettlebells' },
  'Reverse lunge': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'body only' },
  'Step-up': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'body only' },
  'Step-up (low box)': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'body only' },
  'Dumbbell hip thrust': { primary: 'glutes', secondary: ['hamstrings'], equipment: 'dumbbell' },
  'Pike push-up': { primary: 'shoulders', secondary: ['triceps'], equipment: 'body only' },
  'Hollow hold': { primary: 'abdominals', equipment: 'body only' },
  'Landmine press': { primary: 'shoulders', secondary: ['chest', 'triceps'], equipment: 'barbell' },
  'Single-leg RDL': { primary: 'hamstrings', secondary: ['glutes'], equipment: 'dumbbell' },
  'Frog pump': { primary: 'glutes', equipment: 'body only' },
  'Sit to stand': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'body only' },
  'Heel to toe walk': { primary: 'calves', equipment: 'body only' },
  'Standing march': { primary: 'quadriceps', secondary: ['abdominals'], equipment: 'body only' },
  'Wall push-up': { primary: 'chest', secondary: ['triceps'], equipment: 'body only' },
  'Single leg stand': { primary: 'calves', secondary: ['glutes'], equipment: 'body only' },
  'Wall sit': { primary: 'quadriceps', equipment: 'body only' },
  'Goblet squat to box': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'kettlebells' },
  'Side-lying clamshell': { primary: 'abductors', secondary: ['glutes'], equipment: 'bands' },
  'Bird dog': { primary: 'lower back', secondary: ['abdominals', 'glutes'], equipment: 'body only' },
  'Kettlebell clean and press': { primary: 'shoulders', secondary: ['glutes', 'triceps'], equipment: 'kettlebells' },
  'Kettlebell front squat': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'kettlebells' },
  'Suitcase carry': { primary: 'abdominals', secondary: ['forearms'], equipment: 'kettlebells' },
  'Pause squat': { primary: 'quadriceps', secondary: ['glutes'], equipment: 'barbell' },
}

// Shorthand so the library below stays readable:
//   e(name, sets, reps, weight, rest, note, section)
// section defaults to 'workout'; templateTree puts warm-ups first and
// cool-downs last whatever order they are listed in.
const e = (name, sets, reps, weight, rest, note, section) =>
  ({ name, sets, reps, weight, rest_seconds: rest, notes: note || null, section: section || 'workout' })

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
    description: 'Six sessions: a heavy pass and a volume pass through push, pull and legs.',
    tags: ['ppl', 'push pull legs', 'six day', 'advanced', 'muscle'],
    days: [
      { name: 'Push (Heavy)', ex: [
        e('Bench press', '4', '6', '', 150),
        e('Overhead press', '3', '8', '', 120),
        e('Incline dumbbell press', '3', '10', '', 90),
        e('Lateral raise', '4', '15', 'light', 45),
        e('Overhead triceps extension', '3', '12', '', 60),
      ] },
      { name: 'Pull (Heavy)', ex: [
        e('Pull-up', '4', 'AMRAP', 'bodyweight', 120),
        e('Barbell row', '4', '8', '', 90),
        e('Cable row', '3', '12', '', 75),
        e('Rear delt fly', '3', '15', 'light', 45),
        e('Barbell curl', '3', '10', '', 60),
      ] },
      { name: 'Legs (Heavy)', ex: [
        e('Back squat', '4', '6-8', '', 150),
        e('Romanian deadlift', '3', '10', '', 120),
        e('Bulgarian split squat', '3', '10 each', '', 90),
        e('Leg curl', '3', '12', '', 60),
        e('Calf raise', '4', '15', '', 45),
      ] },
      { name: 'Push (Volume)', ex: [
        e('Incline dumbbell press', '4', '10-12', '', 90),
        e('Chest press machine', '3', '12', '', 75),
        e('Dumbbell shoulder press', '3', '12', '', 75),
        e('Cable fly', '3', '15', '', 45),
        e('Rope pushdown', '3', '15', '', 45),
      ] },
      { name: 'Pull (Volume)', ex: [
        e('Lat pulldown', '4', '12', '', 75),
        e('Chest-supported row', '4', '12', '', 75),
        e('Straight-arm pulldown', '3', '15', '', 45),
        e('Face pull', '3', '20', 'rope', 45),
        e('Hammer curl', '3', '12', '', 45),
      ] },
      { name: 'Legs (Volume)', ex: [
        e('Front squat', '4', '8', '', 120),
        e('Leg press', '4', '12', '', 90),
        e('Walking lunge', '3', '12 each', '', 75),
        e('Leg extension', '3', '15', '', 45),
        e('Seated calf raise', '4', '20', '', 45),
      ] },
    ],
  },
  {
    name: 'Strength 5x5',
    goal: 'Strength', level: 'Intermediate', days_per_week: 3, equipment: 'Barbell',
    description: 'Three sessions a week alternating two workouts. Add weight every session until it stops moving.',
    tags: ['5x5', 'strength', 'barbell', 'linear progression', 'powerlifting'],
    days: [
      { name: 'Session 1 (A)', ex: [
        e('Back squat', '5', '5', '', 180),
        e('Bench press', '5', '5', '', 180),
        e('Barbell row', '5', '5', '', 150),
      ] },
      { name: 'Session 2 (B)', ex: [
        e('Back squat', '5', '5', '', 180),
        e('Overhead press', '5', '5', '', 180),
        e('Deadlift', '1', '5', '', 240, 'One heavy set is enough'),
      ] },
      { name: 'Session 3 (A)', ex: [
        e('Back squat', '5', '5', '', 180),
        e('Bench press', '5', '5', '', 180),
        e('Barbell row', '5', '5', '', 150),
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
        e('Standing march', '2', '20', 'bodyweight', 45, 'Easy pace to warm up', 'warmup'),
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

// One block per session, always. A template with fewer blocks than sessions
// leaves a member unable to tell whether they owe another round of one, which
// is exactly the confusion this guard exists to prevent.
function assertOneBlockPerSession() {
  const bad = TEMPLATES.filter(t => t.days_per_week && t.days_per_week !== t.days.length)
  if (bad.length === 0) return
  const lines = bad.map(t => `  ${t.name}: ${t.days.length} blocks but ${t.days_per_week} sessions/week`)
  throw new Error(`Templates must have one block per session:\n${lines.join('\n')}`)
}

async function loadLibrary(db) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('memberapp_exercises').select('id, name, name_key, source')
      .eq('is_active', true).order('id').range(from, from + 999)
    if (error) throw new Error(`exercise library: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < 1000) return rows
  }
}

async function resolveAll(db) {
  const names = TEMPLATES.flatMap(t => t.days.flatMap(d => d.ex.map(x => x.name)))
  const library = await loadLibrary(db)
  const { byName, create, missing } = resolveExercises(names, library, { aliases: ALIASES, customs: CUSTOMS })
  if (missing.length) throw new Error(`Cannot place these exercises:\n  ${missing.join('\n  ')}`)
  if (create.length) {
    const { data, error } = await db.from('memberapp_exercises').insert(create).select('id, name')
    if (error) throw new Error(`custom exercises: ${error.message}`)
    for (const row of data || []) byName.set(row.name, row.id)
    console.log(`  added ${create.length} WCS custom exercises`)
  }
  return byName
}

async function upsertTemplate(db, t, idByName) {
  const { tree, error } = normaliseTree(templateTree(t, idByName))
  if (error) throw new Error(`${t.name}: ${error}`)
  const exercises = tree.days.reduce((n, d) => n + d.items.length, 0)

  const { data: existing, error: findErr } = await db
    .from('memberapp_programs').select('id')
    .eq('kind', 'template').is('owner_staff_id', null).eq('name', t.name)
    .order('created_at').limit(1).maybeSingle()
  if (findErr) throw new Error(`${t.name}: ${findErr.message}`)

  const fields = { ...tree.program, starts_on: null, ends_on: null }
  let programId
  let stored = { days: [] }
  if (existing) {
    programId = existing.id
    const { error: upErr } = await db
      .from('memberapp_programs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', programId)
    if (upErr) throw new Error(`${t.name}: ${upErr.message}`)
    const { data: days } = await db.from('memberapp_program_days').select('id').eq('program_id', programId)
    const dayIds = (days || []).map(d => d.id)
    const { data: items } = dayIds.length
      ? await db.from('memberapp_program_items').select('id, day_id').in('day_id', dayIds)
      : { data: [] }
    stored = { days: dayIds.map(id => ({ id, items: (items || []).filter(i => i.day_id === id) })) }
  } else {
    const { data, error: insErr } = await db
      .from('memberapp_programs')
      .insert({ ...fields, kind: 'template', owner_staff_id: null, created_by: 'seed' })
      .select('id').single()
    if (insErr) throw new Error(`${t.name}: ${insErr.message}`)
    programId = data.id
  }

  // The seed carries no ids, so this replaces the days and items wholesale
  // while the template row (and its client links) stays put.
  await applyTreePlan(db, programId, planTreeDiff(stored, tree))
  return { name: t.name, days: tree.days.length, exercises, updated: Boolean(existing) }
}

async function main() {
  // Required here, not at the top, so tests can load TEMPLATES without env.
  const { supabaseAdmin } = require('../src/services/supabase')
  assertOneBlockPerSession()
  const idByName = await resolveAll(supabaseAdmin)
  let exercises = 0
  for (const t of TEMPLATES) {
    const r = await upsertTemplate(supabaseAdmin, t, idByName)
    exercises += r.exercises
    console.log(`  ${r.updated ? 'updated' : 'added'} ${r.name} — ${r.days} days, ${r.exercises} exercises`)
  }
  console.log(`\n${TEMPLATES.length} templates, ${exercises} exercises.`)
}

if (require.main === module) {
  main().catch((err) => { console.error(err.message); process.exit(1) })
}

module.exports = { TEMPLATES, ALIASES, CUSTOMS }
