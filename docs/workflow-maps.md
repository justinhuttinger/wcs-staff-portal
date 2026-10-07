# Workflow Maps

Visual maps of our marketing and operations automation workflows (GHL texts,
emails, waits, branches). Staff build and edit them in the portal with no code
changes. Clicking a step shows the exact copy behind it.

**Where:** Portal → Marketing tile → **Workflows** tab (desktop), or the
Tracker / Workflows switch on the mobile Marketing screen.

**Who:** anyone with the `marketing:workflows` permission can view (Admin →
Roles, Marketing section; corporate and above, and marketing add-on staff,
always have it). Only **admins** can create, edit, rename, duplicate, delete or
import maps; everyone else gets the read-only Present view.

## Using it

- **Home:** every map with its folder, GHL status, clubs, step count and last
  edit. Search and filter by folder. Create (blank or from a template), rename,
  duplicate, export to JSON, delete. **Import JSON** creates a new map from an
  export file.
- **Edit mode:** `+ Add step` adds any step type. With a step selected, the new
  step is placed under it and connected automatically. Drag from a step's bottom
  dot to another step's top dot to connect. Click a step to edit it in the side
  panel. Delete removes the selected step or connection (button or Delete key).
  Duplicate copies a step (button or Ctrl+D). Undo / redo (Ctrl+Z, Ctrl+Shift+Z).
  **Tidy up** auto-arranges top to bottom.
- **Present mode:** read-only. Clicking a step shows its content with Copy
  buttons. Phones open maps in Present mode.
- **Autosave:** every change saves after a short pause. The top bar shows
  Saving... / Saved. If someone else saved the same map in the meantime, a banner
  offers "Load their version" or "Keep mine".

## Step types

| Type | Holds |
| --- | --- |
| Trigger | What starts the workflow (form, tag, filters) |
| Text (SMS) | Message body, merge fields, live character and SMS segment count |
| Email | Subject, preview text, body as plain text or HTML (shown as the rendered email, desktop/phone widths, full-size preview) |
| Wait | A set time (number + minutes/hours/days/weeks) or "until an event" |
| Condition | If / else split with 2+ labeled branches (default Yes / No), one outgoing dot per branch |
| Call | Staff phone call and its script |
| Action | GHL action: add/remove tag, internal notification, task, field update, opportunity, add/remove from workflow, webhook, etc. |
| Goal / End | Workflow ends or the goal is reached |
| Note | Freeform annotation, not connected |

Every step (except Note) also has a title, an optional link to the full copy
(shown as a **Doc** button on the card), internal notes, and a **GHL status**
flag (Live as-is / New: add to GHL / Change in GHL / Remove from GHL) so a map
can double as the to-do list for whoever edits the live workflow.

Merge fields in either style, `{first_name}` or GHL's `{{contact.first_name}}`,
are highlighted. The panel has a merge-field picker.

At the workflow level: name, description, folder, status in GHL (Draft / Live /
Paused / Idea), clubs, and a link to the workflow in GHL.

## Code

| Part | Path |
| --- | --- |
| API (`/workflow-maps`) | `auth/src/routes/workflowMaps.js` |
| Input validation + tests | `auth/src/lib/workflowMaps.js`, `workflowMaps.test.js` |
| Table, permission, example map | `auth/migrations/233_workflow_maps.sql` |
| UI | `portal/src/components/workflowMaps/` |

UI files: `WorkflowMapsHome.jsx` (list), `EmailHtmlPreview.jsx` (rendered HTML emails: sandboxed frame, no scripts), `WorkflowEditor.jsx` (canvas, autosave,
undo), `StepNode.jsx` (cards), `NodePanel.jsx` (side panel), `kinds.js` (step
types: colors, icons, defaults), `templates.js` (templates + JSON import/export),
`layout.js` (Tidy up, dagre), `MapDetails.jsx` (details form), `ui.js`.

Canvas: React Flow (`@xyflow/react`), lazy-loaded so it only downloads when the
Workflows tab opens. The portal is plain JS/JSX, so this is too.

### API

All routes need a portal login and the `workflows` marketing capability. Create, save, duplicate and delete are admin only (403 otherwise); list and get return `canEdit`.

- `GET /workflow-maps`: list (no graph, includes `step_count`)
- `GET /workflow-maps/:id`: one map with `nodes` / `edges`
- `POST /workflow-maps`: create. Body: name (required), description, category,
  status, clubs, ghl_workflow_url, nodes, edges
- `PUT /workflow-maps/:id`: save. Body must include the `version` the client
  loaded. Returns 409 with the current row if someone saved since.
- `POST /workflow-maps/:id/duplicate`
- `DELETE /workflow-maps/:id`

### Data model

`workflow_maps` holds one row per map. The graph is React Flow JSON:

```js
node = { id, type: 'sms', position: { x, y }, data: {
  title, body, link, notes, change,       // all types
  subject, previewText, bodyFormat,        // email ('text' | 'html')
  waitMode, waitAmount, waitUnit, waitUntil, // wait
  branches: [{ id, label }],               // condition
  actionType,                              // action
  ghl,                                     // reserved for GHL sync
} }
edge = { id, source, target, sourceHandle? } // sourceHandle = branch id
```

Export files wrap the map as `{ format: 'wcs-workflow-map', version: 1, workflow: {...} }`.

### Live GHL custom values

SMS, call and email steps can be **linked** to a GHL custom value (the copy
the workflows send). The map only reads GHL, it never writes to it:

- Linked steps show the live value with a green GHL badge, or "Not found" if
  the value doesn't exist (the step's saved copy shows instead).
- Linked copy is read-only in the map. Change it in GHL or the Workflows &
  Scripts tile; the map shows it on open or with the "↻ GHL copy" button.
- Values come from the Salem sub-account (`BASE_CLUB` in the route); the UI
  doesn't name a club.
- Linked values are re-read by id because GHL's list endpoint lags writes.
- Steps whose notes say `GHL custom value: X` get a one-click link suggestion.
- Link format on the step: `data.cv = { key: 'custom_values.x', name }` (key
  matched first, then name).
- Endpoint: `GET /workflow-maps/ghl-values?links=`.

### GHL sync (not built)

The table already has `source` ('manual' | 'ghl'), `ghl_location_id`,
`ghl_workflow_id` (unique together) and `ghl_synced_at`, and each step can carry
`data.ghl = { stepId, stepType }`. A sync job could read a GHL workflow
definition (`workflowData.templates[]`: sms, email, wait, if_else, etc.), map
each GHL step to one node type, resolve `{{custom_values.*}}` copy, and upsert
by `(ghl_location_id, ghl_workflow_id)`, matching existing nodes by
`data.ghl.stepId` so hand-added notes and positions survive a re-sync. GHL's
public API only lists workflows, so this needs the builder's internal endpoint
or a different source.

## Running locally

```bash
# API
cd auth && npm install && npm run dev        # http://localhost:3001
# Portal
cd portal && pnpm install && pnpm dev        # http://localhost:3000
```

The portal reads `VITE_API_URL` (default `http://localhost:3001`). The API needs
the usual Supabase env (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and
migration 233 applied to that database.

Tests: `cd auth && node --test src/lib/workflowMaps.test.js`.
