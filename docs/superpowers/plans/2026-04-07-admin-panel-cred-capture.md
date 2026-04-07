# Admin Panel, Custom Tiles & Credential Auto-Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin panel UI (staff CRUD, custom tiles), per-location custom tool tiles, and Chrome-style credential auto-capture to the WCS Staff Portal.

**Architecture:** Admin panel is a React view toggled via state in App.jsx. Custom tiles stored in Supabase, served via new API routes. Credential capture uses Electron preload scripts to detect login forms and save credentials to the vault via IPC.

**Tech Stack:** React 19, Tailwind 4, Express, Supabase, Electron 33 (BrowserView preloads)

**Spec:** `docs/superpowers/specs/2026-04-07-admin-panel-cred-capture-design.md`

---

## File Structure

### New Files

```
auth/src/routes/config.js             # MODIFY — add tiles CRUD routes
portal/src/components/AdminPanel.jsx   # NEW — admin view container with tabs
portal/src/components/AdminStaffTab.jsx # NEW — staff management table + forms
portal/src/components/AdminTilesTab.jsx # NEW — tiles management table + forms
portal/src/components/SaveCredentialToast.jsx # NEW — credential save prompt
launcher/src/credential-capture.js     # NEW — generic login form detector preload
```

### Modified Files

```
portal/src/App.jsx                     # Add admin button, showAdmin state, toast
portal/src/components/ToolGrid.jsx     # Merge custom tiles with built-in tools
portal/src/lib/api.js                  # Add admin/tiles/locations API helpers
launcher/src/main.js                   # Add credential-captured IPC handler
launcher/src/tabs.js                   # Inject credential-capture preload
launcher/src/portal-preload.js         # Add save-prompt IPC bridge
launcher/src/abc-scraper.js            # Add credential capture logic
```

---

## Task 1: Custom Tiles Schema + API Routes

**Files:**
- Modify: `auth/src/routes/config.js`

- [ ] **Step 1: Create custom_tiles table in Supabase SQL Editor**

```sql
CREATE TABLE custom_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  icon TEXT,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  created_by UUID REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(url, location_id)
);
```

- [ ] **Step 2: Add tiles routes to config.js**

Add the following routes to `auth/src/routes/config.js`, after the existing `/config/tools` route:

```javascript
// GET /config/tiles?location_id=xxx
router.get('/tiles', async (req, res) => {
  let query = supabaseAdmin
    .from('custom_tiles')
    .select('id, label, description, url, icon, location_id, created_by, created_at, locations(name)')
    .order('label')

  if (req.query.location_id) {
    query = query.eq('location_id', req.query.location_id)
  } else {
    // Admin viewing all — filter to their locations
    query = query.in('location_id', req.staff.location_ids)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: 'Failed to fetch tiles' })
  res.json({ tiles: data })
})

// POST /config/tiles — admin only
router.post('/tiles', requireRole('admin'), async (req, res) => {
  const { label, description, url, icon, location_id } = req.body
  if (!label || !url || !location_id) {
    return res.status(400).json({ error: 'label, url, and location_id are required' })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_tiles')
    .insert({ label, description, url, icon, location_id, created_by: req.staff.id })
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to create tile' })
  res.status(201).json({ tile: data })
})

// PUT /config/tiles/:id — admin only
router.put('/tiles/:id', requireRole('admin'), async (req, res) => {
  const { label, description, url, icon } = req.body
  const updates = {}
  if (label !== undefined) updates.label = label
  if (description !== undefined) updates.description = description
  if (url !== undefined) updates.url = url
  if (icon !== undefined) updates.icon = icon

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  const { data, error } = await supabaseAdmin
    .from('custom_tiles')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: 'Failed to update tile' })
  res.json({ tile: data })
})

// DELETE /config/tiles/:id — admin only
router.delete('/tiles/:id', requireRole('admin'), async (req, res) => {
  const { error } = await supabaseAdmin
    .from('custom_tiles')
    .delete()
    .eq('id', req.params.id)

  if (error) return res.status(500).json({ error: 'Failed to delete tile' })
  res.json({ message: 'Tile deleted' })
})
```

- [ ] **Step 3: Commit**

```bash
git add auth/src/routes/config.js
git commit -m "feat: add custom tiles CRUD routes to config API"
```

---

## Task 2: Portal API Client Helpers

**Files:**
- Modify: `portal/src/lib/api.js`

- [ ] **Step 1: Add admin and tiles API helpers**

Add the following functions to the end of `portal/src/lib/api.js`:

```javascript
// Admin - Staff
export async function getStaff() {
  return api('/admin/staff')
}

export async function createStaff(data) {
  return api('/admin/staff', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateStaff(id, data) {
  return api('/admin/staff/' + id, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteStaff(id) {
  return api('/admin/staff/' + id, {
    method: 'DELETE',
  })
}

// Config - Tiles
export async function getTiles(locationId) {
  const qs = locationId ? '?location_id=' + locationId : ''
  return api('/config/tiles' + qs)
}

export async function createTile(data) {
  return api('/config/tiles', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateTile(id, data) {
  return api('/config/tiles/' + id, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteTile(id) {
  return api('/config/tiles/' + id, {
    method: 'DELETE',
  })
}

// Config - Locations
export async function getLocations() {
  return api('/config/locations')
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat: add admin staff, tiles, and locations API helpers"
```

---

## Task 3: AdminStaffTab Component

**Files:**
- Create: `portal/src/components/AdminStaffTab.jsx`

- [ ] **Step 1: Create the staff management tab**

Create `portal/src/components/AdminStaffTab.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getStaff, createStaff, updateStaff, deleteStaff, getLocations } from '../lib/api'

const ROLES = ['front_desk', 'personal_trainer', 'manager', 'director', 'admin']

export default function AdminStaffTab() {
  const [staff, setStaff] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')

  // Add form state
  const [form, setForm] = useState({
    email: '', display_name: '', role: 'front_desk', location_ids: [], temp_password: ''
  })

  // Edit form state
  const [editForm, setEditForm] = useState({
    display_name: '', role: '', location_ids: []
  })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [staffRes, locRes] = await Promise.all([getStaff(), getLocations()])
      setStaff(staffRes.staff || [])
      setLocations(locRes.locations || [])
    } catch (err) {
      setError('Failed to load data')
    }
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    try {
      await createStaff(form)
      setShowAdd(false)
      setForm({ email: '', display_name: '', role: 'front_desk', location_ids: [], temp_password: '' })
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdate(id) {
    setError('')
    try {
      await updateStaff(id, editForm)
      setEditingId(null)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id, name) {
    if (!confirm('Delete ' + name + '? This cannot be undone.')) return
    try {
      await deleteStaff(id)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(s) {
    setEditingId(s.id)
    setEditForm({
      display_name: s.display_name,
      role: s.role,
      location_ids: s.locations.map(l => l.id),
    })
  }

  function toggleLocation(locId, formSetter, formState) {
    const ids = formState.location_ids.includes(locId)
      ? formState.location_ids.filter(id => id !== locId)
      : [...formState.location_ids, locId]
    formSetter({ ...formState, location_ids: ids })
  }

  if (loading) return <p className="text-text-muted text-sm p-4">Loading staff...</p>

  return (
    <div>
      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Staff Members</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover transition-colors"
        >
          {showAdd ? 'Cancel' : 'Add Staff'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-bg rounded-xl border border-border p-4 mb-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Email" type="email" required value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <input placeholder="Display Name" required value={form.display_name}
              onChange={e => setForm({ ...form, display_name: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red">
              {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
            <input placeholder="Temporary Password" required value={form.temp_password}
              onChange={e => setForm({ ...form, temp_password: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Locations</label>
            <div className="flex flex-wrap gap-2">
              {locations.map(loc => (
                <label key={loc.id} className="flex items-center gap-1 text-sm text-text-primary cursor-pointer">
                  <input type="checkbox" checked={form.location_ids.includes(loc.id)}
                    onChange={() => toggleLocation(loc.id, setForm, form)} />
                  {loc.name}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" className="self-start px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover transition-colors">
            Create Staff
          </button>
        </form>
      )}

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 font-medium text-text-muted">Name</th>
              <th className="text-left px-4 py-3 font-medium text-text-muted">Email</th>
              <th className="text-left px-4 py-3 font-medium text-text-muted">Role</th>
              <th className="text-left px-4 py-3 font-medium text-text-muted">Locations</th>
              <th className="text-right px-4 py-3 font-medium text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map(s => (
              <tr key={s.id} className="border-b border-border last:border-0">
                {editingId === s.id ? (
                  <>
                    <td className="px-4 py-3">
                      <input value={editForm.display_name}
                        onChange={e => setEditForm({ ...editForm, display_name: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary text-sm w-full" />
                    </td>
                    <td className="px-4 py-3 text-text-muted">{s.email}</td>
                    <td className="px-4 py-3">
                      <select value={editForm.role}
                        onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary text-sm">
                        {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {locations.map(loc => (
                          <label key={loc.id} className="flex items-center gap-1 text-xs cursor-pointer">
                            <input type="checkbox" checked={editForm.location_ids.includes(loc.id)}
                              onChange={() => toggleLocation(loc.id, setEditForm, editForm)} />
                            {loc.name}
                          </label>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleUpdate(s.id)} className="text-wcs-red text-xs font-semibold mr-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-text-muted text-xs">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-text-primary font-medium">{s.display_name}</td>
                    <td className="px-4 py-3 text-text-muted">{s.email}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full bg-bg text-text-muted text-xs font-medium">
                        {s.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted text-xs">
                      {s.locations?.map(l => l.name).join(', ')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => startEdit(s)} className="text-text-muted hover:text-wcs-red text-xs mr-2">Edit</button>
                      <button onClick={() => handleDelete(s.id, s.display_name)} className="text-text-muted hover:text-wcs-red text-xs">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {staff.length === 0 && <p className="text-center text-text-muted text-sm py-8">No staff members yet</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/AdminStaffTab.jsx
git commit -m "feat: add admin staff management tab component"
```

---

## Task 4: AdminTilesTab Component

**Files:**
- Create: `portal/src/components/AdminTilesTab.jsx`

- [ ] **Step 1: Create the tiles management tab**

Create `portal/src/components/AdminTilesTab.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { getTiles, createTile, updateTile, deleteTile, getLocations } from '../lib/api'

export default function AdminTilesTab() {
  const [tiles, setTiles] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')

  const [form, setForm] = useState({ label: '', description: '', url: '', icon: '', location_id: '' })
  const [editForm, setEditForm] = useState({ label: '', description: '', url: '', icon: '' })

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [tilesRes, locRes] = await Promise.all([getTiles(), getLocations()])
      setTiles(tilesRes.tiles || [])
      setLocations(locRes.locations || [])
    } catch (err) {
      setError('Failed to load data')
    }
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    try {
      await createTile(form)
      setShowAdd(false)
      setForm({ label: '', description: '', url: '', icon: '', location_id: '' })
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleUpdate(id) {
    setError('')
    try {
      await updateTile(id, editForm)
      setEditingId(null)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id, label) {
    if (!confirm('Delete tile "' + label + '"?')) return
    try {
      await deleteTile(id)
      await loadData()
    } catch (err) {
      setError(err.message)
    }
  }

  function startEdit(t) {
    setEditingId(t.id)
    setEditForm({ label: t.label, description: t.description || '', url: t.url, icon: t.icon || '' })
  }

  if (loading) return <p className="text-text-muted text-sm p-4">Loading tiles...</p>

  return (
    <div>
      {error && <p className="text-sm text-wcs-red mb-4">{error}</p>}

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-text-primary">Custom Tiles</h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover transition-colors"
        >
          {showAdd ? 'Cancel' : 'Add Tile'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleCreate} className="bg-bg rounded-xl border border-border p-4 mb-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Label" required value={form.label}
              onChange={e => setForm({ ...form, label: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <input placeholder="URL" type="url" required value={form.url}
              onChange={e => setForm({ ...form, url: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <input placeholder="Description (optional)" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <input placeholder="Icon (emoji, e.g. &#x1F4CA;)" value={form.icon}
              onChange={e => setForm({ ...form, icon: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red" />
            <select value={form.location_id} required
              onChange={e => setForm({ ...form, location_id: e.target.value })}
              className="px-3 py-2 rounded-lg border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red">
              <option value="">Select location...</option>
              {locations.map(loc => <option key={loc.id} value={loc.id}>{loc.name}</option>)}
            </select>
          </div>
          <button type="submit" className="self-start px-4 py-2 rounded-lg bg-wcs-red text-white text-sm font-semibold hover:bg-wcs-red-hover transition-colors">
            Create Tile
          </button>
        </form>
      )}

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg">
              <th className="text-left px-4 py-3 font-medium text-text-muted">Icon</th>
              <th className="text-left px-4 py-3 font-medium text-text-muted">Label</th>
              <th className="text-left px-4 py-3 font-medium text-text-muted">URL</th>
              <th className="text-left px-4 py-3 font-medium text-text-muted">Location</th>
              <th className="text-right px-4 py-3 font-medium text-text-muted">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tiles.map(t => (
              <tr key={t.id} className="border-b border-border last:border-0">
                {editingId === t.id ? (
                  <>
                    <td className="px-4 py-3">
                      <input value={editForm.icon}
                        onChange={e => setEditForm({ ...editForm, icon: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-sm w-12 text-center" />
                    </td>
                    <td className="px-4 py-3">
                      <input value={editForm.label}
                        onChange={e => setEditForm({ ...editForm, label: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary text-sm w-full" />
                    </td>
                    <td className="px-4 py-3">
                      <input value={editForm.url}
                        onChange={e => setEditForm({ ...editForm, url: e.target.value })}
                        className="px-2 py-1 rounded border border-border bg-bg text-text-primary text-sm w-full" />
                    </td>
                    <td className="px-4 py-3 text-text-muted">{t.locations?.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleUpdate(t.id)} className="text-wcs-red text-xs font-semibold mr-2">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-text-muted text-xs">Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 text-xl">{t.icon || '🔗'}</td>
                    <td className="px-4 py-3 text-text-primary font-medium">{t.label}</td>
                    <td className="px-4 py-3 text-text-muted text-xs truncate max-w-48">{t.url}</td>
                    <td className="px-4 py-3 text-text-muted text-xs">{t.locations?.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => startEdit(t)} className="text-text-muted hover:text-wcs-red text-xs mr-2">Edit</button>
                      <button onClick={() => handleDelete(t.id, t.label)} className="text-text-muted hover:text-wcs-red text-xs">Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {tiles.length === 0 && <p className="text-center text-text-muted text-sm py-8">No custom tiles yet</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/AdminTilesTab.jsx
git commit -m "feat: add admin tiles management tab component"
```

---

## Task 5: AdminPanel Container + App.jsx Integration

**Files:**
- Create: `portal/src/components/AdminPanel.jsx`
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: Create AdminPanel container**

Create `portal/src/components/AdminPanel.jsx`:

```jsx
import { useState } from 'react'
import AdminStaffTab from './AdminStaffTab'
import AdminTilesTab from './AdminTilesTab'

const TABS = [
  { key: 'staff', label: 'Staff' },
  { key: 'tiles', label: 'Tiles' },
]

export default function AdminPanel({ onBack }) {
  const [activeTab, setActiveTab] = useState('staff')

  return (
    <div className="max-w-4xl mx-auto w-full px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-text-primary">Admin Panel</h2>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-lg border border-border text-text-muted text-sm font-medium hover:text-text-primary transition-colors"
        >
          Back to Portal
        </button>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-wcs-red text-wcs-red'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'staff' && <AdminStaffTab />}
      {activeTab === 'tiles' && <AdminTilesTab />}
    </div>
  )
}
```

- [ ] **Step 2: Update App.jsx — add admin button and state**

In `portal/src/App.jsx`:

Add import at top:
```javascript
import AdminPanel from './components/AdminPanel'
```

Add state inside the App component (after existing state declarations):
```javascript
const [showAdmin, setShowAdmin] = useState(false)
```

In the header, add an "Admin" button after the gear icon button (inside the `{isAdmin && (` block, after the closing `</button>` of the gear icon):
```jsx
<button
  onClick={() => setShowAdmin(true)}
  className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
>
  Admin
</button>
```

Replace the `<main>` section:
```jsx
{showAdmin ? (
  <AdminPanel onBack={() => setShowAdmin(false)} />
) : (
  <main className="flex-1 flex items-start pt-4">
    <ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} />
  </main>
)}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/AdminPanel.jsx portal/src/App.jsx
git commit -m "feat: add admin panel with staff and tiles tabs, accessible from header"
```

---

## Task 6: ToolGrid Custom Tiles Integration

**Files:**
- Modify: `portal/src/components/ToolGrid.jsx`
- Modify: `portal/src/components/ToolButton.jsx`

- [ ] **Step 1: Update ToolGrid to fetch and merge custom tiles**

Replace `portal/src/components/ToolGrid.jsx` with:

```jsx
import { useState, useEffect } from 'react'
import allTools from '../config/tools.json'
import ToolButton from './ToolButton'
import { getTiles } from '../lib/api'

export default function ToolGrid({ abcUrl, location, visibleTools, locationId }) {
  const [customTiles, setCustomTiles] = useState([])

  useEffect(() => {
    if (locationId) {
      getTiles(locationId).then(res => {
        setCustomTiles(res.tiles || [])
      }).catch(() => {})
    }
  }, [locationId])

  const tools = visibleTools && visibleTools.length > 0
    ? allTools.filter(t => visibleTools.includes(t.id))
    : allTools

  const getUrl = (tool) => {
    if (tool.id === 'abc') {
      const params = new URLSearchParams()
      if (abcUrl) params.set('abc_url', abcUrl)
      if (location) params.set('location', location)
      const qs = params.toString()
      return '/kiosk.html' + (qs ? '?' + qs : '')
    }
    return tool.url
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-5 p-8 max-w-3xl mx-auto w-full">
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          label={tool.label}
          description={tool.description}
          icon={tool.icon}
          url={getUrl(tool)}
        />
      ))}
      {customTiles.map((tile) => (
        <ToolButton
          key={'custom-' + tile.id}
          label={tile.label}
          description={tile.description || ''}
          emoji={tile.icon}
          url={tile.url}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Update ToolButton to support emoji icons**

In `portal/src/components/ToolButton.jsx`, update the component to accept an optional `emoji` prop. Replace the export line and the icon rendering:

Change the function signature from:
```jsx
export default function ToolButton({ label, description, icon, url }) {
```
to:
```jsx
export default function ToolButton({ label, description, icon, emoji, url }) {
```

Replace the icon `<div>` (the one with `className="flex items-center justify-center w-14 h-14..."`) with:
```jsx
<div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red group-hover:text-white transition-all duration-200">
  {emoji ? (
    <span className="text-2xl">{emoji}</span>
  ) : (
    ICONS[icon]
  )}
</div>
```

- [ ] **Step 3: Pass locationId to ToolGrid from App.jsx**

In `portal/src/App.jsx`, find the `<ToolGrid>` usage and add `locationId`:

Change:
```jsx
<ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} />
```
to:
```jsx
<ToolGrid abcUrl={abcUrl} location={location} visibleTools={user.visible_tools} locationId={user.staff.locations?.find(l => l.is_primary)?.id} />
```

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/ToolGrid.jsx portal/src/components/ToolButton.jsx portal/src/App.jsx
git commit -m "feat: merge custom tiles into tool grid with emoji icon support"
```

---

## Task 7: Credential Capture Preload

**Files:**
- Create: `launcher/src/credential-capture.js`
- Modify: `launcher/src/abc-scraper.js`

- [ ] **Step 1: Create generic credential capture preload**

Create `launcher/src/credential-capture.js`:

```javascript
// Generic login form credential capture — runs as Electron preload
// Detects login forms, captures credentials on submit, sends to main process
const { ipcRenderer } = require('electron')

const DOMAIN_SERVICE_MAP = {
  'abcfinancial.com': 'abc',
  'gohighlevel.com': 'ghl',
  'westcoaststrength.com': 'ghl',
  'wheniwork.com': 'wheniwork',
  'paychex.com': 'paychex',
  'myapps.paychex.com': 'paychex',
}

function getServiceName() {
  const hostname = window.location.hostname
  for (const [domain, service] of Object.entries(DOMAIN_SERVICE_MAP)) {
    if (hostname.includes(domain)) return service
  }
  return hostname.replace('www.', '').split('.')[0]
}

function findLoginForm() {
  const forms = document.querySelectorAll('form')
  for (const form of forms) {
    const passwordField = form.querySelector('input[type="password"]')
    if (passwordField) return { form, passwordField }
  }
  return null
}

function getUsernameField(form) {
  const selectors = [
    'input[type="email"]',
    'input[name*="user" i]',
    'input[name*="email" i]',
    'input[name*="login" i]',
    'input[id*="user" i]',
    'input[id*="email" i]',
    'input[type="text"]',
  ]
  for (const sel of selectors) {
    const el = form.querySelector(sel)
    if (el && el.type !== 'password' && el.type !== 'hidden') return el
  }
  return null
}

function attachCapture(form, passwordField) {
  if (form._wcsCapture) return
  form._wcsCapture = true

  form.addEventListener('submit', () => {
    const usernameField = getUsernameField(form)
    const username = usernameField?.value?.trim()
    const password = passwordField?.value

    if (username && password) {
      const service = getServiceName()
      console.log('[WCS CredCapture] Captured login for:', service)
      ipcRenderer.send('credential-captured', { service, username, password })
    }
  })

  // Also capture click on submit buttons (some forms don't fire submit event)
  const submitBtn = form.querySelector('input[type="submit"], button[type="submit"], button:not([type])')
  if (submitBtn) {
    submitBtn.addEventListener('click', () => {
      setTimeout(() => {
        const usernameField = getUsernameField(form)
        const username = usernameField?.value?.trim()
        const password = passwordField?.value
        if (username && password) {
          const service = getServiceName()
          ipcRenderer.send('credential-captured', { service, username, password })
        }
      }, 50)
    })
  }
}

function scanForForms() {
  const result = findLoginForm()
  if (result) attachCapture(result.form, result.passwordField)
}

window.addEventListener('DOMContentLoaded', () => {
  console.log('[WCS CredCapture] Loaded on:', window.location.href)
  scanForForms()

  // Watch for dynamically rendered forms (SPAs)
  const observer = new MutationObserver(() => scanForForms())
  observer.observe(document.body, { childList: true, subtree: true })
})
```

- [ ] **Step 2: Add credential capture to abc-scraper.js**

In `launcher/src/abc-scraper.js`, add credential capture logic at the end of the `DOMContentLoaded` handler (after the existing `tryAutoFill()` call and other setup), before the closing `})`:

```javascript
  // Credential capture for ABC login form
  function captureAbcLogin() {
    const form = document.querySelector('form')
    if (!form || form._wcsCapture) return
    const passwordField = form.querySelector('input[type="password"]')
    if (!passwordField) return
    form._wcsCapture = true

    form.addEventListener('submit', () => {
      const usernameField = form.querySelector('input[type="email"], input[type="text"], input[name*="user" i], input[name*="User"]')
      const username = usernameField?.value?.trim()
      const password = passwordField?.value
      if (username && password) {
        console.log('[WCS Scraper] Captured ABC login credentials')
        ipcRenderer.send('credential-captured', { service: 'abc', username, password })
      }
    })
  }

  captureAbcLogin()
  setInterval(captureAbcLogin, 2000)
```

- [ ] **Step 3: Commit**

```bash
git add launcher/src/credential-capture.js launcher/src/abc-scraper.js
git commit -m "feat: add credential capture preloads for login form detection"
```

---

## Task 8: Credential Save Flow — Main Process + Portal Bridge

**Files:**
- Modify: `launcher/src/main.js`
- Modify: `launcher/src/tabs.js`
- Modify: `launcher/src/portal-preload.js`
- Create: `portal/src/components/SaveCredentialToast.jsx`
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: Add credential-captured handler to main.js**

In `launcher/src/main.js`, add the following after the existing `portal-auth-logout` handler:

```javascript
  // Credential capture — save prompt flow
  ipcMain.on('credential-captured', (e, { service, username, password }) => {
    if (!auth.isLoggedIn()) return

    const existing = auth.getCachedCredential(service)
    // Skip if same credentials already saved
    if (existing && existing.username === username && existing.password === password) return

    log('Credential captured for: ' + service)

    // Find the portal tab to send the save prompt
    const portalTab = tabManager.tabs.get(1) // Portal is always tab 1
    if (portalTab) {
      // Store pending credential for when user responds
      mainWindow._pendingCredential = { service, username, password }
      portalTab.view.webContents.send('show-save-prompt', { service, username })
    }
  })

  ipcMain.on('save-credential-response', async (e, { accepted }) => {
    const pending = mainWindow._pendingCredential
    if (!pending) return
    mainWindow._pendingCredential = null

    if (accepted) {
      try {
        await auth.storeCredential(pending.service, pending.username, pending.password)
        log('Credential saved for: ' + pending.service)
      } catch (err) {
        log('Failed to save credential: ' + err.message)
      }
    }
  })
```

- [ ] **Step 2: Add storeCredential to auth.js**

In `launcher/src/auth.js`, add this function before the `module.exports`:

```javascript
async function storeCredential(service, username, password) {
  const data = await request('POST', '/vault/credentials', {
    staff_id: currentStaff?.id,
    service,
    username,
    password,
  })
  // Update cache
  cachedCredentials[service] = { service, username, password }
  return data
}
```

And add `storeCredential` to the exports:

```javascript
module.exports = {
  login, logout, isLoggedIn,
  setToken, getStaff, getToken,
  fetchCredentials, fetchAllCredentials, getCachedCredential,
  storeCredential,
}
```

- [ ] **Step 3: Inject credential-capture preload on tool tabs in tabs.js**

In `launcher/src/tabs.js`, update the `createTab` method. Change the preload logic:

Replace:
```javascript
    const isAbcScraper = preload && preload.includes('abc-scraper')
    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: isAbcScraper ? false : true,
        nodeIntegration: false,
      },
    })
```

With:
```javascript
    const isPortalPreload = preload && preload.includes('portal-preload')
    const view = new BrowserView({
      webPreferences: {
        preload,
        contextIsolation: isPortalPreload ? true : false,
        nodeIntegration: false,
      },
    })
```

Then in `launcher/src/main.js`, update the `tabManager.onNewWindow` handler to inject `credential-capture.js` on non-ABC tool tabs. Change:

```javascript
    } else if (url.includes('gohighlevel.com') || url.includes('westcoaststrength.com/')) {
      tabManager.createTab(url, 'Grow')
    } else if (url.includes('wheniwork.com')) {
      tabManager.createTab(url, 'WhenIWork')
    } else if (url.includes('paychex.com')) {
      tabManager.createTab(url, 'Paychex')
```

To:
```javascript
    } else if (url.includes('gohighlevel.com') || url.includes('westcoaststrength.com/')) {
      tabManager.createTab(url, 'Grow', { preload: path.join(__dirname, 'credential-capture.js') })
    } else if (url.includes('wheniwork.com')) {
      tabManager.createTab(url, 'WhenIWork', { preload: path.join(__dirname, 'credential-capture.js') })
    } else if (url.includes('paychex.com')) {
      tabManager.createTab(url, 'Paychex', { preload: path.join(__dirname, 'credential-capture.js') })
```

- [ ] **Step 4: Update portal-preload.js with save prompt bridge**

In `launcher/src/portal-preload.js`, add to the `wcsElectron` bridge:

```javascript
  // Credential save prompt
  onSavePrompt: (callback) => {
    const { ipcRenderer: ipc } = require('electron')
    ipc.on('show-save-prompt', (e, data) => callback(data))
  },
  respondSavePrompt: (accepted) => ipcRenderer.send('save-credential-response', { accepted }),
```

- [ ] **Step 5: Create SaveCredentialToast component**

Create `portal/src/components/SaveCredentialToast.jsx`:

```jsx
import { useState, useEffect } from 'react'

const SERVICE_NAMES = {
  abc: 'ABC Financial',
  ghl: 'Grow (GHL)',
  wheniwork: 'WhenIWork',
  paychex: 'Paychex',
}

export default function SaveCredentialToast({ service, username, onRespond }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      onRespond(false)
    }, 10000)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null

  const serviceName = SERVICE_NAMES[service] || service

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-2 animate-[slideDown_0.3s_ease-out]">
      <div className="bg-surface border border-border rounded-xl shadow-lg px-6 py-3 flex items-center gap-4 max-w-lg">
        <p className="text-sm text-text-primary">
          Save login for <span className="font-semibold">{serviceName}</span> ({username})?
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => { setVisible(false); onRespond(true) }}
            className="px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red-hover transition-colors"
          >
            Save
          </button>
          <button
            onClick={() => { setVisible(false); onRespond(false) }}
            className="px-3 py-1.5 rounded-lg border border-border text-text-muted text-xs font-medium hover:text-text-primary transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Add toast to App.jsx**

In `portal/src/App.jsx`:

Add import:
```javascript
import SaveCredentialToast from './components/SaveCredentialToast'
```

Add state:
```javascript
const [savePrompt, setSavePrompt] = useState(null)
```

Add useEffect to listen for Electron save prompts:
```javascript
useEffect(() => {
  if (window.wcsElectron?.onSavePrompt) {
    window.wcsElectron.onSavePrompt((data) => {
      setSavePrompt(data)
    })
  }
}, [])
```

Add toast rendering before the closing `</div>` of the root return:
```jsx
{savePrompt && (
  <SaveCredentialToast
    service={savePrompt.service}
    username={savePrompt.username}
    onRespond={(accepted) => {
      if (window.wcsElectron?.respondSavePrompt) {
        window.wcsElectron.respondSavePrompt(accepted)
      }
      setSavePrompt(null)
    }}
  />
)}
```

- [ ] **Step 7: Commit**

```bash
git add launcher/src/main.js launcher/src/auth.js launcher/src/tabs.js launcher/src/portal-preload.js portal/src/components/SaveCredentialToast.jsx portal/src/App.jsx
git commit -m "feat: add Chrome-style credential auto-capture with save prompt toast"
```

---

## Summary

| Task | What | Backend | Portal | Electron |
|------|------|---------|--------|----------|
| 1 | Custom tiles API | SQL + routes | | |
| 2 | API client helpers | | api.js | |
| 3 | Admin staff tab | | AdminStaffTab | |
| 4 | Admin tiles tab | | AdminTilesTab | |
| 5 | Admin panel + App.jsx | | AdminPanel + App | |
| 6 | ToolGrid custom tiles | | ToolGrid + ToolButton | |
| 7 | Credential capture preload | | | credential-capture.js |
| 8 | Save credential flow | | SaveCredentialToast | main.js + preloads |
