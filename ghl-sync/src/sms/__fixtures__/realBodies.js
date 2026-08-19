// Real outbound SMS bodies pulled from production on 2026-08-19 (one-day sample
// across all seven locations). These exist so the template fingerprint is tested
// against WCS's ACTUAL copy rather than invented examples — the first version of
// the normalizer passed hand-written tests and still produced 982 "templates"
// from 1,437 real messages, because it only stripped a merged first name when it
// followed "Hi/Hey/Hello".
//
// Each group is one real template. Every body inside a group MUST fingerprint
// identically; bodies in different groups MUST NOT collide.

// Bodies use real newlines, as GHL sends them.
const GROUPS = {
  // Opens "Hi <Name>!" then a blank line. The easy case.
  welcomeFamily: [
    'Hi Andrea!\n\nWelcome to the West Coast Strength Family! We are so happy to have you apart of our community!\n\nAs a member, you unlock incredible benefits, such as free personal training.',
    'Hi Erin!\n\nWelcome to the West Coast Strength Family! We are so happy to have you apart of our community!\n\nAs a member, you unlock incredible benefits, such as free personal training.',
    'Hi Cole!\n\nWelcome to the West Coast Strength Family! We are so happy to have you apart of our community!\n\nAs a member, you unlock incredible benefits, such as free personal training.',
  ],

  freeWeek: [
    'Hi Chris!\n\nWelcome to your free week at West Coast Strength! We are happy to have you here experiencing the best gym around, if you have any questions during your trial please feel free to ask.',
    'Hi Andrea!\n\nWelcome to your free week at West Coast Strength! We are happy to have you here experiencing the best gym around, if you have any questions during your trial please feel free to ask.',
  ],

  // Opens "<Name>, this is <Staff> from ..." — the staff name varies by employee
  // and must NOT split one template into one row per salesperson.
  freeTrialReady: [
    "Colleen, this is Kenny from West Coast Strength! I've got a free trial ready for you, no commitment, just come check the place out. When works for you to swing by?",
    "Angel, this is Kenny from West Coast Strength! I've got a free trial ready for you, no commitment, just come check the place out. When works for you to swing by?",
    "Laurel, this is Steve from West Coast Strength! I've got a free trial ready for you, no commitment, just come check the place out. When works for you to swing by?",
  ],

  // Opens "Hey <Name>," with a comma rather than a bang.
  triedCallingTour: [
    'Hey Angel, just tried calling! Wanted to get you scheduled for a tour and get your free trial activated. What day works best for you to swing by?',
    'Hey Dennis, just tried calling! Wanted to get you scheduled for a tour and get your free trial activated. What day works best for you to swing by?',
  ],

  trialCheckIn: [
    "Hey Colleen, tried calling to check in on your trial! Hope you've been enjoying it. I wanted to chat about next steps before it wraps up. Call or text me back when you can!",
    "Hey Chris, tried calling to check in on your trial! Hope you've been enjoying it. I wanted to chat about next steps before it wraps up. Call or text me back when you can!",
  ],

  // Opens with a BARE first name and a comma — no greeting word at all.
  // This is the pattern the original normalizer missed entirely.
  triedYouAgain: [
    "Vickie, tried you again. Your free trial is waiting whenever you're ready. I just need 15 minutes to show you around and get you set up. What's your schedule look like?",
    "Angel, tried you again. Your free trial is waiting whenever you're ready. I just need 15 minutes to show you around and get you set up. What's your schedule look like?",
    "Nicole, tried you again. Your free trial is waiting whenever you're ready. I just need 15 minutes to show you around and get you set up. What's your schedule look like?",
  ],

  // Opens with a BARE first name and an exclamation mark.
  personalWelcome: [
    'Michael! Just called to personally welcome you to West Coast Strength. You made a great decision. If you need anything at all getting started, questions about the gym, classes, whatever.',
    'Cole! Just called to personally welcome you to West Coast Strength. You made a great decision. If you need anything at all getting started, questions about the gym, classes, whatever.',
    'Hannah! Just called to personally welcome you to West Coast Strength. You made a great decision. If you need anything at all getting started, questions about the gym, classes, whatever.',
  ],

  // Emoji, embedded link, and "This is the team from" — deliberately a DIFFERENT
  // template from freeTrialReady even though both contain "this is ... from".
  medfordOpen: [
    "Hey Ann! This is the team from West Coast Strength Medford \u{1F4AA}\n\nWe're officially OPEN!\n\nCome check out the gym, meet the team, and get started. Here's the link to book a tour:\nhttps://link.wcs.com/a1b2c3",
    "Hey Angela! This is the team from West Coast Strength Medford \u{1F4AA}\n\nWe're officially OPEN!\n\nCome check out the gym, meet the team, and get started. Here's the link to book a tour:\nhttps://link.wcs.com/z9y8x7",
  ],

  paymentFailed: [
    "Hi Acacia! We noticed your recent payment wasn't successful. Please give us a call or stop by the front desk to get this taken care of \u{1F4AA}",
    "Hi Justin! We noticed your recent payment wasn't successful. Please give us a call or stop by the front desk to get this taken care of \u{1F4AA}",
  ],
}

module.exports = { GROUPS }
