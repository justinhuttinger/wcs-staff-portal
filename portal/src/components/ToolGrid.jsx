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
