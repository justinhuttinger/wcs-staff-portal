import { useState } from 'react'

// Sample tile data for previews
const SAMPLE_APPS = [
  { label: 'Grow', desc: 'CRM' },
  { label: 'ABC', desc: 'Fitness' },
  { label: 'When I Work', desc: 'Schedule' },
  { label: 'Paychex', desc: 'Payroll' },
  { label: 'Gmail', desc: 'Email' },
  { label: 'Drive', desc: 'Files' },
]

const SAMPLE_TOOLS = [
  { label: 'Cancel Tool', desc: 'Memberships', badge: 0, star: true },
  { label: 'Tours', desc: 'Calendar', badge: 3, star: true },
  { label: 'Day Ones', desc: 'Calendar', badge: 2, star: true },
  { label: 'Leaderboard', desc: 'Rankings', badge: 0 },
  { label: 'Comm Notes', desc: 'Team Notes', badge: 5 },
  { label: 'HR Docs', desc: 'Documents', badge: 0 },
  { label: 'Help Center', desc: 'Guides', badge: 0 },
  { label: 'Tickets', desc: 'Support', badge: 1 },
  { label: 'Day One', desc: 'Tracking', badge: 4 },
  { label: 'Availability', desc: 'Trainers', badge: 0 },
  { label: 'Reporting', desc: 'Analytics', badge: 0 },
]

const ALL_TILES = [...SAMPLE_APPS, ...SAMPLE_TOOLS]

// Mini tile component for previews
function MiniTile({ label, desc, badge, star, size = 'md', variant = 'default' }) {
  const sizes = {
    sm: 'p-2 min-h-[60px] gap-1',
    md: 'p-3 min-h-[80px] gap-1.5',
    lg: 'p-4 min-h-[100px] gap-2',
  }
  const variants = {
    default: 'bg-white border border-gray-200 rounded-lg',
    glass: 'bg-white/10 backdrop-blur border border-white/20 rounded-xl text-white',
    flat: 'bg-gray-100 rounded-md',
    card: 'bg-white rounded-2xl shadow-md border-0',
    neon: 'bg-gray-900 border border-red-500/30 rounded-lg text-white',
    minimal: 'bg-transparent border border-gray-300 rounded-lg',
  }
  return (
    <div className={`flex flex-col items-center justify-center text-center relative ${sizes[size]} ${variants[variant]} transition-all`}>
      {star && <span className="absolute top-1 left-1 text-amber-400 text-[8px]">★</span>}
      {badge > 0 && <span className="absolute top-1 right-1 bg-red-500 text-white text-[7px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">{badge}</span>}
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${variant === 'glass' || variant === 'neon' ? 'bg-white/20 text-white' : 'bg-red-50 text-red-500'}`}>
        {label[0]}
      </div>
      <span className={`text-[9px] font-semibold leading-tight ${variant === 'glass' || variant === 'neon' ? 'text-white' : 'text-gray-800'}`}>{label}</span>
      <span className={`text-[7px] uppercase tracking-wider ${variant === 'glass' || variant === 'neon' ? 'text-white/60' : 'text-gray-400'}`}>{desc}</span>
    </div>
  )
}

// Mini score card for previews
function MiniScoreCard({ variant = 'default' }) {
  const variants = {
    default: 'bg-white border border-gray-200 rounded-lg',
    glass: 'bg-white/10 backdrop-blur border border-white/20 rounded-xl',
    flat: 'bg-gray-100 rounded-md',
    card: 'bg-white rounded-2xl shadow-md',
    neon: 'bg-gray-900 border border-red-500/30 rounded-lg',
    minimal: 'bg-transparent border border-gray-300 rounded-lg',
  }
  const textColor = (variant === 'glass' || variant === 'neon') ? 'text-white' : 'text-gray-800'
  const mutedColor = (variant === 'glass' || variant === 'neon') ? 'text-white/50' : 'text-gray-400'
  return (
    <div className={`px-3 py-2 flex items-center gap-3 ${variants[variant]}`}>
      <span className={`text-[9px] font-semibold ${textColor}`}>Justin</span>
      <span className={`text-[7px] ${mutedColor}`}>·</span>
      <span className={`text-[7px] ${mutedColor}`}>2nd Place</span>
      <span className="text-red-500 text-[10px] font-black">142 <span className={`text-[7px] ${mutedColor}`}>pts</span></span>
      <div className="flex gap-1 ml-auto">
        <span className="bg-blue-50 border border-blue-200 text-[6px] px-1 rounded-full"><b className="text-blue-600">8</b> MS</span>
        <span className="bg-green-50 border border-green-200 text-[6px] px-1 rounded-full"><b className="text-green-600">3</b> D1</span>
      </div>
    </div>
  )
}

// =====================================================================
// LAYOUT DEFINITIONS
// =====================================================================

const LAYOUTS = [
  {
    id: 'current',
    name: 'Current (Split Columns)',
    desc: 'Apps left, Tools right — 50/50 split with score card on top',
    render: (v) => (
      <div className={`p-3 rounded-xl min-h-[280px] ${v === 'neon' ? 'bg-black' : v === 'glass' ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-50'}`}>
        <MiniScoreCard variant={v} />
        <div className="flex gap-3 mt-3">
          <div className="w-1/2">
            <p className={`text-[8px] font-bold uppercase tracking-widest mb-1.5 ${v === 'glass' || v === 'neon' ? 'text-white/50' : 'text-gray-400'}`}>Apps</p>
            <div className="grid grid-cols-3 gap-1.5">
              {SAMPLE_APPS.map(t => <MiniTile key={t.label} {...t} size="sm" variant={v} />)}
            </div>
          </div>
          <div className="w-1/2">
            <p className={`text-[8px] font-bold uppercase tracking-widest mb-1.5 ${v === 'glass' || v === 'neon' ? 'text-white/50' : 'text-gray-400'}`}>Tools</p>
            <div className="grid grid-cols-3 gap-1.5">
              {SAMPLE_TOOLS.slice(0, 9).map(t => <MiniTile key={t.label} {...t} size="sm" variant={v} />)}
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'unified-grid',
    name: 'Unified Grid',
    desc: 'All tiles in a single responsive grid — no Apps/Tools split',
    render: (v) => (
      <div className={`p-3 rounded-xl min-h-[280px] ${v === 'neon' ? 'bg-black' : v === 'glass' ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-50'}`}>
        <MiniScoreCard variant={v} />
        <div className="grid grid-cols-5 gap-1.5 mt-3">
          {ALL_TILES.slice(0, 15).map(t => <MiniTile key={t.label} {...t} size="sm" variant={v} />)}
        </div>
      </div>
    ),
  },
  {
    id: 'sidebar-nav',
    name: 'Sidebar Navigation',
    desc: 'Left sidebar with categories — content area on the right. More like a desktop app.',
    render: (v) => (
      <div className={`p-3 rounded-xl min-h-[280px] flex ${v === 'neon' ? 'bg-black' : v === 'glass' ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-50'}`}>
        <div className={`w-[70px] shrink-0 flex flex-col gap-1 pr-2 border-r ${v === 'glass' || v === 'neon' ? 'border-white/10' : 'border-gray-200'}`}>
          {['Apps', 'Tools', 'Tracking', 'Reports'].map((cat, i) => (
            <div key={cat} className={`text-[8px] px-2 py-1.5 rounded-md cursor-pointer ${i === 1 ? (v === 'neon' ? 'bg-red-500/20 text-red-400' : v === 'glass' ? 'bg-white/20 text-white' : 'bg-red-50 text-red-600') : (v === 'glass' || v === 'neon' ? 'text-white/50' : 'text-gray-500')}`}>
              {cat}
            </div>
          ))}
        </div>
        <div className="flex-1 pl-3">
          <p className={`text-[8px] font-bold uppercase tracking-widest mb-1.5 ${v === 'glass' || v === 'neon' ? 'text-white/50' : 'text-gray-400'}`}>Tools</p>
          <div className="grid grid-cols-3 gap-1.5">
            {SAMPLE_TOOLS.slice(0, 9).map(t => <MiniTile key={t.label} {...t} size="sm" variant={v} />)}
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'command-center',
    name: 'Command Center',
    desc: 'Score card prominent at top, quick actions row, then categorized sections below',
    render: (v) => (
      <div className={`p-3 rounded-xl min-h-[280px] ${v === 'neon' ? 'bg-black' : v === 'glass' ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-50'}`}>
        {/* Big score area */}
        <div className={`rounded-xl p-3 mb-2 ${v === 'neon' ? 'bg-red-500/10 border border-red-500/30' : v === 'glass' ? 'bg-white/10 border border-white/20' : 'bg-gradient-to-r from-red-500 to-red-600'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-[10px] font-bold">Justin — 2nd Place</p>
              <p className="text-white/70 text-[8px]">142 points this month</p>
            </div>
            <div className="flex gap-1">
              <span className="bg-white/20 text-white text-[7px] px-1.5 py-0.5 rounded-full font-semibold">8 MS</span>
              <span className="bg-white/20 text-white text-[7px] px-1.5 py-0.5 rounded-full font-semibold">3 D1</span>
            </div>
          </div>
        </div>
        {/* Quick actions row */}
        <div className="flex gap-1.5 mb-2">
          {['Tours', 'Day Ones', 'Cancel'].map(l => (
            <div key={l} className={`flex-1 text-center py-1.5 rounded-lg text-[8px] font-semibold ${v === 'neon' ? 'bg-gray-800 border border-gray-700 text-white' : v === 'glass' ? 'bg-white/10 text-white' : 'bg-white border border-gray-200 text-gray-700'}`}>
              {l}
            </div>
          ))}
        </div>
        {/* Grid below */}
        <div className="grid grid-cols-4 gap-1.5">
          {ALL_TILES.slice(3, 15).map(t => <MiniTile key={t.label} {...t} size="sm" variant={v} />)}
        </div>
      </div>
    ),
  },
  {
    id: 'list-view',
    name: 'List View',
    desc: 'Compact rows instead of tiles — shows more items with less scrolling',
    render: (v) => (
      <div className={`p-3 rounded-xl min-h-[280px] ${v === 'neon' ? 'bg-black' : v === 'glass' ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-50'}`}>
        <MiniScoreCard variant={v} />
        <div className="mt-2 space-y-0.5">
          {ALL_TILES.slice(0, 10).map(t => (
            <div key={t.label} className={`flex items-center gap-2 px-2 py-1.5 rounded-md ${v === 'neon' ? 'bg-gray-900 border border-gray-800 hover:border-red-500/30' : v === 'glass' ? 'bg-white/5 hover:bg-white/10' : 'bg-white border border-gray-100 hover:border-gray-300'}`}>
              <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold shrink-0 ${v === 'glass' || v === 'neon' ? 'bg-white/20 text-white' : 'bg-red-50 text-red-500'}`}>
                {t.label[0]}
              </div>
              <span className={`text-[9px] font-semibold flex-1 ${v === 'glass' || v === 'neon' ? 'text-white' : 'text-gray-800'}`}>{t.label}</span>
              <span className={`text-[7px] ${v === 'glass' || v === 'neon' ? 'text-white/40' : 'text-gray-400'}`}>{t.desc}</span>
              {t.badge > 0 && <span className="bg-red-500 text-white text-[6px] font-bold rounded-full w-3 h-3 flex items-center justify-center">{t.badge}</span>}
            </div>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'bento',
    name: 'Bento Grid',
    desc: 'Mixed-size tiles — starred/badged items get larger, creating visual hierarchy',
    render: (v) => (
      <div className={`p-3 rounded-xl min-h-[280px] ${v === 'neon' ? 'bg-black' : v === 'glass' ? 'bg-gradient-to-br from-gray-800 to-gray-900' : 'bg-gray-50'}`}>
        <MiniScoreCard variant={v} />
        <div className="grid grid-cols-4 gap-1.5 mt-3" style={{ gridAutoRows: '40px' }}>
          {/* Featured tiles span 2 cols */}
          <div className="col-span-2 row-span-2"><MiniTile label="Tours" desc="Calendar" badge={3} star size="lg" variant={v} /></div>
          <div className="col-span-2 row-span-2"><MiniTile label="Day Ones" desc="Calendar" badge={2} star size="lg" variant={v} /></div>
          {/* Regular tiles */}
          {SAMPLE_TOOLS.slice(3, 11).map(t => (
            <div key={t.label}><MiniTile {...t} size="sm" variant={v} /></div>
          ))}
        </div>
      </div>
    ),
  },
]

const THEMES = [
  { id: 'default', name: 'Default', bg: 'bg-gray-50', ring: 'ring-gray-300' },
  { id: 'card', name: 'Cards', bg: 'bg-gray-50', ring: 'ring-gray-300' },
  { id: 'flat', name: 'Flat', bg: 'bg-gray-50', ring: 'ring-gray-300' },
  { id: 'minimal', name: 'Minimal', bg: 'bg-gray-50', ring: 'ring-gray-300' },
  { id: 'glass', name: 'Glass Dark', bg: 'bg-gray-800', ring: 'ring-gray-600' },
  { id: 'neon', name: 'Neon', bg: 'bg-black', ring: 'ring-red-500' },
]

export default function LayoutExplorer() {
  const [selectedTheme, setSelectedTheme] = useState('default')
  const [expandedLayout, setExpandedLayout] = useState(null)

  return (
    <div className="max-w-6xl mx-auto">
      <p className="text-sm text-text-muted mb-4">
        Browse different layout and theme combinations for the portal home screen. Click a layout to expand it.
      </p>

      {/* Theme selector */}
      <div className="flex items-center gap-2 mb-6">
        <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Theme:</span>
        {THEMES.map(theme => (
          <button
            key={theme.id}
            onClick={() => setSelectedTheme(theme.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              selectedTheme === theme.id
                ? 'bg-wcs-red text-white border-wcs-red'
                : 'bg-surface text-text-muted border-border hover:border-text-muted'
            }`}
          >
            {theme.name}
          </button>
        ))}
      </div>

      {/* Layout grid */}
      <div className={expandedLayout ? '' : 'grid grid-cols-2 gap-6'}>
        {LAYOUTS.map(layout => {
          const isExpanded = expandedLayout === layout.id
          if (expandedLayout && !isExpanded) return null

          return (
            <div key={layout.id} className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-bold text-text-primary">{layout.name}</h3>
                  <p className="text-xs text-text-muted">{layout.desc}</p>
                </div>
                <button
                  onClick={() => setExpandedLayout(isExpanded ? null : layout.id)}
                  className="text-xs font-medium text-wcs-red hover:underline"
                >
                  {isExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>
              <div className={`border border-border rounded-2xl overflow-hidden transition-all ${isExpanded ? 'transform scale-100' : ''}`}>
                {layout.render(selectedTheme)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
