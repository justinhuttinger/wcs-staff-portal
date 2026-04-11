# Staff Gamification & Leaderboard

## Overview

A point-based gamification system that ranks staff within their location based on monthly performance. Front desk staff compete against peers at their club; managers can compare across locations. Points reset on the 1st of each month.

## Point System (Hardcoded)

| Action | Points | Data Source |
|--------|--------|-------------|
| Day One Booked | 10 | `ghl_contacts_report.day_one_booking_team_member` where `day_one_booked = 'Yes'`, filtered by `day_one_booking_date` in month |
| Membership Sold | 5 | `ghl_contacts_report.sale_team_member`, filtered by `member_sign_date` in month |
| Same Day Sale | 5 | Bonus on top of membership — `same_day_sale = 'Sale'` on the same contact |
| VIP | 2 | `ghl_contacts_v2` with `"vip"` tag, `created_at_ghl` in month, attributed to `sale_team_member` via report view |
| Tour Logged | 2 | GHL Calendar API — "Gym Tour" calendar events, attributed by `assignedUserId` → staff email match |

A same-day membership sale = 10 pts total (5 membership + 5 same day bonus).

## Components

### 1. Home Page Score Card

Displayed on the portal home screen (desktop and mobile) for all logged-in staff.

**Location:** Below the header, above the tile grid.

**Content:**
- Staff first name + current month's total points (large number)
- Rank within their location: "3rd of 8"
- Point legend — compact row showing all 5 actions and their point values

**Data:** Uses the same leaderboard API endpoint, filtered to current user.

### 2. Leaderboard Tile

New tile in the Tools section with a trophy icon. Opens a full leaderboard view.

**Tile badge:** Shows the logged-in user's current rank (e.g. "3rd").

#### Leaderboard View

**Month navigation:** Left/right arrows + month label (e.g. "April 2026"). Same pattern as the calendar views. Cannot navigate past current month.

**Staff Leaderboard (all roles):**
- Table/list of all staff at the user's location, ranked by total points descending
- Each row: rank, name, total points, breakdown (memberships, day ones, same day, VIPs, tours)
- Top 3 get visual flair: gold (#FFD700), silver (#C0C0C0), bronze (#CD7F32) accent on rank
- Current user's row highlighted with a subtle background color
- Non-admins see only their own location

**Manager Cross-Location View (manager+ roles):**
- Toggle/tab to switch between "My Club" and "All Locations"
- "All Locations" shows each location ranked by total team points
- Each location row: rank, location name, total points, top performer name + their points
- Tapping a location could expand to show that club's individual leaderboard

### 3. API Endpoint

`GET /reports/leaderboard`

**Query params:**
- `month` (YYYY-MM, defaults to current month)
- `location_slug` (required for staff view; omit or "all" for cross-location manager view)

**Response:**
```json
{
  "month": "2026-04",
  "location": "salem",
  "rankings": [
    {
      "name": "Brooke Weaver",
      "points": 87,
      "memberships": 6,
      "day_ones": 3,
      "same_day": 2,
      "vips": 4,
      "tours": 5,
      "rank": 1
    }
  ],
  "user_rank": 3,
  "user_points": 52
}
```

For cross-location (manager view):
```json
{
  "month": "2026-04",
  "locations": [
    {
      "location": "Salem",
      "location_slug": "salem",
      "total_points": 342,
      "top_performer": "Brooke Weaver",
      "top_performer_points": 87,
      "staff_count": 8,
      "rank": 1
    }
  ]
}
```

**Auth:** Requires `front_desk` role or above. Cross-location data requires `manager` or above.

### 4. Data Aggregation Logic

All metrics except tours come from Supabase (already synced). Tours require a GHL Calendar API call.

**Date filtering:** Uses the same `dateToMs` helper with Pacific timezone offset for custom field dates. Month boundaries: 1st of month 00:00 PDT → last day of month 23:59:59 PDT.

**Staff name matching:** The `sale_team_member` and `day_one_booking_team_member` fields are free-text names from GHL. Tours use `assignedUserId` which maps to a GHL user email via the users API. Match tour attribution to staff by comparing GHL user email to staff email in the `staff` table.

**VIP attribution:** VIPs are counted by the `sale_team_member` on the contact (from the report view), filtered by `created_at_ghl` in month range.

**Caching:** Cache the leaderboard response for 5 minutes (same pattern as Meta Ads) to avoid repeated heavy queries.

### 5. Mobile Version

Same data, adapted layout:
- Score card on mobile home screen (compact, horizontal)
- Leaderboard opens as a full mobile view (bottom tab navigation stays visible)
- Staff cards instead of table rows
- Month navigation in header
- Manager toggle between "My Club" / "All Locations" as pills

### 6. Edge Cases

- **Staff with no activity:** Show at bottom with 0 points (still appear on leaderboard)
- **New month with no data:** Empty leaderboard with "No activity yet this month" message
- **Staff at multiple locations:** Points counted per-location based on which location the contact belongs to (via `location_slug` on the report view)
- **"Unassigned" entries:** Excluded from leaderboard (no staff to credit)
- **Past months:** Read-only historical view, no changes possible
