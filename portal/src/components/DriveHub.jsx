// Chooser shown when "Shared Drive" is clicked: pick the file browser (Drive)
// or the content search (Media Library). Media is offered to anyone who has the
// Shared Drive tile (canMedia), so it tracks tile access rather than a role.

const DRIVE_ICON = 'M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z'
const MEDIA_ICON = 'm2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M18 8.25h.008v.008H18V8.25Zm-15-3h18a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-12a1.5 1.5 0 0 1 1.5-1.5Z'

function HubCard({ iconPath, label, desc, onClick }) {
  return (
    <button onClick={onClick}
      className="rounded-[14px] bg-surface border border-border p-8 min-h-[160px] flex flex-col items-start text-left transition-transform hover:-translate-y-[1px] hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-wcs-red mb-4">
        <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
      </svg>
      <span className="text-base font-bold text-text-primary">{label}</span>
      <span className="text-sm text-tile-sub mt-1">{desc}</span>
    </button>
  )
}

export default function DriveHub({ onBack, onDrive, onMedia, canMedia }) {
  return (
    <div className="w-full max-w-3xl mx-auto px-8 pb-12">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5 mb-6">
        <button onClick={onBack} className="press-hide-back text-sm text-tile-sub hover:text-text-primary">&larr; Back</button>
        <h2 className="text-lg font-bold text-text-primary mt-3">Shared Drive</h2>
        <p className="text-sm text-tile-sub mt-1">Browse the shared files, or search photos and videos by what is in them.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <HubCard iconPath={DRIVE_ICON} label="Drive" desc="Browse shared folders and documents" onClick={onDrive} />
        {canMedia && (
          <HubCard iconPath={MEDIA_ICON} label="Media" desc="Search photos and videos by content" onClick={onMedia} />
        )}
      </div>
    </div>
  )
}
