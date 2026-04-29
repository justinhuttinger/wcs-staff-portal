import React from 'react'

// Skeleton loader: pulsing white cards with grey blocks. Used wherever
// content is loading on mobile, including over the location background.
export default function MobileLoading({ count = 3, className = '' }) {
  return (
    <div className={`p-4 space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-surface rounded-2xl border border-border shadow-sm p-4 animate-pulse">
          <div className="h-4 bg-bg rounded w-1/3 mb-3" />
          <div className="h-8 bg-bg rounded w-1/2 mb-2" />
          <div className="h-3 bg-bg rounded w-2/3" />
        </div>
      ))}
    </div>
  )
}
