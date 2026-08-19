// Real outbound SMS bodies pulled from production on 2026-08-19 (one-day sample
// across all seven locations). These exist so the template fingerprint is tested
// against WCS's ACTUAL copy rather than invented examples — the first version of
// the normalizer passed hand-written tests and still produced 982 "templates"
// from 1,450 real messages, because it only stripped a merged first name when it
// followed "Hi/Hey/Hello". A later rewrite fixed that (195 clusters) but
// over-merged in the other direction, pooling templates that only share a
// leading "Word[,!]" shape regardless of what that word was — see
// heyNameNoPunct, congrats/welcome, and lastChance/todayOnly below.
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

  // Includes a two-token merged name ("Lindsay Belle") alongside the plain
  // single-token sends — regression for the greeting branch only stripping
  // the greeting word plus ONE adjacent name token and leaving the second
  // name token to leak a per-recipient cluster.
  freeWeek: [
    'Hi Chris!\n\nWelcome to your free week at West Coast Strength! We are happy to have you here experiencing the best gym around, if you have any questions during your trial please feel free to ask.',
    'Hi Andrea!\n\nWelcome to your free week at West Coast Strength! We are happy to have you here experiencing the best gym around, if you have any questions during your trial please feel free to ask.',
    'Hi Lindsay Belle! Welcome to your free week at West Coast Strength! We are happy to have you here experiencing the best gym around, if you have any questions during your trial please feel free to ask.',
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

  // Includes a two-token merged name ("Lindsay Belle") — same regression as
  // freeWeek above, but exercising the comma-terminated greeting shape
  // ("Hey <Name>,") instead of the bang-terminated one.
  trialCheckIn: [
    "Hey Colleen, tried calling to check in on your trial! Hope you've been enjoying it. I wanted to chat about next steps before it wraps up. Call or text me back when you can!",
    "Hey Chris, tried calling to check in on your trial! Hope you've been enjoying it. I wanted to chat about next steps before it wraps up. Call or text me back when you can!",
    "Hey Lindsay Belle, tried calling to check in on your trial! Hope you've been enjoying it. I wanted to chat about next steps before it wraps up. Call or text me back when you can!",
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

  // Greeting word followed by a bare name with NO comma or bang at all — the
  // shape the punctuation-anchored rewrite missed entirely (it only stripped
  // a leading personalization ending in "," or "!"), reintroducing the
  // original per-recipient-cluster bug for this exact template.
  heyNameNoPunct: [
    'Hey Michael we tried calling you today, sorry we missed you! Give us a call back when you get a chance so we can find a time that works.',
    'Hey Sarah we tried calling you today, sorry we missed you! Give us a call back when you get a chance so we can find a time that works.',
    'Hey Devon we tried calling you today, sorry we missed you! Give us a call back when you get a chance so we can find a time that works.',
  ],

  // MUST NOT collide with congratsMember below: both are a single stoplisted
  // opener word followed by "!" and otherwise identical copy. A punctuation-
  // anchored rule that strips any capitalized word before "!" merges these
  // two different templates into one, producing wrong engagement numbers.
  // The second body is whitespace noise only (same template, sloppy send),
  // to also confirm collapsing still happens once the opener is preserved.
  congratsMember: [
    'Congrats! You are officially a member of West Coast Strength. We cannot wait to help you crush your goals.',
    'Congrats!  You are officially a member of West Coast Strength.   We cannot wait to help you crush your goals.',
  ],
  welcomeMember: [
    'Welcome! You are officially a member of West Coast Strength. We cannot wait to help you crush your goals.',
    'Welcome!  You are officially a member of West Coast Strength.   We cannot wait to help you crush your goals.',
  ],

  // MUST NOT collide with todayOnlySale below: same trailing copy, different
  // stoplisted two-word opener.
  lastChanceSale: [
    'Last chance! Our summer sale ends tonight. Lock in your rate before it disappears.',
    'Last chance!  Our summer sale ends tonight.   Lock in your rate before it disappears.',
  ],
  todayOnlySale: [
    'Today only! Our summer sale ends tonight. Lock in your rate before it disappears.',
    'Today only!  Our summer sale ends tonight.   Lock in your rate before it disappears.',
  ],

  // Multi-token merged name with a comma, no matching template among the
  // groups above (freeWeek/trialCheckIn cover the bang and comma shapes on
  // existing templates; this one pins a THIRD name token too, for a
  // three-word name, to prove the 1-to-3-token allowance).
  oneMoreTryMultiName: [
    "Hey Jon Michael, one more try! I don't want you to miss out on your free trial. Let me know when you want to come in!",
    "Hey Mary Kate, one more try! I don't want you to miss out on your free trial. Let me know when you want to come in!",
    "Hey Anna Marie Lee, one more try! I don't want you to miss out on your free trial. Let me know when you want to come in!",
  ],

  // The merged name sits at the END of the first clause, immediately before
  // "!", not at the start — no leading rule ever fires for these. Pins the
  // trailing-name-before-first-terminal-punctuation rule.
  tourBookingThanks: [
    'Thank you for booking a tour with us Joshua! We look forward to seeing you.',
    'Thank you for booking a tour with us Ector! We look forward to seeing you.',
  ],

  // Same trailing-name shape, and the name is sent ALL CAPS ("MATTHEW") for
  // one recipient — capitalization must be tested on the ORIGINAL body
  // before lowercasing so this still collides with the Title-Case send.
  happyBirthday: [
    'Happy Birthday MATTHEW! We are here to celebrate with you!',
    'Happy Birthday Josue! We are here to celebrate with you!',
  ],
}

module.exports = { GROUPS }
