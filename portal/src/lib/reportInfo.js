// Plain-English explanations of each report's filtering logic, surfaced via
// the info icon in the reports header. Keyed by the report `key` used in
// ReportingView.jsx. Adding/editing copy here updates the popover content
// without touching any report component.
//
// Each entry shape:
//   {
//     title:    string — popover heading (defaults to "About this report")
//     sections: [{ heading, body }]  body can be string or array of paragraphs
//     notes:    string[]   optional "good to know" caveats / gotchas
//   }
//
// Guidelines for writing copy:
// - Focus on WHO is in the report and WHO isn't.
// - Explain what each filter actually changes.
// - Skip implementation details (SQL, API endpoints, table names).
// - Aim for one-paragraph-per-section, manager-friendly language.

const REPORT_INFO = {
  'club-health': {
    title: 'Club Health',
    sections: [
      {
        heading: 'What this is',
        body:
          'A snapshot dashboard combining the headline numbers from several other reports — new memberships, VIP appointments, day ones, PT activity — for the date range and location you choose.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — counts events that happened on those dates (sign date for memberships, appointment date for VIPs and day ones).',
          'Location — limits to one club, or shows totals across all clubs you have access to.',
        ],
      },
    ],
  },

  membership: {
    title: 'Membership Report',
    sections: [
      {
        heading: 'Who\'s in it',
        body:
          'Members whose membership SIGN DATE falls inside the date range you picked. We use ABC\'s sign_date field — the day the agreement was signed, not the day they first walked in.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — sign-date window. Memberships sold before the range or after it don\'t appear.',
          'Location — filtered to one club. Members are matched to a club by ABC\'s club_number.',
          'Search — filters the table only; the chart still reflects everyone in the range.',
        ],
      },
    ],
    notes: [
      'Only ACTIVE members in ABC are counted. Already-cancelled accounts are excluded even if they signed in the window.',
      'VIPs and Day Ones come from GHL appointments, not ABC, so they\'re counted by appointment date.',
    ],
  },

  cancels: {
    title: 'Cancels Report',
    sections: [
      {
        heading: 'Who\'s in it',
        body:
          'Members whose membership cancelled (status went inactive) during the date range. Counts the actual cancel date, not the day notice was given.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — looks at the cancel date.',
          'Location — filtered to one club.',
        ],
      },
    ],
  },

  pt: {
    title: 'Day One Report',
    sections: [
      {
        heading: 'What this is',
        body:
          'Day-One appointments — your trainer\'s first session with a new client. Sourced from GHL appointments tagged as Day One, not from ABC.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — counts Day Ones by their BOOKING date.',
          'Location — filtered to one GHL sub-account.',
        ],
      },
    ],
    notes: [
      'Status counts (Set / Show / Close) come from the GHL custom fields on the contact.',
    ],
  },

  'pt-roster': {
    title: 'PT Roster',
    sections: [
      {
        heading: 'Who\'s in it',
        body:
          'Every PT client currently on the books at a location — both monthly recurring agreements (with sessions remaining) and PIF (paid-in-full) packs with sessions left to burn.',
      },
      {
        heading: 'How filters work',
        body: [
          'Location — pick one club, or All Locations to see every roster at once.',
          'No date filter — this is always a real-time snapshot of who\'s active right now in ABC.',
        ],
      },
    ],
    notes: [
      'Members appear under the trainer they\'re assigned to in ABC. Reassign in ABC and they\'ll move on the next refresh.',
    ],
  },

  checkins: {
    title: 'Check-ins Report',
    sections: [
      {
        heading: 'What this is',
        body:
          'Member check-in counts aggregated by hour, day-of-week, and date — pulled from ABC\'s hourly check-in summaries.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — Pacific calendar days. Day boundaries are local club time, not UTC.',
          'Location — one club, or All Locations.',
        ],
      },
      {
        heading: 'What you get',
        body:
          'Total check-ins, peak day, peak hour, busiest/slowest hours, day-of-week breakdown, and a heatmap of hour × day-of-week.',
      },
    ],
  },

  'pt-sessions': {
    title: 'Trainer Load',
    sections: [
      {
        heading: 'Who\'s in it',
        body:
          'Every PT session that was completed or canceled-with-charge during the date range, grouped by trainer.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — by session date.',
          'Location — one club, or All Locations (if your role allows it).',
          'Event group — limits to PT only, swim only, stretch only, or all event types.',
          'Status — by default counts Completed + Canceled-Charge; you can change which statuses to include.',
        ],
      },
    ],
  },

  'pt-new-clients': {
    title: 'PT New Clients',
    sections: [
      {
        heading: 'Who\'s in it',
        body:
          'Members who BOUGHT a PT package during the date range — both monthly recurring agreements and PIF (paid in full) packs.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — by purchase (sale) date.',
          'Location — one club, or All Locations.',
        ],
      },
      {
        heading: 'New Client vs Resign',
        body:
          'A purchase is a "New Client" if the member had no PT in the prior 90 days. Otherwise it\'s a "Resign" — they had PT recently and are buying again.',
      },
    ],
  },

  'session-frequency': {
    title: 'Session Frequency',
    sections: [
      {
        heading: 'What this is',
        body:
          'Average sessions per active PT client per week. Higher numbers mean clients are using their sessions consistently.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — sessions counted in this window.',
          'Location — one club.',
          'Trainer — optionally narrow to one trainer\'s clients.',
        ],
      },
    ],
  },

  'deactivated-pt': {
    title: 'Deactivated PT',
    sections: [
      {
        heading: 'Two flavors of PT churn',
        body: [
          'Deactivated RS — a recurring PT agreement whose status changed to anything other than active during the window (cancelled, expired, terminated, frozen, etc.).',
          'PIF Burned — a member with one or more paid-in-full PT packages whose sessions are now exhausted AND who has no other active PT agreement.',
        ],
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — when the deactivation happened (for RS) or when the last session was used (for PIF Burned).',
          'Location — one club, or All Locations.',
        ],
      },
    ],
    notes: [
      'PIF Burned requires the member to have ZERO sessions left AND no different active PT agreement. So if they\'re still on a monthly PT, they\'re not flagged as burned.',
    ],
  },

  'pt-health': {
    title: 'PT Health',
    sections: [
      {
        heading: 'What this is',
        body:
          'Overview dashboard combining Day Ones, New PT sales, and Deactivated PT into one set of numbers + a per-location breakdown.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — applies to all three sub-reports.',
          'Location — one club, or All Locations.',
        ],
      },
      {
        heading: 'Net Clients / Net Revenue',
        body:
          'Net Clients = New PT clients minus Deactivated PT in the window. Net Revenue = New PT revenue minus the value of deactivated agreements.',
      },
    ],
  },

  payroll: {
    title: 'Payroll',
    sections: [
      {
        heading: 'What this is',
        body:
          'Monthly commission totals per employee — both sales commissions (from the CSV ABC emails monthly) and recurring-service commissions (4% of total contract value on PT sales in the month).',
      },
      {
        heading: 'How filters work',
        body: [
          'Month — picks which month\'s commissions to show.',
          'Location — one club.',
        ],
      },
    ],
    notes: [
      'Trainer session counts come from ABC\'s calendar events for the month, not from ABC\'s monthly CSV.',
    ],
  },

  revenue: {
    title: 'Revenue',
    sections: [
      {
        heading: 'What this is',
        body:
          'Dollars collected in ABC, broken out by profit center (dues, PT, drinks, snacks, etc.).',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — transactions posted on those dates.',
          'Location — one club.',
        ],
      },
    ],
  },

  operations: {
    title: 'Operational Compliance',
    sections: [
      {
        heading: 'What this is',
        body:
          'Operandio checklist completion rates per location for the current period and a comparison against the prior period.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — fixed (managed by Operandio\'s reporting cadence); the report uses the active period.',
          'Location — one club, or All Locations.',
        ],
      },
    ],
  },

  'meta-ads': {
    title: 'Meta Ads',
    sections: [
      {
        heading: 'What this is',
        body:
          'Facebook + Instagram ad performance — spend, impressions, clicks, leads, and ROAS.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — Meta\'s reporting window.',
          'Location — one club (matches the Meta ad account).',
        ],
      },
    ],
  },

  'google-marketing': {
    title: 'Google',
    sections: [
      {
        heading: 'What this is',
        body:
          'Google Business Profile insights (calls, direction requests, profile views) plus Google Analytics website metrics, in one view.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — Google\'s reporting window.',
          'Location — one club (matches the GBP profile and GA property).',
        ],
      },
    ],
  },

  kpis: {
    title: 'KPIs',
    sections: [
      {
        heading: 'What this is',
        body:
          'An experimental scoreboard that compares three club metrics against goals you set per club in the admin panel: trial conversion, day one booking rate, and VIP booking rate.',
      },
      {
        heading: 'How the percentages work',
        body: [
          'Trial Conversion is won trials divided by trials started, the same number shown on the Membership report.',
          'Day One Booking and VIP Booking are each divided by new members signed in the selected range.',
        ],
      },
      {
        heading: 'Trends',
        body:
          'Click any KPI to expand its last six months against the goal line. Months with no data show as gaps, not zeros.',
      },
    ],
    notes: [
      'All-locations view shows actuals only; goals are set per club.',
      'History only goes back as far as synced data exists.',
    ],
  },

  'website-submissions': {
    title: 'Website Submissions',
    sections: [
      {
        heading: 'What this is',
        body:
          'Every lead submitted through the public website forms, broken out by which form and which location they came in on.',
      },
      {
        heading: 'How filters work',
        body: [
          'Date range — by submission timestamp.',
          'Location — one club. The location is parsed from the form name (e.g. "Salem - VIP" → Salem).',
        ],
      },
    ],
  },
}

export function getReportInfo(reportKey) {
  if (!reportKey) return null
  return REPORT_INFO[reportKey] || null
}

export default REPORT_INFO
