/**
 * Seed Help Center categories and articles.
 * Run: node auth/seed/seed-help-center.js
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in auth/.env
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const CATEGORIES = [
  { name: 'Getting Started', description: 'Portal basics and orientation', sort_order: 0, min_role: null },
  { name: 'Communication', description: 'Notes and team communication tools', sort_order: 1, min_role: null },
  { name: 'Performance', description: 'Leaderboard and tracking', sort_order: 2, min_role: null },
  { name: 'Management', description: 'Manager and lead tools', sort_order: 3, min_role: 'manager' },
  { name: 'Support', description: 'Tickets and getting help', sort_order: 4, min_role: null },
]

const ARTICLES = [
  // --- Getting Started ---
  {
    category: 'Getting Started',
    title: 'Portal Overview — Team Member Guide',
    min_role: null,
    body: `Welcome to the WCS Staff Portal! This is your one-stop hub for everything you need during your shift.

LOGGING IN
Open the Portal app on the kiosk computer or navigate to the portal URL. Enter your email and password. If this is your first time, your manager will have set up your account — ask them for your credentials.

HOME SCREEN LAYOUT
The home screen is split into two sections:

Apps (left side): Quick links to external tools you use daily — Grow (CRM), ABC Financial, WhenIWork (scheduling), Paychex (payroll), Gmail, and Google Drive.

Tools (right side): Built-in portal features — Tours Calendar, Day Ones Calendar, Leaderboard, Communication Notes, Help Center, and more.

USING APP TILES
Click any app tile to open it in a new tab. If your credentials are saved, you'll be logged in automatically. If not, enter your credentials and the portal will offer to save them for next time.

YOUR SCORE CARD
At the top of the Tools section, you'll see your personal score card showing your current rank, points, and recent achievements. This updates based on your Day One bookings, memberships, same-day sales, and VIPs.

NAVIGATION
Click any tool tile to open that feature. Use the "Back to Portal" button to return to the home screen. Your session stays active throughout your shift — no need to re-login.

NEED HELP?
Use the Help Center tile (this tool!) to find guides. For technical issues, use the Tickets tile to submit a support request.`
  },
  {
    category: 'Getting Started',
    title: 'Portal Overview — Manager Guide',
    min_role: 'manager',
    body: `As a manager, you have access to everything team members see plus additional management tools.

ADDITIONAL TOOLS
- HR Docs: Create and manage employee write-ups (verbal warnings, written warnings, terminations). Documents are generated as PDFs and uploaded to Paychex.
- Reporting: Club Health, Membership reports, PT/Day One reports with charts and data tables. Filter by location and date range.
- Trainer Availability: View and manage trainer schedules for the Day One calendar.
- Communication Notes: Review and manage all submitted notes from your team. Change statuses, add comments.
- Admin Panel (admin role): Full system configuration including staff accounts, tiles, roles, and integrations.

LOCATION SCOPING
As a manager, you see data for your assigned location only. Corporate and admin roles can switch between all locations using the location selector.

MANAGING YOUR TEAM
Use the Leaderboard to track team performance. The "All Locations" view (corporate+) lets you compare clubs. Use Communication Notes to stay on top of member issues and team updates.

REPORTING
Open Reporting from the Tools section. Select your date range, choose a report tab (Club Health, Membership, PT/Day One), and review the data. Export to CSV or print to PDF using the buttons at the top of each report.`
  },

  // --- Communication ---
  {
    category: 'Communication',
    title: 'Communication Notes — Team Member Guide',
    min_role: null,
    body: `Communication Notes let you log important information for your managers and team leads to review.

SUBMITTING A NOTE
1. Click the "Comm Notes" tile on the home screen
2. You'll see the submission form with these fields:
   - Title: A brief summary (e.g., "Member billing question")
   - Category: Choose from Member, Billing, Cancel, Equipment, or Other
   - Message: Describe the situation in detail
   - For "Member" category notes, you can optionally add the member's name and phone number
3. Click "Submit" to send the note

WHEN TO SUBMIT A NOTE
- A member has a question you can't answer
- Equipment is broken or needs attention
- A billing issue comes up
- A member wants to cancel or has a complaint
- Anything your manager should know about

TIPS
- Be specific in your description — include member names, times, and what happened
- Choose the right category so your manager can prioritize
- Don't wait until end of shift — submit notes as things happen
- You'll see a confirmation when your note is submitted successfully`
  },
  {
    category: 'Communication',
    title: 'Communication Notes — Manager Guide',
    min_role: 'manager',
    body: `As a manager, you have full access to review and manage all communication notes submitted by your team.

VIEWING NOTES
1. Click "Comm Notes" from the Tools section
2. Notes are organized by status: Unresolved, In Progress, and Completed
3. The badge on the tile shows how many unresolved notes are waiting

FILTERING
- Filter by status tab (Unresolved / In Progress / Completed)
- Filter by category (Member, Billing, Cancel, Equipment, Other)
- Filter by date range
- Corporate/admin can filter across all locations

MANAGING NOTES
- Click on a note to expand it and see full details
- Use the status dropdown to change a note's status:
  - Unresolved → In Progress (you're working on it)
  - In Progress → Completed (resolved)
- Add comments to notes to document your follow-up actions
- The system tracks who completed each note and when

BEST PRACTICES
- Check notes at the start of each shift
- Move notes to "In Progress" when you start working on them so other managers know
- Add a comment explaining the resolution before marking as Completed
- Use the category filters to prioritize — Cancel and Billing notes often need same-day attention`
  },

  // --- Performance ---
  {
    category: 'Performance',
    title: 'Leaderboard — How Rankings Work',
    min_role: null,
    body: `The Leaderboard tracks your performance and ranks you against your teammates each month.

HOW POINTS ARE SCORED
- Day One Bookings: 10 points each
- Memberships: 5 points each
- Same-Day Sales: 5 points each
- VIPs Submitted: 2 points each

VIEWING THE LEADERBOARD
1. Click the "Leaderboard" tile on the home screen
2. Your current rank is highlighted in red
3. Top 3 performers get gold, silver, and bronze badges
4. Use the month picker at the top to view past months
5. Quick views: 7-day, 30-day, 90-day, or full month

YOUR SCORE CARD
The score card at the top of the portal home shows your:
- Current rank and total points
- Breakdown by category (bookings, memberships, sales, VIPs)
- A motivational message based on your performance

TIPS FOR CLIMBING THE RANKS
- Focus on Day One bookings — they're worth the most points (10 each)
- Every membership and same-day sale counts
- Log VIPs consistently — they're easy points at 2 each
- Check the leaderboard daily to see where you stand`
  },

  // --- Management ---
  {
    category: 'Management',
    title: 'HR Documents — Creating Write-Ups',
    min_role: 'manager',
    body: `The HR Docs tile lets you create employee write-ups that are automatically formatted as PDFs and uploaded to Paychex.

CREATING A DOCUMENT
1. Click "HR Docs" from the Tools section
2. Click "Submit Document"
3. Select the employee from the Paychex employee list (search by name)
4. Fill in the form:
   - Document Type: Verbal Warning, Written Warning, or Termination
   - Reason: Brief summary (e.g., "Late to shift", "No call no show")
   - Description: Detailed account of the incident
   - Manager Signature: Sign using the signature pad (required)
   - Employee Signature: Have the employee sign if present (optional)
5. Click "Preview" to review the document
6. Click "Submit & Send to Paychex" to finalize

WHAT HAPPENS AFTER SUBMISSION
- The document is saved to the portal database
- A PDF is generated with the WCS logo, location, and all details
- The PDF is automatically uploaded to the employee's Paychex profile
- The document appears in "View Documents" for future reference

VIEWING EXISTING DOCUMENTS
1. Click "View Documents" from the HR Docs landing page
2. Select an employee from the list
3. See all documents filed against that employee (both portal write-ups and Paychex documents)
4. Click any document to expand and view the full details

IMPORTANT
- All documents are location-scoped — you only see employees at your location
- Corporate and admin can view all locations
- Documents cannot be edited after submission — create a new one if needed`
  },
  {
    category: 'Management',
    title: 'Trainer Availability — Managing Schedules',
    min_role: 'lead',
    body: `The Trainer Availability tool lets leads and managers manage trainer schedules for the Day One calendar in GoHighLevel.

VIEWING SCHEDULES
1. Click "Availability" from the Tools section
2. You'll see a card for each trainer at your location
3. Each card shows the trainer's name, email, and their weekly schedule

EDITING A SCHEDULE
1. Find the trainer's card
2. Toggle days on/off using the day buttons (Mon–Sun)
3. For each enabled day, set the start and end times using the time pickers
4. Click "Save" on that trainer's card
5. You'll see a "Saved" confirmation when the changes are pushed to GHL

HOW IT WORKS
- Schedules are synced with the "Day One" round-robin calendar in GoHighLevel
- When you update a trainer's availability here, it updates their open hours in GHL
- Members booking Day One appointments will only see available time slots based on these schedules

WHO CAN USE THIS
- PT Leads can see and edit trainers at their own location
- Managers can see and edit trainers at their location
- Admin can switch between all locations`
  },

  // --- Support ---
  {
    category: 'Support',
    title: 'Tickets & Support — How to Get Help',
    min_role: null,
    body: `If you run into a technical issue, need something fixed, or have a request for the portal, use the Tickets tile.

SUBMITTING A TICKET
1. Click the "Tickets" tile from the Tools section
2. Describe your issue clearly:
   - What were you trying to do?
   - What happened instead?
   - Include any error messages you see
3. Submit the ticket

WHAT TO SUBMIT TICKETS FOR
- Portal not loading or showing errors
- App tiles not opening or login issues
- Missing features or things that look broken
- Requests for new tiles, tools, or changes
- Equipment issues (computers, tablets, printers)
- Account access problems (locked out, wrong permissions)

TIPS FOR FASTER RESOLUTION
- Be specific — "the portal is broken" is harder to fix than "the Leaderboard shows 0 points for April even though I have bookings"
- Include the time the issue happened
- Mention which location and which computer/device
- If you see an error message, include the exact text

FOR MANAGERS
If your team reports an issue, check if it's a user error first (wrong login, browser cache, etc.) before submitting a ticket. Common fixes:
- Clear browser cache / hard refresh (Ctrl+Shift+R)
- Try a different browser
- Check if the issue is happening for everyone or just one person
- Restart the kiosk app if it's frozen`
  },
]

async function seed() {
  console.log('Seeding Help Center...')

  // Insert categories
  for (const cat of CATEGORIES) {
    const { error } = await supabase
      .from('help_categories')
      .upsert(cat, { onConflict: 'name' })
    if (error) console.error(`Failed to insert category "${cat.name}":`, error.message)
    else console.log(`  Category: ${cat.name}`)
  }

  // Fetch category IDs
  const { data: cats } = await supabase.from('help_categories').select('id, name')
  const catMap = Object.fromEntries((cats || []).map(c => [c.name, c.id]))

  // Insert articles
  for (const article of ARTICLES) {
    const categoryId = catMap[article.category]
    if (!categoryId) {
      console.error(`  Category not found: ${article.category}`)
      continue
    }

    // Check if article already exists
    const { data: existing } = await supabase
      .from('help_articles')
      .select('id')
      .eq('title', article.title)
      .maybeSingle()

    if (existing) {
      // Update
      const { error } = await supabase
        .from('help_articles')
        .update({ body: article.body, category_id: categoryId, min_role: article.min_role || null, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      if (error) console.error(`  Failed to update "${article.title}":`, error.message)
      else console.log(`  Updated: ${article.title}`)
    } else {
      // Insert
      const { error } = await supabase
        .from('help_articles')
        .insert({ title: article.title, body: article.body, category_id: categoryId, min_role: article.min_role || null, sort_order: 0 })
      if (error) console.error(`  Failed to insert "${article.title}":`, error.message)
      else console.log(`  Created: ${article.title}`)
    }
  }

  console.log('Done!')
}

seed().catch(err => { console.error(err); process.exit(1) })
