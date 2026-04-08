import { useState, useEffect } from 'react'
import allTools from '../config/tools.json'
import ToolButton from './ToolButton'
import { getTiles } from '../lib/api'

const TILE_ICONS = {
  dayOne: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
  tours: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5',
  reporting: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z',
  marketing: 'M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6',
  tickets: 'M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z',
}

// Which built-in tool IDs are "Apps" (external services)
const APP_IDS = ['grow', 'abc', 'wheniwork', 'paychex', 'gmail', 'drive']

function SvgTileButton({ onClick, iconPath, label, desc }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 min-h-[160px] cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg group-hover:bg-wcs-red/10 transition-all duration-200">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-7 h-7 text-wcs-red">
          <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
        </svg>
      </div>
      <div className="text-center">
        <span className="block text-base font-semibold text-text-primary">{label}</span>
        <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{desc}</span>
      </div>
    </button>
  )
}

export default function ToolGrid({ abcUrl, location, visibleTools, locationId, onTours, onDayOneTracker }) {
  const [customTiles, setCustomTiles] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)
  const [tilesLoaded, setTilesLoaded] = useState(false)

  useEffect(() => {
    if (locationId) {
      getTiles(locationId).then(res => {
        setCustomTiles(res.tiles || [])
      }).catch(() => {}).finally(() => setTilesLoaded(true))
    } else {
      setTilesLoaded(true)
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

  const visibleCustomTiles = customTiles.filter(t => {
    if (!visibleTools || visibleTools.length === 0) return true
    const tileKey = 'tile:' + t.id
    if (visibleTools.includes(tileKey)) return true
    const hasTileKeys = visibleTools.some(k => k.startsWith('tile:'))
    if (!hasTileKeys) return true
    return false
  })

  const mainTiles = visibleCustomTiles.filter(t => !t.parent_id && t.section === 'main')
  const topLevelTiles = visibleCustomTiles.filter(t => !t.parent_id && t.section !== 'main')
  const childTiles = activeGroup ? visibleCustomTiles.filter(t => t.parent_id === activeGroup.id) : []

  if (activeGroup) {
    return (
      <div className="w-full max-w-4xl mx-auto px-8">
        <button
          onClick={() => setActiveGroup(null)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-surface text-text-muted hover:text-text-primary hover:border-text-muted transition-colors mb-4 mt-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-lg font-bold text-text-primary mb-4">{activeGroup.label}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
          {childTiles.map((tile) => (
            <ToolButton key={'custom-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
          ))}
          {childTiles.length === 0 && (
            <p className="col-span-4 text-center text-text-muted text-sm py-8">No items in this category yet</p>
          )}
        </div>
      </div>
    )
  }

  if (!tilesLoaded) return null

  // Tool labels that should be in Tools section even if they're in "main" section
  const TOOL_LABELS = ['cancel', 'cancel tool']

  const appTools = tools.filter(t => APP_IDS.includes(t.id))
  const appCustomTiles = mainTiles.filter(t => !TOOL_LABELS.includes((t.label || '').toLowerCase()))
  const toolMainTiles = mainTiles.filter(t => TOOL_LABELS.includes((t.label || '').toLowerCase()))
  const toolCustomTiles = topLevelTiles

  return (
    <div className="w-full px-8 max-w-7xl mx-auto flex gap-10">
      {/* Apps — left side */}
      <div className="w-1/2">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3">Apps</p>
        <div className="grid grid-cols-3 gap-4">
          {appTools.map((tool) => (
            <ToolButton key={tool.id} label={tool.label} description={tool.description} icon={tool.icon} url={getUrl(tool)} />
          ))}
          {appCustomTiles.map((tile) => (
            <ToolButton key={'main-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
          ))}
        </div>
      </div>

      {/* Tools — right side */}
      <div className="w-1/2">
        <p className="text-xs font-semibold text-text-muted uppercase tracking-widest mb-3">Tools</p>
        <div className="grid grid-cols-3 gap-4">
          {/* Cancel tool tile (moved from main section) */}
          {toolMainTiles.map((tile) => (
            <ToolButton key={'tool-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
          ))}
          {onDayOneTracker && <SvgTileButton onClick={onDayOneTracker} iconPath={TILE_ICONS.dayOne} label="Day One" desc="Tracking" />}
          {onTours && <SvgTileButton onClick={onTours} iconPath={TILE_ICONS.tours} label="Tours" desc="Calendar" />}
          {toolCustomTiles.map((tile) => {
            const hasChildren = customTiles.some(t => t.parent_id === tile.id)
            const isGroup = hasChildren || !tile.url

            if (isGroup) {
              const handleClick = tile.label === 'Reporting'
                ? () => {
                    const reportingUrl = window.location.origin + window.location.pathname + window.location.search + '#reporting'
                    window.open(reportingUrl, '_blank')
                  }
                : () => setActiveGroup(tile)

              const iconKey = (tile.label || '').toLowerCase()
              const iconPath = TILE_ICONS[iconKey] || TILE_ICONS.reporting
              return (
                <SvgTileButton
                  key={'custom-' + tile.id}
                  onClick={handleClick}
                  iconPath={iconPath}
                  label={tile.label}
                  desc={tile.description || ''}
                />
              )
            }

            return (
              <ToolButton key={'custom-' + tile.id} label={tile.label} description={tile.description || ''} emoji={tile.icon} url={tile.url} />
            )
          })}
        </div>
      </div>
    </div>
  )
}
