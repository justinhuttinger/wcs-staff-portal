# WCS Action1 Deployment Scripts

## chrome-lockdown.ps1

Writes Chrome enterprise policies to Windows Registry. Locks down browsing to approved URLs only, disables password saving, forces WCS account sign-in, and wipes sessions on Chrome close.

**How to deploy via Action1:**
1. In Action1 dashboard, go to Scripts > New Script
2. Paste contents of `chrome-lockdown.ps1`
3. Set target: All machines tagged `WCS-Kiosk`
4. Run as: SYSTEM (requires admin)
5. Execute immediately or schedule

**Re-run anytime** to update policies (script is idempotent).

## nightly-cleanup.ps1

Removes extra Chrome profiles (e.g., "Profile 1", "Profile 2") created by staff sign-ins during the day. The Default kiosk profile is preserved.

**How to schedule via Action1:**
1. In Action1 dashboard, go to Scripts > New Script
2. Paste contents of `nightly-cleanup.ps1`
3. Set target: All machines tagged `WCS-Kiosk`
4. Schedule: Recurring, daily at 2:00 AM
5. Run as: SYSTEM
