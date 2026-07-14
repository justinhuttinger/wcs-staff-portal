# Forms "All Locations" option — Design

**Date:** 2026-07-14

## Goal
Let an admin create a single form that belongs to all clubs at once (one link, one QR, one combined Google Sheet), instead of duplicating the form per location.

## Background
Today every form is bound to exactly one club: `forms.location_id NOT NULL REFERENCES locations(id)`. That location drives:
- Google Sheet title `Title (Club)` and a per-club Drive subfolder (`formsSheets.js`).
- FormsView list label + location filter.
- The location_name echoed to the renderer on submission (`publicForms.js`).
- `visibility: 'location'` access (a club's staff can see the form).

The sheets stack already degrades gracefully when a location can't be resolved (bare title, root folder), so "all locations" fits as a **nullable location**.

## Decision
- **Data model:** make `forms.location_id` nullable. `NULL` = all locations. No new column, no boolean flag.
- **Display label:** a NULL-location form reads as **"All Locations"** everywhere (list, sheet title, Drive subfolder, submission meta).
- **One combined sheet:** a single Google Sheet titled `Title (All Locations)`, filed under an "All Locations" Drive subfolder. Every club's submissions land in that one sheet.
- **No per-submission club capture** (explicit product choice). If a club breakdown is ever wanted on one of these forms, an admin adds a normal Location dropdown field to that form.
- **Who can create one:** corporate/admin tier only (`isCorporate`). Non-admin RBAC-`forms` users stay pinned to their own club and never get the all-locations option.

## Behavior details
- `POST /forms`: accept `all_locations: true` in the body. If the requester is corporate, store `location_id = NULL`. Non-corporate requests ignore the flag and remain location-scoped (existing 403 rules unchanged).
- `GET /forms`: a form with `location_id = NULL` returns `location_name: "All Locations"`.
- `formsSheets.js`: `location_id = NULL` resolves to the label "All Locations" → sheet title `Title (All Locations)`, Drive subfolder "All Locations".
- `publicForms.js`: `location_id = NULL` → `location_name: "All Locations"` in the render meta.
- Frontend `FormsView.jsx`: create modal gains an "All Locations" choice at the top of the location picker (sends `all_locations: true`); list rows show "All Locations" automatically; the location filter gains an "All Locations" entry.

## Edge notes
- `visibility: 'location'` on an all-locations form matches no single club, so it grants no one via the location path. Admins see everything regardless; these forms should use Shared/Private. Not a blocker.
- Migration only relaxes a constraint (`DROP NOT NULL`); existing rows are unaffected.

## Out of scope
- Per-submission location capture / auto club-picker field.
- Per-club sheet splitting for an all-locations form.
