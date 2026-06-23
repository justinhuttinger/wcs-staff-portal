'use strict'

function bool(v) {
  return v === 'Yes' || (Array.isArray(v) && v.includes('Yes'))
}

// Map a GHL PT-Intake webhook body to a normalized formData object.
function mapWebhookToFormData(body = {}) {
  return {
    // Trainer & program design
    trainerName: body['Service Employee'] || '',
    programGoal: body['Program Goal'] || 'general fitness',
    duration: String(body['Duration (Weeks)'] || body['Duration'] || 8).replace(' weeks', ''),
    daysPerWeek: String(body['Days Per Week'] || body['Days per Week'] || 4)
      .replace(' days a week', '').replace(' day a week', ''),
    experienceLevel: (body['Experience Level'] || 'intermediate').toLowerCase(),
    equipment: body['Equipment'] || 'full gym',

    // InBody metrics
    weight: body['Weight (Lbs)'] || body['Weight'] || '',
    height: body['Height'] || '',
    bodyFat: String(body['Body Fat (%)'] || body['Body Fat'] || '').replace('%', ''),
    bmr: body['BMR'] || '',

    // Movement limitations
    neckLimitation: bool(body['Neck Limitation']),
    shoulderLimitation: bool(body['Shoulder Limitation']),
    elbowWristLimitation: bool(body['Elbow Wrist Limitation']),
    lowerBackLimitation: bool(body['Lower Back Limitation']),
    hipLimitation: bool(body['Hip Limitation']),
    kneeLimitation: bool(body['Knee Limitation']),
    ankleLimitation: bool(body['Ankle Limitation']),
    otherLimitations: body['Other Limitations'] || '',

    // Client goals & interests
    interestedIn: body['What are you interested in?'] || '',
    interestedInPT: body['Are you interested in Personal Training?'] || '',
    preferredCoach: body['Do you have a Preferred Coach?'] || '',
    fitnessGoals: body['What are your Fitness Goals?'] || '',

    // Medical screening
    heartCondition: body['Has a Doctor Ever Said You Have a Heart Condition & Recommended Only Medically Supervised Activity?'] || '',
    chestPain: body['Do You Experience Chest Pain During Physical Activity?'] || '',
    boneJointProblem: body['Do You Have a Bone or Joint Problem that Physical Activity Could Aggravate?'] || '',
    bloodPressureMedication: body['Has Your Doctor Recommended Medication for your Blood Pressure?'] || '',
    medicalSupervisionNeeded: body['Are you Aware of Any Reason you Should Not Exercise Without Medical Supervision'] || '',

    // Current fitness & nutrition
    currentWorkoutRoutine: body['What is Your Current Workout Routine?'] || '',
    followsDietPlan: body['Do You Follow a Diet / Meal Plan?'] || '',
    biggestObstacles: body['What are your Biggest Obstacles?'] || '',
    wouldHelpMost: body['What Would Help You the Most?'] || '',

    // Additional info
    gender: body['Gender'] || body['contact.gender'] || '',
    trainerNotes: body['contact.pt_notes'] || body['PT Notes'] || '',

    // Day focus (optional overrides)
    day1Focus: body['Day 1 Focus'] || '',
    day2Focus: body['Day Two Focus'] || '',
    day3Focus: body['Day Three Focus'] || '',
    day4Focus: body['Day Four Focus'] || '',
    day5Focus: body['Day Five Focus'] || '',
    day6Focus: body['Day Six Focus'] || '',
    day7Focus: body['Day Seven Focus'] || '',
  }
}

module.exports = { mapWebhookToFormData }
