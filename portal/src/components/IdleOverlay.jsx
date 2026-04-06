export default function IdleOverlay({ onDismiss }) {
  return (
    <div
      onClick={onDismiss}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy/95 cursor-pointer"
    >
      <div className="text-center">
        <h2 className="text-5xl font-black text-white mb-2 tracking-[-0.5px]">
          WCS Staff Portal
        </h2>
        <p className="text-xl font-medium text-white/50 animate-pulse">
          Touch to continue
        </p>
      </div>
    </div>
  )
}
