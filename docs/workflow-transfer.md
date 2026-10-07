# Workflow Transfer (GHL import / export)

Owner-only tool in the Marketing folder. It exports GHL workflows as JSON and copies them between clubs with location-scoped ids remapped.

## Access
- API: `/ghl-workflows/*`, admin role plus `WORKFLOW_TRANSFER_EMAILS` (default `justin@wcstrength.com`).
- Portal: tile shows only for `config/workflowTransfer.js` emails.

## GHL session
The public API can only list workflows. Full reads and writes go through GHL's internal API (`backend.leadconnectorhq.com`) as the signed-in user, the same calls the builder and the "Workflow Importer/Exporter for GHL" Chrome extension make.

- Agency Custom JS module 11 ("Portal hand-off", v2.7) watches the app's own requests for the session token. For Justin only, it shows a **Send to portal** button that opens `portal.wcstrength.com/#open/workflowTransfer?ghl=<token>`.
- `portal/src/lib/ghlSession.js` takes the token from the fragment, wipes it from the address bar, and keeps it in sessionStorage. It is sent per request as `X-GHL-Session`.
- The API forwards it to GHL and never stores or logs it. Tokens last about an hour.
- Session failures return 409 `{ code: 'ghl_session' }`, not 401, because the portal treats a 401 as its own login expiring.

## Remapping
`auth/src/lib/ghlWorkflowRemap.js` handles remapping. It matches source records to target records by identity:

| Record | Matched by |
|---|---|
| Custom fields | `fieldKey` |
| Users | email |
| Everything else | name, ignoring each club's own name (e.g. "Salem Gym Tour" matches "Keizer Gym Tour") |

The "everything else" group covers custom values, tags, calendars, pipelines, stages ("Pipeline / Stage"), forms, surveys and workflows.

It then replaces every source id anywhere in the definition and triggers (values, keys, embedded in strings), plus the location id. Unmatched ids are listed in the preview, and each one can be pointed at a target record by hand (overrides).

## Writes
- **New:** `POST /workflow/{loc}` creates a draft, then the steps are written into it.
- **Overwrite:** the target is first saved to `ghl_workflow_snapshots` (migration 234), then `PUT /workflow/{loc}/{id}` replaces steps and settings, then `PUT /workflow/{loc}/only-triggers/{id}` replaces triggers (version re-read in between).
- **Restore:** pushes a snapshot back over its own workflow, which takes a fresh snapshot first.

## Export
Export selected, all in a club, or every club. Several workflows download as one bundle `{ format: 'wcs-ghl-workflow-bundle@1', workflows: [...] }`. **Load JSON file** accepts single exports, bundles and the Chrome extension's format.
