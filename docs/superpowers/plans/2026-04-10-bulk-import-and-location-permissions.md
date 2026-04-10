# Bulk Staff Import & Location Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk staff import via Excel template and per-staff location permissions (sign-in vs reporting access) to the WCS Staff Portal admin panel.

**Architecture:** Two independent features: (1) Excel template download/upload with server-side parsing and batch staff creation via new admin API endpoints, (2) New `can_sign_in` and `can_view_reports` boolean columns on `staff_locations` table with toggle UI in staff profile modal and enforcement in auth middleware + reports.

**Tech Stack:** React 19, Vite 8, Tailwind 4, Node/Express, Supabase PostgreSQL, SheetJS (xlsx) for Excel parsing

---

## File Structure

### Feature 1: Bulk Staff Import
- **Create:** `portal/src/components/admin/BulkImportTab.jsx` — Upload UI with template download, file picker, preview table, import button
- **Modify:** `portal/src/components/AdminPanel.jsx:10-17` — Add import tile to ADMIN_TILES array
- **Modify:** `portal/src/lib/api.js` — Add `downloadStaffTemplate()` and `importStaff(file)` functions
- **Modify:** `auth/src/routes/admin.js` — Add `GET /admin/staff/template` and `POST /admin/staff/import` endpoints
- **Modify:** `auth/package.json` — Add `xlsx` dependency

### Feature 2: Location Permissions
- **Create:** `auth/migrations/002_location_permissions.sql` — Add columns to staff_locations
- **Modify:** `portal/src/components/AdminStaffTab.jsx` — Add permission toggles in StaffModal
- **Modify:** `auth/src/routes/admin.js` — Include permissions in staff CRUD
- **Modify:** `auth/src/middleware/auth.js` — Populate sign_in_location_ids and report_location_ids on req.staff
- **Modify:** `auth/src/routes/reports.js` — Filter by report_location_ids instead of location_ids

---

## Task 1: Add xlsx dependency to auth API

**Files:**
- Modify: `auth/package.json`

- [ ] **Step 1: Install xlsx**

```bash
cd C:/Users/justi/wcs-staff-portal/auth && npm install xlsx
```

- [ ] **Step 2: Verify installation**

```bash
cd C:/Users/justi/wcs-staff-portal/auth && node -e "require('xlsx'); console.log('xlsx OK')"
```
Expected: `xlsx OK`

- [ ] **Step 3: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add auth/package.json auth/package-lock.json && git commit -m "feat: add xlsx dependency for bulk staff import"
```

---

## Task 2: Add bulk import API endpoints

**Files:**
- Modify: `auth/src/routes/admin.js` — Add GET /admin/staff/template and POST /admin/staff/import
- Modify: `auth/src/index.js` — Add express raw body parser for multipart

- [ ] **Step 1: Add template download endpoint to admin.js**

Add before `module.exports = router` at end of `auth/src/routes/admin.js`:

```javascript
// GET /admin/staff/template — director+ (download Excel template)
router.get('/staff/template', requireRole('director'), async (req, res) => {
  const XLSX = require('xlsx')

  // Fetch locations for the dropdown hint
  const { data: locations } = await supabaseAdmin.from('locations').select('name')
  const locationNames = (locations || []).map(l => l.name).join(', ')

  const wb = XLSX.utils.book_new()

  // Template with headers and example row
  const headers = ['first_name', 'last_name', 'email', 'role', 'locations', 'temporary_password']
  const example = ['Jane', 'Doe', 'jane@wcstrength.com', 'front_desk', 'Salem, Keizer', 'changeme123']
  const ws = XLSX.utils.aoa_to_sheet([headers, example])

  // Set column widths
  ws['!cols'] = [
    { wch: 15 }, { wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 40 }, { wch: 20 }
  ]

  // Add instructions sheet
  const instrWs = XLSX.utils.aoa_to_sheet([
    ['WCS Staff Import Template — Instructions'],
    [],
    ['Column', 'Required', 'Description'],
    ['first_name', 'Yes', 'Staff member first name'],
    ['last_name', 'Yes', 'Staff member last name'],
    ['email', 'Yes', 'Unique email address'],
    ['role', 'Yes', 'One of: front_desk, personal_trainer, lead, manager, director, admin'],
    ['locations', 'Yes', 'Comma-separated location names: ' + locationNames],
    ['temporary_password', 'Yes', 'Initial password (staff must change on first login)'],
    [],
    ['Available Locations: ' + locationNames],
    ['Available Roles: front_desk, personal_trainer, lead, manager, director, admin'],
  ])
  instrWs['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 70 }]

  XLSX.utils.book_append_sheet(wb, ws, 'Staff')
  XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions')

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  res.setHeader('Content-Disposition', 'attachment; filename="wcs-staff-import-template.xlsx"')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.send(buf)
})
```

- [ ] **Step 2: Add import endpoint to admin.js**

Add after the template endpoint:

```javascript
// POST /admin/staff/import — director+ (bulk import from Excel)
router.post('/staff/import', requireRole('director'), async (req, res) => {
  const XLSX = require('xlsx')
  const VALID_ROLES = ['front_desk', 'personal_trainer', 'lead', 'manager', 'director', 'admin']

  try {
    // req.body is the raw file buffer (express.raw middleware)
    const contentType = req.headers['content-type'] || ''
    if (!contentType.includes('application/vnd.openxmlformats') && !contentType.includes('octet-stream')) {
      return res.status(400).json({ error: 'Expected an xlsx file upload' })
    }

    const wb = XLSX.read(req.body, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return res.status(400).json({ error: 'No sheets found in workbook' })

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    if (!rows.length) return res.status(400).json({ error: 'No data rows found' })

    // Fetch locations for validation
    const { data: dbLocations } = await supabaseAdmin.from('locations').select('id, name')
    const locMap = {}
    for (const loc of (dbLocations || [])) {
      locMap[loc.name.toLowerCase().trim()] = loc.id
    }

    // Validate all rows first
    const errors = []
    const parsed = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2 // Excel row (1-indexed + header)
      const rowErrors = []

      const firstName = (row.first_name || '').toString().trim()
      const lastName = (row.last_name || '').toString().trim()
      const email = (row.email || '').toString().trim().toLowerCase()
      const role = (row.role || '').toString().trim().toLowerCase()
      const locationsStr = (row.locations || '').toString().trim()
      const tempPassword = (row.temporary_password || '').toString().trim()

      if (!firstName) rowErrors.push('first_name is required')
      if (!lastName) rowErrors.push('last_name is required')
      if (!email) rowErrors.push('email is required')
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('invalid email format')
      if (!role) rowErrors.push('role is required')
      else if (!VALID_ROLES.includes(role)) rowErrors.push('invalid role: ' + role)
      if (!locationsStr) rowErrors.push('locations is required')
      if (!tempPassword) rowErrors.push('temporary_password is required')
      else if (tempPassword.length < 6) rowErrors.push('password must be at least 6 characters')

      // Resolve location names to IDs
      const locationIds = []
      if (locationsStr) {
        const locNames = locationsStr.split(',').map(s => s.trim().toLowerCase())
        for (const name of locNames) {
          if (locMap[name]) {
            locationIds.push(locMap[name])
          } else {
            rowErrors.push('unknown location: ' + name)
          }
        }
        if (locNames.length > 0 && locationIds.length === 0) {
          rowErrors.push('no valid locations found')
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, errors: rowErrors })
      } else {
        parsed.push({ firstName, lastName, email, role, locationIds, tempPassword })
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed for ' + errors.length + ' row(s)',
        row_errors: errors,
        valid_count: parsed.length,
        total_count: rows.length,
      })
    }

    // Check for duplicate emails within the file
    const emailSet = new Set()
    for (const p of parsed) {
      if (emailSet.has(p.email)) {
        return res.status(400).json({ error: 'Duplicate email in file: ' + p.email })
      }
      emailSet.add(p.email)
    }

    // Import all valid rows
    const results = { created: 0, failed: 0, failures: [] }

    for (const staff of parsed) {
      try {
        // Create auth user
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: staff.email,
          password: staff.tempPassword,
          email_confirm: true,
        })

        if (authError) {
          results.failed++
          results.failures.push({ email: staff.email, error: authError.message })
          continue
        }

        // Create staff record
        const { error: staffError } = await supabaseAdmin.from('staff').insert({
          id: authUser.user.id,
          email: staff.email,
          display_name: (staff.firstName + ' ' + staff.lastName).trim(),
          first_name: staff.firstName,
          last_name: staff.lastName,
          role: staff.role,
          must_change_password: true,
        })

        if (staffError) {
          await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
          results.failed++
          results.failures.push({ email: staff.email, error: 'Failed to create staff record' })
          continue
        }

        // Assign locations
        const assignments = staff.locationIds.map((locId, i) => ({
          staff_id: authUser.user.id,
          location_id: locId,
          is_primary: i === 0,
        }))

        const { error: locError } = await supabaseAdmin.from('staff_locations').insert(assignments)
        if (locError) {
          results.failed++
          results.failures.push({ email: staff.email, error: 'Created but location assignment failed' })
          continue
        }

        results.created++
      } catch (err) {
        results.failed++
        results.failures.push({ email: staff.email, error: err.message })
      }
    }

    res.json({
      message: results.created + ' staff imported, ' + results.failed + ' failed',
      created: results.created,
      failed: results.failed,
      failures: results.failures,
    })
  } catch (err) {
    console.error('[Admin] import error:', err.message)
    res.status(500).json({ error: 'Failed to process import file' })
  }
})
```

- [ ] **Step 3: Add raw body parser for import route in index.js**

In `auth/src/index.js`, add a raw body parser before the admin routes. Replace the admin route line:

```javascript
// Raw body parser for staff import (xlsx upload)
app.use('/admin/staff/import', express.raw({ type: '*/*', limit: '10mb' }))
app.use('/admin', require('./routes/admin'))
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add auth/src/routes/admin.js auth/src/index.js && git commit -m "feat: add bulk staff import API — template download and xlsx upload"
```

---

## Task 3: Add bulk import API functions to frontend

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add template download function**

Add after the `deleteStaff` function (around line 88) in `portal/src/lib/api.js`:

```javascript
// Admin - Bulk Import
export async function downloadStaffTemplate() {
  const headers = {}
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const res = await fetch(API_URL + '/admin/staff/template', { headers })
  if (!res.ok) throw new Error('Failed to download template')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'wcs-staff-import-template.xlsx'
  a.click()
  URL.revokeObjectURL(url)
}

export async function importStaff(file) {
  const headers = { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken
  const res = await fetch(API_URL + '/admin/staff/import', {
    method: 'POST',
    headers,
    body: file,
  })
  const data = await res.json()
  if (!res.ok) throw Object.assign(new Error(data.error || 'Import failed'), { data })
  return data
}
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add portal/src/lib/api.js && git commit -m "feat: add bulk import API functions to frontend client"
```

---

## Task 4: Create BulkImportTab UI component

**Files:**
- Create: `portal/src/components/admin/BulkImportTab.jsx`

- [ ] **Step 1: Create the component**

```jsx
import { useState, useRef } from 'react'
import { downloadStaffTemplate, importStaff } from '../../lib/api'

export default function BulkImportTab() {
  const [file, setFile] = useState(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const fileRef = useRef(null)

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      await downloadStaffTemplate()
    } catch (err) {
      setError(err.message)
    } finally {
      setDownloading(false)
    }
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (f) {
      if (!f.name.endsWith('.xlsx') && !f.name.endsWith('.xls')) {
        setError('Please select an Excel file (.xlsx)')
        setFile(null)
        return
      }
      setFile(f)
      setError(null)
      setResult(null)
    }
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setError(null)
    setResult(null)
    try {
      const data = await importStaff(file)
      setResult(data)
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setError(err.message)
      if (err.data?.row_errors) {
        setResult(err.data)
      }
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Download Template Section */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Step 1: Download Template</h3>
        <p className="text-xs text-text-muted mb-4">
          Download the Excel template, fill in staff details, then upload it below.
        </p>
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {downloading ? 'Downloading...' : 'Download Template'}
        </button>
      </div>

      {/* Upload Section */}
      <div className="bg-surface border border-border rounded-xl p-6">
        <h3 className="text-sm font-semibold text-text-primary mb-2">Step 2: Upload Filled Template</h3>
        <p className="text-xs text-text-muted mb-4">
          Select your completed Excel file. All staff will be created with "must change password" enabled.
        </p>

        <div className="flex items-center gap-4">
          <label className="flex-1">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border file:border-border file:text-sm file:font-medium file:bg-bg file:text-text-primary hover:file:bg-border/50 file:cursor-pointer cursor-pointer"
            />
          </label>
          <button
            onClick={handleImport}
            disabled={!file || importing}
            className="px-4 py-2 bg-wcs-red text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {importing ? 'Importing...' : 'Import Staff'}
          </button>
        </div>

        {file && (
          <p className="text-xs text-text-muted mt-2">
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-wcs-red rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Results Display */}
      {result && !result.row_errors && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3 text-sm">
          <p className="font-medium">{result.message}</p>
          {result.failures?.length > 0 && (
            <ul className="mt-2 space-y-1">
              {result.failures.map((f, i) => (
                <li key={i} className="text-xs text-red-600">
                  {f.email}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Validation Errors Display */}
      {result?.row_errors && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-red-50">
            <p className="text-sm font-medium text-wcs-red">
              {result.row_errors.length} row(s) have errors — {result.valid_count} of {result.total_count} valid
            </p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Row</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Errors</th>
                </tr>
              </thead>
              <tbody>
                {result.row_errors.map((re, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-text-primary font-medium">{re.row}</td>
                    <td className="px-4 py-2 text-wcs-red text-xs">{re.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add portal/src/components/admin/BulkImportTab.jsx && git commit -m "feat: add BulkImportTab component with template download and upload UI"
```

---

## Task 5: Wire BulkImportTab into AdminPanel

**Files:**
- Modify: `portal/src/components/AdminPanel.jsx`

- [ ] **Step 1: Add import and tile entry**

Add import at top:
```javascript
import BulkImportTab from './admin/BulkImportTab'
```

Add new tile to ADMIN_TILES array (after the 'staff' entry):
```javascript
{ key: 'import', label: 'Import Staff', description: 'Bulk import staff from Excel template', icon: 'M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5' },
```

Add render case in the activeSection switch (after the 'staff' line):
```javascript
{activeSection === 'import' && <BulkImportTab />}
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add portal/src/components/AdminPanel.jsx && git commit -m "feat: add Import Staff tile to admin panel"
```

---

## Task 6: Add location permission columns to staff_locations

**Files:**
- Create: `auth/migrations/002_location_permissions.sql`

- [ ] **Step 1: Create migration**

```sql
-- Location Permissions: per-staff sign-in and reporting access per location
-- Adds granular permissions to existing staff_locations junction table
-- Default: both true (backwards compatible with existing data)

ALTER TABLE staff_locations
  ADD COLUMN IF NOT EXISTS can_sign_in BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_view_reports BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN staff_locations.can_sign_in IS 'Whether staff can sign into the portal at this location';
COMMENT ON COLUMN staff_locations.can_view_reports IS 'Whether staff can view reporting data for this location';
```

- [ ] **Step 2: Run migration in Supabase**

Run this SQL in the Supabase SQL editor for the project (ybopxxydsuwlbwxiuzve).

- [ ] **Step 3: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add auth/migrations/002_location_permissions.sql && git commit -m "feat: add can_sign_in and can_view_reports columns to staff_locations"
```

---

## Task 7: Update auth middleware to populate permission-scoped location arrays

**Files:**
- Modify: `auth/src/middleware/auth.js`

- [ ] **Step 1: Update authenticate function**

Replace the staffLocs query and req.staff assignment (lines 30-39):

```javascript
    const { data: staffLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('location_id, is_primary, can_sign_in, can_view_reports')
      .eq('staff_id', userId)

    const allLocationIds = (staffLocs || []).map(sl => sl.location_id)
    const signInLocationIds = (staffLocs || []).filter(sl => sl.can_sign_in).map(sl => sl.location_id)
    const reportLocationIds = (staffLocs || []).filter(sl => sl.can_view_reports).map(sl => sl.location_id)

    req.staff = {
      ...staff,
      location_ids: allLocationIds,
      sign_in_location_ids: signInLocationIds,
      report_location_ids: reportLocationIds,
      primary_location_id: (staffLocs || []).find(sl => sl.is_primary)?.location_id || null,
    }
```

- [ ] **Step 2: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add auth/src/middleware/auth.js && git commit -m "feat: populate sign_in and report location IDs in auth middleware"
```

---

## Task 8: Update reports to use report_location_ids

**Files:**
- Modify: `auth/src/routes/reports.js`

- [ ] **Step 1: Update resolveLocationFilter to use report_location_ids**

In `auth/src/routes/reports.js`, find the `resolveLocationFilter` function and update it to use `req.staff.report_location_ids` for access control. Also update any endpoint that currently checks `req.staff.location_ids` for report filtering to use `req.staff.report_location_ids` instead.

Find lines where `req.staff.location_ids` is used in reports.js and replace with `req.staff.report_location_ids`.

- [ ] **Step 2: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add auth/src/routes/reports.js && git commit -m "feat: reports now use report_location_ids for access control"
```

---

## Task 9: Update staff CRUD to handle location permissions

**Files:**
- Modify: `auth/src/routes/admin.js`

- [ ] **Step 1: Update GET /admin/staff to return permissions**

In the GET /admin/staff route, update the staff_locations select to include the new columns:

```javascript
    const { data: allLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('staff_id, location_id, is_primary, can_sign_in, can_view_reports, locations(id, name)')
      .in('staff_id', staffIds)

    const staffWithLocs = (staffList || []).map(s => ({
      ...s,
      locations: (allLocs || [])
        .filter(sl => sl.staff_id === s.id)
        .map(sl => ({
          id: sl.locations.id,
          name: sl.locations.name,
          is_primary: sl.is_primary,
          can_sign_in: sl.can_sign_in,
          can_view_reports: sl.can_view_reports,
        })),
    }))
```

- [ ] **Step 2: Update POST /admin/staff to accept permissions**

In the POST route, update the assignments creation to include permissions:

```javascript
    const assignments = location_ids.map((locId, i) => {
      const perms = (req.body.location_permissions || {})[locId] || {}
      return {
        staff_id: authUser.user.id,
        location_id: locId,
        is_primary: i === 0,
        can_sign_in: perms.can_sign_in !== false,
        can_view_reports: perms.can_view_reports !== false,
      }
    })
```

- [ ] **Step 3: Update PUT /admin/staff/:id to accept permissions**

In the PUT route, update the assignments creation similarly:

```javascript
    if (location_ids) {
      await supabaseAdmin.from('staff_locations').delete().eq('staff_id', staffId)

      const assignments = location_ids.map((locId, i) => {
        const perms = (req.body.location_permissions || {})[locId] || {}
        return {
          staff_id: staffId,
          location_id: locId,
          is_primary: i === 0,
          can_sign_in: perms.can_sign_in !== false,
          can_view_reports: perms.can_view_reports !== false,
        }
      })
      const { error } = await supabaseAdmin.from('staff_locations').insert(assignments)
      if (error) return res.status(500).json({ error: 'Failed to update location assignments' })
    }
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add auth/src/routes/admin.js && git commit -m "feat: staff CRUD now handles per-location sign-in and reporting permissions"
```

---

## Task 10: Update StaffModal with location permission toggles

**Files:**
- Modify: `portal/src/components/AdminStaffTab.jsx`

- [ ] **Step 1: Add location_permissions to form state**

In the StaffModal component, update the form initialization to include `location_permissions`:

For new staff:
```javascript
const [form, setForm] = useState(isNew ? { ...emptyForm, location_permissions: {} } : {
  email: member.email || '',
  first_name: member.first_name || '',
  last_name: member.last_name || '',
  role: member.role || 'front_desk',
  location_ids: (member.locations || []).map(l => l.id),
  location_permissions: Object.fromEntries(
    (member.locations || []).map(l => [l.id, {
      can_sign_in: l.can_sign_in !== false,
      can_view_reports: l.can_view_reports !== false,
    }])
  ),
  temp_password: '',
})
```

Add `location_permissions: {}` to the `emptyForm` constant at top of file.

- [ ] **Step 2: Update toggleLocation to initialize permissions**

```javascript
  function toggleLocation(locId) {
    setForm(prev => {
      const wasSelected = prev.location_ids.includes(locId)
      const newIds = wasSelected
        ? prev.location_ids.filter(id => id !== locId)
        : [...prev.location_ids, locId]
      const newPerms = { ...prev.location_permissions }
      if (!wasSelected) {
        newPerms[locId] = { can_sign_in: true, can_view_reports: true }
      } else {
        delete newPerms[locId]
      }
      return { ...prev, location_ids: newIds, location_permissions: newPerms }
    })
  }

  function togglePerm(locId, perm) {
    setForm(prev => ({
      ...prev,
      location_permissions: {
        ...prev.location_permissions,
        [locId]: {
          ...prev.location_permissions[locId],
          [perm]: !(prev.location_permissions[locId]?.[perm] ?? true),
        },
      },
    }))
  }
```

- [ ] **Step 3: Add permission toggles UI after location buttons**

Replace the Locations section in the form with:

```jsx
          <div>
            <label className="block text-xs text-text-muted mb-2">Locations & Permissions</label>
            <div className="flex flex-wrap gap-2 mb-3">
              {locations.map(loc => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => toggleLocation(loc.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    form.location_ids.includes(loc.id)
                      ? 'bg-wcs-red text-white border-wcs-red'
                      : 'bg-bg text-text-muted border-border hover:text-text-primary'
                  }`}
                >
                  {loc.name}
                </button>
              ))}
            </div>

            {/* Permission toggles for selected locations */}
            {form.location_ids.length > 0 && (
              <div className="bg-bg rounded-lg border border-border p-3 space-y-2">
                <p className="text-xs text-text-muted font-medium mb-1">Location Permissions</p>
                {form.location_ids.map(locId => {
                  const loc = locations.find(l => l.id === locId)
                  const perms = form.location_permissions[locId] || { can_sign_in: true, can_view_reports: true }
                  return (
                    <div key={locId} className="flex items-center justify-between text-xs">
                      <span className="text-text-primary font-medium min-w-[80px]">{loc?.name}</span>
                      <div className="flex items-center gap-4">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={perms.can_sign_in}
                            onChange={() => togglePerm(locId, 'can_sign_in')}
                            className="rounded border-border text-wcs-red focus:ring-wcs-red"
                          />
                          <span className="text-text-muted">Sign In</span>
                        </label>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={perms.can_view_reports}
                            onChange={() => togglePerm(locId, 'can_view_reports')}
                            className="rounded border-border text-wcs-red focus:ring-wcs-red"
                          />
                          <span className="text-text-muted">Reports</span>
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/justi/wcs-staff-portal && git add portal/src/components/AdminStaffTab.jsx && git commit -m "feat: add location permission toggles (sign-in, reports) to staff modal"
```

---
