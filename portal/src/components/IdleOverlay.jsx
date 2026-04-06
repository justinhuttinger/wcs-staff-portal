export default function IdleOverlay({ onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/95 cursor-pointer"
    >
      <div className="text-center">
        <h2 className="text-5xl font-bold text-white mb-4">
          WCS Staff Portal
        </h2>
        <p className="text-2xl text-white/70 animate-pulse">
          Touch to continue
        </p>
      </div>
    </div>
  )
}
