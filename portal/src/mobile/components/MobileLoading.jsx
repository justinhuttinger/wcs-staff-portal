import React from 'react'

// Page-shaped skeleton loaders. Pick the variant that matches the page's
// actual content so the placeholder mirrors the real layout.
//
//   <MobileLoading variant="list" />          // generic stacked cards (default)
//   <MobileLoading variant="stats" />         // 2-col grid of stat cards
//   <MobileLoading variant="appointments" />  // list rows with title + meta + badge
//   <MobileLoading variant="report" />        // stat grid + chart card + chart card
//   <MobileLoading variant="ranking" />       // ranked list rows (rank pill + name + score)
//   <MobileLoading variant="comm-notes" />    // note cards with category dot + body excerpt + footer

const PulseCard = ({ children, className = '' }) => (
  <div className={`bg-surface rounded-2xl border border-border shadow-sm p-4 animate-pulse ${className}`}>
    {children}
  </div>
)

const Block = ({ className = '' }) => <div className={`bg-bg rounded ${className}`} />

function ListSkeleton({ count = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <PulseCard key={i}>
          <Block className="h-4 w-1/3 mb-3" />
          <Block className="h-8 w-1/2 mb-2" />
          <Block className="h-3 w-2/3" />
        </PulseCard>
      ))}
    </div>
  )
}

function StatsSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <PulseCard key={i} className="text-center">
          <Block className="h-7 w-1/2 mb-2 mx-auto" />
          <Block className="h-3 w-2/3 mx-auto" />
        </PulseCard>
      ))}
    </div>
  )
}

function AppointmentsSkeleton({ count = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <PulseCard key={i}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <Block className="h-4 w-2/3 mb-2" />
              <Block className="h-3 w-1/3 mb-1.5" />
              <Block className="h-3 w-1/4" />
            </div>
            <div className="bg-bg rounded-full h-6 w-20 shrink-0" />
          </div>
        </PulseCard>
      ))}
    </div>
  )
}

function RankingSkeleton({ count = 6 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <PulseCard key={i} className="p-3">
          <div className="flex items-center gap-3">
            <div className="bg-bg rounded-full h-8 w-8 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Block className="h-3 w-2/3" />
              <Block className="h-2.5 w-1/3" />
            </div>
            <Block className="h-5 w-12 shrink-0" />
          </div>
        </PulseCard>
      ))}
    </div>
  )
}

function CommNotesSkeleton({ count = 4 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <PulseCard key={i}>
          <div className="flex items-start gap-2 mb-2">
            <div className="bg-bg rounded-full h-2 w-2 mt-1.5 shrink-0" />
            <Block className="h-4 flex-1" />
            <Block className="h-3 w-12 shrink-0" />
          </div>
          <Block className="h-3 w-full mb-1.5 ml-4" />
          <Block className="h-3 w-2/3 mb-3 ml-4" />
          <div className="flex items-center justify-between ml-4">
            <Block className="h-2.5 w-1/2" />
            <Block className="h-2.5 w-8" />
          </div>
        </PulseCard>
      ))}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-3">
      {/* Stat grid (4 cards) */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <PulseCard key={i} className="text-center">
            <Block className="h-7 w-1/2 mb-2 mx-auto" />
            <Block className="h-3 w-2/3 mx-auto" />
          </PulseCard>
        ))}
      </div>

      {/* Top performers card */}
      <PulseCard>
        <Block className="h-4 w-1/3 mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-bg">
              <div className="bg-surface rounded-full h-8 w-8 shrink-0" />
              <div className="flex-1 space-y-1.5">
                <div className="bg-surface rounded h-3 w-2/3" />
                <div className="bg-surface rounded h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </PulseCard>

      {/* Pie + legend card */}
      <PulseCard>
        <Block className="h-3 w-1/3 mb-3" />
        <div className="flex items-center gap-4">
          <div className="w-24 h-24 rounded-full bg-bg shrink-0" />
          <div className="flex-1 space-y-2">
            <Block className="h-3 w-3/4" />
            <Block className="h-3 w-2/3" />
            <Block className="h-3 w-1/2" />
          </div>
        </div>
      </PulseCard>

      {/* Bar chart card */}
      <PulseCard>
        <Block className="h-3 w-1/3 mb-3" />
        <Block className="h-32 w-full" />
      </PulseCard>
    </div>
  )
}

const VARIANTS = {
  list: ListSkeleton,
  stats: StatsSkeleton,
  appointments: AppointmentsSkeleton,
  ranking: RankingSkeleton,
  'comm-notes': CommNotesSkeleton,
  report: ReportSkeleton,
}

export default function MobileLoading({ variant = 'list', count, className = '' }) {
  const Component = VARIANTS[variant] || VARIANTS.list
  return (
    <div className={`p-4 ${className}`}>
      <Component count={count} />
    </div>
  )
}
