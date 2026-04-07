import { useState, useEffect } from 'react'
import allTools from '../config/tools.json'
import ToolButton from './ToolButton'
import { getTiles } from '../lib/api'

export default function ToolGrid({ abcUrl, location, visibleTools, locationId, onDayOne }) {
  const [customTiles, setCustomTiles] = useState([])
  const [activeGroup, setActiveGroup] = useState(null)

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

  // Filter custom tiles by role visibility
  // Show tile if: no visibility data, OR tile key is in visible list, OR tile key isn't in the list at all (not yet configured = visible by default)
  const visibleCustomTiles = customTiles.filter(t => {
    if (!visibleTools || visibleTools.length === 0) return true
    const tileKey = 'tile:' + t.id
    // If the tile key exists in visible_tools, it's explicitly allowed
    if (visibleTools.includes(tileKey)) return true
    // If no tile:* keys exist at all in visible_tools, visibility hasn't been configured yet — show all
    const hasTileKeys = visibleTools.some(k => k.startsWith('tile:'))
    if (!hasTileKeys) return true
    return false
  })

  // Separate parent tiles (groups) and top-level tiles (no parent)
  const topLevelTiles = visibleCustomTiles.filter(t => !t.parent_id)
  const childTiles = activeGroup ? visibleCustomTiles.filter(t => t.parent_id === activeGroup.id) : []

  // If viewing a group's children
  if (activeGroup) {
    return (
      <div className="w-full max-w-3xl mx-auto px-8">
        <button
          onClick={() => setActiveGroup(null)}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors mb-4 mt-2"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portal
        </button>
        <h2 className="text-lg font-bold text-text-primary mb-4">{activeGroup.icon ? activeGroup.icon + ' ' : ''}{activeGroup.label}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-5">
          {childTiles.map((tile) => (
            <ToolButton
              key={'custom-' + tile.id}
              label={tile.label}
              description={tile.description || ''}
              emoji={tile.icon}
              url={tile.url}
            />
          ))}
          {childTiles.length === 0 && (
            <p className="col-span-3 text-center text-text-muted text-sm py-8">No items in this category yet</p>
          )}
        </div>
      </div>
    )
  }

  // Top-level view
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
      {onDayOne && (
        <button
          onClick={onDayOne}
          className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
        >
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red group-hover:text-white transition-all duration-200">
            <span className="text-2xl">📋</span>
          </div>
          <div className="text-center">
            <span className="block text-base font-semibold text-text-primary">Day One</span>
            <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">Tracking</span>
          </div>
        </button>
      )}
      {topLevelTiles.map((tile) => {
        const hasChildren = customTiles.some(t => t.parent_id === tile.id)
        const isGroup = hasChildren || !tile.url

        if (isGroup) {
          return (
            <button
              key={'custom-' + tile.id}
              onClick={() => setActiveGroup(tile)}
              className="group flex flex-col items-center justify-center gap-3 rounded-[14px] bg-surface border border-border p-8 cursor-pointer transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]"
            >
              <div className="flex items-center justify-center w-14 h-14 rounded-full bg-bg text-wcs-red group-hover:bg-wcs-red group-hover:text-white transition-all duration-200">
                <span className="text-2xl">{tile.icon || '📁'}</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-semibold text-text-primary">{tile.label}</span>
                <span className="block text-xs font-medium text-text-muted uppercase tracking-[0.8px] mt-1">{tile.description || ''}</span>
              </div>
            </button>
          )
        }

        return (
          <ToolButton
            key={'custom-' + tile.id}
            label={tile.label}
            description={tile.description || ''}
            emoji={tile.icon}
            url={tile.url}
          />
        )
      })}
    </div>
  )
}
