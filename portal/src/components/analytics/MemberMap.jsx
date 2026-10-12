import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { PALETTE, fmtInt } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// Member Map — Analytics (OWNER ONLY)
//
// Every active member's geocoded home address against the club pins. The server
// (auth/src/lib/memberMap.js) works out each member's distance to their home
// club and which club is actually nearest them; this draws it.
//
// Home addresses: the response is never put in the api() cache, so nothing is
// left behind in the browser.
//
// Point tuple from the server:
//   [lat, lng, homeClubIdx, name, address, memberId, homeMiles, nearestClubIdx]
// ---------------------------------------------------------------------------

const MISMATCH_COLOR = PALETTE[7]
const MATCH_COLOR = '#8a8f98'
const MODES = [
  { key: 'club', label: 'Home Club' },
  { key: 'nearer', label: 'Closer to Another Club' },
]

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const fmtMi = n => (n === null || n === undefined ? '—' : `${n.toFixed(1)} mi`)
const fmtPctOrDash = n => (n === null || n === undefined ? '—' : `${n.toFixed(1)}%`)

function Tile({ label, value }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className="text-lg font-bold tabular-nums text-text-primary">{value}</p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{label}</p>
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
        active ? 'bg-wcs-red text-white border-wcs-red' : 'bg-bg text-text-muted border-border hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}

function clubPin(name, color) {
  return L.divIcon({
    className: '',
    iconSize: null,
    html: `<div style="transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;pointer-events:auto">
      <div style="background:#111;color:#fff;font:700 11px/1.2 system-ui,sans-serif;padding:3px 7px;border-radius:6px;border:2px solid ${color};white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)">${esc(name)}</div>
      <div style="width:12px;height:12px;border-radius:50%;background:${color};border:2px solid #fff;margin-top:2px;box-shadow:0 0 0 1px #111"></div>
    </div>`,
  })
}

function MapPanel({ data, mode, ring, selectedClubs }) {
  const el = useRef(null)
  const map = useRef(null)
  const layers = useRef(null)

  useEffect(() => {
    if (!el.current || map.current) return
    map.current = L.map(el.current, { preferCanvas: true, zoomControl: true, scrollWheelZoom: true })
    // Esri's public street basemap: no API key. CARTO now answers every tile
    // with an "API KEY REQUIRED" image, and OSM's own servers block apps.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS',
    }).addTo(map.current)
    layers.current = L.layerGroup().addTo(map.current)
    return () => { map.current?.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || !data) return
    const group = layers.current
    group.clearLayers()
    const renderer = L.canvas({ padding: 0.5 })
    const clubs = data.clubs
    const color = i => PALETTE[i % PALETTE.length]

    for (const p of data.points) {
      const [lat, lng, home, name, address, memberId, miles, nearest] = p
      const nearer = nearest !== home
      const fill = mode === 'club' ? color(home) : (nearer ? MISMATCH_COLOR : MATCH_COLOR)
      const dot = L.circleMarker([lat, lng], {
        renderer,
        radius: mode === 'nearer' && nearer ? 3.5 : 2.5,
        stroke: false,
        fillColor: fill,
        fillOpacity: mode === 'nearer' && !nearer ? 0.35 : 0.75,
      })
      dot.bindPopup(
        `<div style="font:12px/1.4 system-ui,sans-serif">
          <b>${esc(name)}</b><br>${esc(address)}<br>
          ${esc(clubs[home]?.name)} member &middot; ${esc(fmtMi(miles))}
          ${nearer ? `<br><span style="color:${MISMATCH_COLOR};font-weight:700">Closer to ${esc(clubs[nearest]?.name)}</span>` : ''}
          <br><span style="color:#8a8f98">ABC #${esc(memberId)}</span>
        </div>`
      )
      group.addLayer(dot)
    }

    clubs.forEach((c, i) => {
      if (ring && selectedClubs.has(c.club_number)) {
        L.circle([c.lat, c.lng], {
          radius: ring * 1609.344, color: color(i), weight: 2, fill: false, dashArray: '6 6', interactive: false,
        }).addTo(group)
      }
      L.marker([c.lat, c.lng], { icon: clubPin(c.name, color(i)), zIndexOffset: 1000 })
        .bindPopup(`<div style="font:12px/1.4 system-ui,sans-serif"><b>${esc(c.name)}</b><br>${esc(c.address)}</div>`)
        .addTo(group)
    })
  }, [data, mode, ring, selectedClubs])

  // Fit once per club selection, not on every mode/ring change, so the view
  // the reader has zoomed into stays put while they flip the toggles.
  const fitKey = [...selectedClubs].sort().join(',')
  useEffect(() => {
    const m = map.current
    if (!m || !data) return
    const inView = data.clubs.filter(c => selectedClubs.has(c.club_number))
    const pts = data.points.map(p => [p[0], p[1]])
    const bounds = L.latLngBounds([...inView.map(c => [c.lat, c.lng]), ...pts])
    if (bounds.isValid()) m.fitBounds(bounds.pad(0.05), { maxZoom: 12 })
    else m.setView([44.9, -123.0], 8)
  }, [data, fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} className="w-full h-[640px] rounded-b-xl" style={{ zIndex: 0 }} />
}

export default function MemberMap({ locationSlug }) {
  const clubs = locationSlug || 'all'
  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/member-map?clubs=${encodeURIComponent(clubs)}`, { signal }),
    [clubs]
  )
  const [mode, setMode] = useState('club')
  const [ring, setRing] = useState(0)

  const selectedClubs = useMemo(
    () => new Set((data?.stats || []).map(s => s.club_number)),
    [data]
  )

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }
  if (!data) return null

  const totals = data.stats.reduce((t, s) => ({
    members: t.members + s.members, mapped: t.mapped + s.mapped,
    unmapped: t.unmapped + s.unmapped, nearer: t.nearer + s.nearer_other,
  }), { members: 0, mapped: 0, unmapped: 0, nearer: 0 })
  const sortedMiles = data.points.map(p => p[6]).filter(n => n !== null).sort((a, b) => a - b)
  const median = sortedMiles.length ? sortedMiles[Math.floor((sortedMiles.length - 1) / 2)] : null

  if (data.stats.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">No active members for the selected clubs.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-5 gap-2">
        <Tile label="Active Members" value={fmtInt(totals.members)} />
        <Tile label="On the Map" value={fmtInt(totals.mapped)} />
        <Tile label="Not Mapped" value={fmtInt(totals.unmapped)} />
        <Tile label="Median Distance" value={fmtMi(median)} />
        <Tile label="Closer to Another Club" value={fmtInt(totals.nearer)} />
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted mr-1">Color</span>
            {MODES.map(m => <Chip key={m.key} active={mode === m.key} onClick={() => setMode(m.key)}>{m.label}</Chip>)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted mr-1">Radius</span>
            <Chip active={ring === 0} onClick={() => setRing(0)}>Off</Chip>
            {data.rings.map(r => <Chip key={r} active={ring === r} onClick={() => setRing(r)}>{r} mi</Chip>)}
          </div>
        </div>
        <div className="px-3 py-1.5 border-b border-border flex flex-wrap gap-x-3 gap-y-1">
          {mode === 'club'
            ? data.clubs.map((c, i) => selectedClubs.has(c.club_number) && (
                <span key={c.club_number} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} /> {c.name}
                </span>
              ))
            : (
              <>
                <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: MISMATCH_COLOR }} /> Another club is closer to home
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: MATCH_COLOR }} /> Home club is the closest
                </span>
              </>
            )}
        </div>
        <MapPanel data={data} mode={mode} ring={ring} selectedClubs={selectedClubs} />
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="px-3 py-2 border-b border-border">
          <h3 className="text-xs font-bold uppercase tracking-wide text-text-primary">Distance from Home Club</h3>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left px-3 py-2">Club</th>
              <th className="text-right px-3 py-2">Members</th>
              <th className="text-right px-3 py-2">Mapped</th>
              <th className="text-right px-3 py-2">Median</th>
              <th className="text-right px-3 py-2">90th pct</th>
              {data.rings.map(r => <th key={r} className="text-right px-3 py-2">Within {r} mi</th>)}
              <th className="text-right px-3 py-2">Closer to Another</th>
            </tr>
          </thead>
          <tbody>
            {data.stats.map((s, i) => (
              <tr key={s.club_number} className={`border-b border-border/60 ${zebra(i)} ${HOVER_TINT}`}>
                <td className="px-3 py-2 font-semibold text-text-primary">{s.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(s.members)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(s.mapped)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMi(s.median_mi)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMi(s.p90_mi)}</td>
                {data.rings.map(r => <td key={r} className="px-3 py-2 text-right tabular-nums">{fmtPctOrDash(s.within_pct[r])}</td>)}
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(s.nearer_other)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-1 px-1">
        <p className="text-[11px] text-text-muted">Active members by the same rule as Membership Mix. Distances are straight-line miles from home to club.</p>
        <p className="text-[11px] text-text-muted">Not Mapped = no address in ABC, or the address did not match in the US Census geocoder.</p>
      </div>
    </div>
  )
}
