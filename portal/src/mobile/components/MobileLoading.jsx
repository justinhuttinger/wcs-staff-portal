import React from 'react'

// Shared loading indicator: red spinner + dark text on a solid white bubble.
// Use as <MobileLoading text="Loading..." /> wherever a spinner needs to sit
// over the location background image.
export default function MobileLoading({ text = 'Loading...', size = 'md', className = '' }) {
  const dim = size === 'sm' ? 'h-5 w-5 border-2' : size === 'lg' ? 'h-8 w-8 border-[3px]' : 'h-6 w-6 border-2'
  return (
    <div className={`flex items-center justify-center py-6 ${className}`}>
      <div className="inline-flex items-center gap-3 bg-surface rounded-2xl border border-border shadow-sm px-4 py-3">
        <div className={`${dim} border-wcs-red border-t-transparent rounded-full animate-spin shrink-0`} />
        {text && <span className="text-sm font-medium text-text-primary">{text}</span>}
      </div>
    </div>
  )
}
