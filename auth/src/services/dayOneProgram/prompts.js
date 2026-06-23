'use strict'

// Shared client-context preamble used by every parallel call.
function buildPreamble(contactData, formData) {
  const f = formData
  const limitations = []
  if (f.neckLimitation) limitations.push('Neck')
  if (f.shoulderLimitation) limitations.push('Shoulder')
  if (f.elbowWristLimitation) limitations.push('Elbow/Wrist')
  if (f.lowerBackLimitation) limitations.push('Lower Back')
  if (f.hipLimitation) limitations.push('Hip')
  if (f.kneeLimitation) limitations.push('Knee')
  if (f.ankleLimitation) limitations.push('Ankle')
  if (f.otherLimitations) limitations.push(`Other: ${f.otherLimitations}`)
  const limitationsText = limitations.length
    ? `MOVEMENT LIMITATIONS: ${limitations.join(', ')}. You MUST modify exercises to work around these limitations.`
    : 'No movement limitations reported.'

  const inbody = (f.weight || f.height || f.bodyFat || f.bmr)
    ? `INBODY METRICS: Weight: ${f.weight} lbs, Height: ${f.height} inches, Body Fat: ${f.bodyFat}%, BMR: ${f.bmr} calories/day`
    : ''

  const medical = []
  if (f.heartCondition && f.heartCondition !== 'No') medical.push(`Heart condition requiring medical supervision: ${f.heartCondition}`)
  if (f.chestPain && f.chestPain !== 'No') medical.push(`Chest pain during activity: ${f.chestPain}`)
  if (f.boneJointProblem && f.boneJointProblem !== 'No') medical.push(`Bone/joint concerns: ${f.boneJointProblem}`)
  if (f.bloodPressureMedication && f.bloodPressureMedication !== 'No') medical.push(`Blood pressure medication: ${f.bloodPressureMedication}`)
  if (f.medicalSupervisionNeeded && f.medicalSupervisionNeeded !== 'No') medical.push(`Other medical supervision needed: ${f.medicalSupervisionNeeded}`)
  const medicalText = medical.length
    ? `\nMEDICAL SCREENING ALERTS:\n- ${medical.join('\n- ')}\nIMPORTANT: Design a conservative program (moderate intensity, avoid high-impact, longer rest) that accounts for these.`
    : ''

  const ctx = []
  if (f.fitnessGoals) ctx.push(`Fitness Goals: ${f.fitnessGoals}`)
  if (f.currentWorkoutRoutine) ctx.push(`Current Routine: ${f.currentWorkoutRoutine}`)
  if (f.followsDietPlan) ctx.push(`Diet/Meal Plan: ${f.followsDietPlan}`)
  if (f.biggestObstacles) ctx.push(`Biggest Obstacles: ${f.biggestObstacles}`)
  if (f.wouldHelpMost) ctx.push(`What Would Help Most: ${f.wouldHelpMost}`)
  if (f.interestedIn) ctx.push(`Interests: ${f.interestedIn}`)
  const ctxText = ctx.length ? `\nCLIENT BACKGROUND:\n${ctx.join('\n')}` : ''

  const notesText = f.trainerNotes
    ? `\nTRAINER NOTES (IMPORTANT - use these to customize): ${f.trainerNotes}\nIncorporate these: include exercises the client loves, avoid ones they hate.`
    : ''

  return `CLIENT: ${contactData.firstName} ${contactData.lastName}
${f.gender ? `Gender: ${f.gender}` : ''}
Experience Level: ${f.experienceLevel}
Available Equipment: ${f.equipment}
Primary Goal: ${f.programGoal}
Program Length: ${f.duration} weeks, ${f.daysPerWeek} days/week
${inbody}
${ctxText}
${notesText}

${limitationsText}${medicalText}

RULES (apply to all output):
- If there are movement limitations, intelligently substitute safer variants (e.g. shoulder -> landmine/neutral-grip press; knee -> leg press/step-ups/belt squat; lower back -> hex-bar deadlift/hip thrust).
- NEVER mention or recommend consulting a physical therapist, doctor, physician, medical professional, or healthcare provider. Provide exercise modifications instead.
- Return ONLY valid JSON. No markdown code fences, no text before or after the JSON.`
}

// One workout day. Exercise order: hardest compounds first, finish all work for a
// muscle group before moving on, isolation last.
function buildDayPrompt(preamble, dayFocus, formData) {
  return `${preamble}

Create ONE workout day for this program.
DAY: ${dayFocus.day}
FOCUS: ${dayFocus.focus}

Requirements:
- Choose 5-6 specific, well-chosen exercises with sets and reps. Pick the BEST exercises for this focus, experience level, equipment, and any limitations - quality of selection matters.
- "notes": ONE short coaching cue, max ~12 words. Not a paragraph.
- "variations": 1-2 alternatives only, comma-separated.
- EXERCISE ORDER: most demanding compound lifts first (squats, deadlifts, presses, rows), then secondary compounds, then isolation. Complete ALL exercises for one muscle group before moving to the next (e.g. all back, THEN all biceps).
- Keep it concise: the whole day must fit on ONE printed page. Do not pad.
${formData.biggestObstacles ? `- Address their biggest obstacle: ${formData.biggestObstacles}` : ''}

Return ONLY this JSON object:
{
  "day": ${dayFocus.day},
  "title": "Workout name reflecting the focus",
  "focus": "Primary muscle groups / movement patterns",
  "exercises": [
    { "name": "Exercise name", "sets": "3", "reps": "8-10", "notes": "Short cue (max ~12 words)", "variations": "DB Press, Machine Press" }
  ]
}`
}

function buildOverviewPrompt(preamble, dayFocuses) {
  const split = dayFocuses.map(d => `Day ${d.day}: ${d.focus}`).join(', ')
  return `${preamble}

This program's training split is: ${split}.

Keep EVERY field concise - the whole overview must fit on ONE printed page. Each field is at most 2 short sentences. Do not pad or repeat.

Return ONLY this JSON object describing the program overview:
{
  "basicExplanation": "2 sentences: what this program is, the split used, how it helps reach the goal",
  "progressionNotes": "1-2 sentences: how to progress week to week (when to add weight/reps)",
  "principles": "1-2 sentences: the core training principles (e.g. progressive overload, compounds first)",
  "importantNotes": "1-2 sentences: warm-up, rest days, key safety reminder"
}`
}

// Terminology must stay relatable: only define terms actually used in the workouts.
function buildTerminologyPrompt(workouts) {
  const corpus = JSON.stringify(workouts)
  return `Below is the JSON of a training program's workouts.

${corpus}

Write a SHORT "terminology" glossary that defines ONLY the most important training terms that actually appear in the exercise names or notes above (e.g. superset, AMRAP, RPE, tempo, drop set). Rules:
- At most 5 terms, the ones a client is most likely not to know.
- Each on ONE line, format "Term: brief definition" with the definition under ~10 words.
- Do NOT define any term that is not present in the workouts. Do NOT pad. It must fit a small section.

Return ONLY this JSON object:
{ "terminology": "Term: definition\\nTerm: definition" }`
}

module.exports = { buildPreamble, buildDayPrompt, buildOverviewPrompt, buildTerminologyPrompt }
