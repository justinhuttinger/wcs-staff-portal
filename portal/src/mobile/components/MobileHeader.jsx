import React from 'react'

export default function MobileHeader({ title, subtitle, onBack, rightAction }) {
  return (
    <div className="bg-surface/95 backdrop-blur-sm border-b border-border px-4 py-3 flex items-center gap-3 rounded-xl">
      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center justify-center w-10 h-10 -ml-2 rounded-lg active:bg-bg transition-colors"
          aria-label="Go back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-text-primary">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      )}

      {/* Title area */}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-semibold text-text-primary truncate">{title}</h1>
        {subtitle && (
          <p className="text-sm text-text-muted truncate">{subtitle}</p>
        )}
      </div>

      {/* Right action */}
      {rightAction && (
        <div className="flex-shrink-0">
          {rightAction}
        </div>
      )}
    </div>
  )
}
