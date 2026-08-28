// Desktop skeleton-loader. Mirrors the API of `mobile/components/MobileLoading.jsx`
// so reports can declare their loading shape consistently across surfaces:
//
//   <DesktopLoading variant="report" />          // stat grid + chart cards
//   <DesktopLoading variant="list" count={6} />  // generic stacked rows
//   <DesktopLoading variant="stats" />           // grid of stat cards
//   <DesktopLoading variant="appointments" />    // rows with title/meta/badge
//   <DesktopLoading variant="ranking" />         // rank pill + name + score rows
//   <DesktopLoading variant="card-grid" />       // 2-col card grid
//
// Uses a single CSS shimmer animation defined inline; no JS animation loop.

import WcsLoadingMark from './WcsLoadingMark'

const SHIMMER_STYLE = {
  background: 'linear-gradient(90deg, rgba(0,0,0,0.04) 0%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 100%)',
  backgroundSize: '200% 100%',
  animation: 'wcs-shimmer 1.4s ease-in-out infinite',
}

// Inject the keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('wcs-shimmer-keyframes')) {
  const style = document.createElement('style')
  style.id = 'wcs-shimmer-keyframes'
  style.textContent = `
    @keyframes wcs-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    @keyframes wcs-dots {
      0%, 20%  { content: ''; }
      40%      { content: '.'; }
      60%      { content: '..'; }
      80%, 100%{ content: '...'; }
    }
    .wcs-dots::after {
      content: '';
      animation: wcs-dots 1.6s steps(1, end) infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      /* Reaches the SMIL <animate> inside the mark too, which CSS cannot
         otherwise stop. */
      .wcs-dots::after { animation: none; content: '...'; }
      svg animate { animation-play-state: paused; }
    }
  `
  document.head.appendChild(style)
}

/**
 * The branded header that sits above every report skeleton.
 *
 * Shown by default: DesktopLoading is the report loader, and a bare shimmer
 * gives no sign that anything is happening on a slow report. Pass
 * branded={false} for the inline widget cases where a logo would be too loud.
 *
 * `retrying` is surfaced rather than hidden. A request that silently retries
 * for two seconds looks identical to one that has hung, and a user who is told
 * "still trying" waits; one who is told nothing reloads the page.
 */
export function LoadingBrand({ label = 'Getting your report', retrying = false }) {
  return (
    <div className="flex flex-col items-center justify-center py-8" role="status" aria-live="polite">
      {/* The mark fills and drains on its own, so there is no wrapper pulse to
          fight with it. currentColor lets it follow the theme. */}
      <WcsLoadingMark size={64} className="text-wcs-red mb-3" />
      <p className="text-sm font-semibold text-text-primary">
        <span className="wcs-dots">{retrying ? 'Still working on it' : label}</span>
      </p>
      <p className="text-[11px] text-text-muted mt-0.5">
        {retrying ? 'The last attempt did not come back, trying again' : 'Pulling the numbers together'}
      </p>
    </div>
  )
}

function Bar({ width = '100%', height = 12, className = '' }) {
  return (
    <div
      className={`rounded ${className}`}
      style={{ width, height, ...SHIMMER_STYLE }}
    />
  )
}

function Card({ children, className = '' }) {
  return <div className={`bg-surface rounded-xl border border-border p-5 ${className}`}>{children}</div>
}

function ListSkeleton({ count = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <Bar width="60%" height={16} className="mb-3" />
          <Bar width="40%" height={12} className="mb-2" />
          <Bar width="80%" height={12} />
        </Card>
      ))}
    </div>
  )
}

function StatsSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <Bar width="40%" height={10} className="mb-3" />
          <Bar width="55%" height={28} />
        </Card>
      ))}
    </div>
  )
}

function ReportSkeleton() {
  return (
    <div className="space-y-5">
      <StatsSkeleton count={4} />
      <Card>
        <Bar width="30%" height={14} className="mb-4" />
        <Bar width="100%" height={140} />
      </Card>
      <Card>
        <Bar width="30%" height={14} className="mb-4" />
        <Bar width="100%" height={140} />
      </Card>
    </div>
  )
}

function AppointmentsSkeleton({ count = 6 }) {
  return (
    <Card>
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
            <div className="flex-1 min-w-0">
              <Bar width="55%" height={14} className="mb-2" />
              <Bar width="35%" height={10} />
            </div>
            <Bar width={56} height={16} className="ml-3" />
          </div>
        ))}
      </div>
    </Card>
  )
}

function RankingSkeleton({ count = 6 }) {
  return (
    <Card>
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Bar width={24} height={24} className="rounded-full" />
            <Bar width="50%" height={14} />
            <div className="ml-auto"><Bar width={40} height={14} /></div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function CardGridSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <Bar width="55%" height={16} className="mb-3" />
          <Bar width="80%" height={12} className="mb-2" />
          <Bar width="60%" height={12} />
        </Card>
      ))}
    </div>
  )
}

const VARIANTS = {
  list: ListSkeleton,
  stats: StatsSkeleton,
  report: ReportSkeleton,
  appointments: AppointmentsSkeleton,
  ranking: RankingSkeleton,
  'card-grid': CardGridSkeleton,
}

export default function DesktopLoading({
  variant = 'list', count, className = '', branded = true, label, retrying = false,
}) {
  const Component = VARIANTS[variant] || VARIANTS.list
  return (
    <div className={className}>
      {branded && <LoadingBrand label={label} retrying={retrying} />}
      <Component count={count} />
    </div>
  )
}
