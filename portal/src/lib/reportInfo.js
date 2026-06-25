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
          'Plan type — All shows everything. Membership hides insurance plans. Insurance shows only insurance plans (any "A2" type or "Active and Fit" variant), which are non-dues-paying members.',
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

  'pt-projections': {
    title: 'PT Projections',
    sections: [
      {
        heading: 'What this is',
        body:
          'A forward look at recurring personal training revenue. For each active PT agreement it shows the next expected draft date and amount, totals the expected revenue per day, and compares the projection to PT revenue actually collected in the period.',
      },
      {
        heading: 'How the numbers split',
        body: [
          'Collected, the PT revenue already drafted in the date range.',
          'Outstanding, recurring drafts still scheduled to hit between today and the end of the range.',
          'Past-due, drafts whose scheduled date has already passed but have not been collected, a sign the payment may have declined or lapsed.',
          'Projected, the sum of collected plus outstanding plus past-due.',
        ],
      },
      {
        heading: 'How filters work',
        body: [
          'Date range, defaults to the current month. Outstanding and past-due are split relative to today.',
          'Location, one club or all clubs you have access to.',
        ],
      },
    ],
    notes: [
      'This is a point-in-time snapshot, refreshed every few minutes.',
      'Projected amounts come from each agreement\'s scheduled draft and may include tax or fees, so treat them as estimates.',
      'Collected dollars are matched to a member, not to a specific draft, so per-member Collected means the member has a training payment in the range.',
      'A member can show as Collected in the detail list while still counting toward Past-due in the summary if their next bill date has not advanced yet, for example a same-day draft or sync lag.',
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
          'An experimental scoreboard that compares club metrics against goals you set per club in the admin panel: trial conversion, day one attachment, VIP collection percentage, speed to lead, operational compliance, and Click2Save utilization.',
      },
      {
        heading: 'Operational Compliance',
        body:
          'Average of the daily Operandio overall scores in the selected range, the same math as the Operational Compliance report\'s period summary. Days with no Operandio data are skipped, not counted as zero.',
      },
      {
        heading: 'Click2Save Utilization',
        body:
          'Of the members whose cancellation took effect in the range, the share that went through Click2Save. Each cancelled member is matched to their Click2Save cancel request, which can be up to 90 days earlier since cancels sit in Pending Cancel until their effective date. Insurance plans (A2 / Active and Fit) are excluded since those don\'t cancel through Click2Save. Everyone should be cancelling through Click2Save, so low numbers mean staff are cancelling directly in ABC.',
      },
      {
        heading: 'Cleanliness - Quality Assessment',
        body:
          'QA-Cleaning audits submitted in Operandio by leadership, on an irregular (roughly monthly) cadence per club. Because audits are infrequent, this KPI ignores the date range: the value is each club\'s most recent audit score (averaged when multiple clubs are selected), and the trend plots a point for every submission rather than month buckets. The all-clubs table shows each club\'s latest score and when it was last audited. Expand the tile to see every submission with a View Report link that opens the full scored report in Operandio in a new window (an Operandio login is required to view it).',
      },
      {
        heading: 'How the percentages work',
        body: [
          'Trial Conversion is won trials divided by trials started, the same number shown on the Membership report.',
          'Day One Attachment and VIP Collection Percentage are each divided by new members signed in the selected range.',
        ],
      },
      {
        heading: 'Speed to Lead',
        body:
          'Median minutes from when a Membership-pipeline lead is created to the first human outbound contact (a manually-sent text or a call). Automated texts are ignored, so this reflects real staff response time. Lower is better; the goal is a maximum number of minutes.',
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
      'KPIs can be turned off per club in Admin → KPI Goals. An off club is hidden from that KPI in its own view and excluded from the blended number and per-club tables.',
    ],
  },

  audits: {
    title: 'Audits',
    sections: [
      {
        heading: 'What this is',
        body:
          'Every Operandio job with "Audit" in its name (PT Audit, Membership Coordinator Audit, ...), roughly one per club per department per month. One row per audit with its most recent score.',
      },
      {
        heading: 'How it works',
        body: [
          'Audits arrive automatically: when one is submitted in Operandio, its notification email is parsed and the audit appears here.',
          'Location pills — this report is strictly one club at a time; pick the club with the pills under the title.',
          'Click a row to expand the change-over-time chart and every submission, each with a View Report link that opens the full scored breakdown in a new window, printable to PDF.',
          'Audits are infrequent, so the full history always shows (no date range).',
          'Admin → Audits toggles which audits each club does — off audits are hidden from that club\'s view.',
        ],
      },
    ],
    notes: [
      'Experimental report. QA-Cleaning is not an audit — it\'s the hyper-specific job behind the Cleanliness - Quality Assessment KPI and is excluded here. Other scored jobs are collected in the background for future reporting.',
    ],
  },

}

export function getReportInfo(reportKey) {
  if (!reportKey) return null
  return REPORT_INFO[reportKey] || null
}

export default REPORT_INFO
